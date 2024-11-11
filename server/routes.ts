import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles, vocabulary } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { downloadAudio, transcribeAudio } from "./lib/audio";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { OpenAI } from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Ensure temp directory exists
const tempDir = join(process.cwd(), 'temp');
mkdir(tempDir, { recursive: true }).catch(err => {
  console.error('Error creating temp directory:', err);
});

const MAX_VIDEO_DURATION = 7200; // 2 hours in seconds

async function getVideoMetadata(videoId: string) {
  try {
    if (!process.env.YOUTUBE_API_KEY) {
      throw new Error('YouTube API key is not configured');
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.items?.[0]) {
      throw new Error('Video not found');
    }

    const snippet = data.items[0].snippet;
    return {
      title: snippet.title || 'Untitled Video',
      thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null
    };
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    return {
      title: 'Untitled Video',
      thumbnailUrl: null
    };
  }
}

export function registerRoutes(app: Express) {
  app.get("/api/videos", async (req, res) => {
    try {
      const videos = await db
        .select({
          videoId: subtitles.videoId,
          title: subtitles.title,
          thumbnailUrl: subtitles.thumbnailUrl,
          createdAt: subtitles.createdAt
        })
        .from(subtitles)
        .groupBy(subtitles.videoId, subtitles.title, subtitles.thumbnailUrl, subtitles.createdAt)
        .orderBy(desc(subtitles.createdAt));

      // If any video is missing metadata, fetch it
      const updatedVideos = await Promise.all(
        videos.map(async (video) => {
          if (!video.title) {
            const metadata = await getVideoMetadata(video.videoId);
            if (metadata.title !== 'Untitled Video') {
              // Update the database with the fetched metadata
              await db
                .update(subtitles)
                .set({
                  title: metadata.title,
                  thumbnailUrl: metadata.thumbnailUrl
                })
                .where(eq(subtitles.videoId, video.videoId));
              return { ...video, ...metadata };
            }
          }
          return video;
        })
      );

      res.json(updatedVideos);
    } catch (error) {
      console.error("Error fetching videos:", error);
      res.status(500).json({ error: "Failed to fetch video history" });
    }
  });

  app.post("/api/summarize", async (req, res) => {
    try {
      const { text } = z.object({
        text: z.string().min(1)
      }).parse(req.body);

      const summary = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that creates concise and informative summaries of text."
          },
          {
            role: "user",
            content: `Please provide a concise summary of the following text:\n\n${text}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      res.json({ summary: summary.choices[0]?.message?.content || "No summary generated" });
    } catch (error) {
      console.error("Error generating summary:", error);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  app.get("/api/subtitles/:videoId", async (req, res) => {
    const videoId = req.params.videoId;
    let audioPath: string | null = null;
    
    try {
      // First check if subtitles exist in database
      const existingSubtitles = await db.select()
        .from(subtitles)
        .where(eq(subtitles.videoId, videoId))
        .orderBy(subtitles.start);

      if (existingSubtitles.length > 0) {
        // Check if metadata exists and update if missing
        if (!existingSubtitles[0].title) {
          const metadata = await getVideoMetadata(videoId);
          await db
            .update(subtitles)
            .set({
              title: metadata.title,
              thumbnailUrl: metadata.thumbnailUrl
            })
            .where(eq(subtitles.videoId, videoId));
          existingSubtitles.forEach(subtitle => {
            subtitle.title = metadata.title;
            subtitle.thumbnailUrl = metadata.thumbnailUrl;
          });
        }
        return res.json(existingSubtitles);
      }

      // Fetch new video metadata
      const metadata = await getVideoMetadata(videoId);
      if (metadata.title === 'Untitled Video') {
        return res.status(400).json({ error: "Failed to fetch video metadata" });
      }

      // Process audio and generate subtitles
      try {
        audioPath = await downloadAudio(videoId, MAX_VIDEO_DURATION);
        const subtitleData = await transcribeAudio(audioPath);
        
        const subtitlesWithMetadata = subtitleData.map(sub => ({
          ...sub,
          videoId,
          title: metadata.title,
          thumbnailUrl: metadata.thumbnailUrl
        }));

        await db.insert(subtitles).values(subtitlesWithMetadata);
        res.json(subtitlesWithMetadata);
      } catch (error: any) {
        if (audioPath) {
          await unlink(audioPath).catch(() => {});
        }
        console.error("Subtitle generation error:", error);
        res.status(500).json({ error: error.message || "Failed to generate subtitles" });
      }
    } catch (error) {
      console.error("Error fetching subtitles:", error);
      res.status(500).json({ error: "Failed to fetch subtitles" });
    }
  });

  app.post("/api/subtitles", async (req, res) => {
    try {
      const subtitleData = z.array(z.object({
        videoId: z.string(),
        start: z.number(),
        end: z.number(),
        text: z.string(),
        title: z.string().optional(),
        thumbnailUrl: z.string().optional()
      })).parse(req.body);

      await db.insert(subtitles).values(subtitleData);
      res.status(201).json({ message: "Subtitles saved successfully" });
    } catch (error) {
      console.error("Error saving subtitles:", error);
      res.status(500).json({ error: "Failed to save subtitles" });
    }
  });

  app.get("/api/vocabulary/:videoId", async (req, res) => {
    try {
      const videoId = req.params.videoId;
      
      // Check if vocabulary already exists
      const existingVocab = await db
        .select()
        .from(vocabulary)
        .where(eq(vocabulary.videoId, videoId))
        .orderBy(vocabulary.timestamp);

      if (existingVocab.length > 0) {
        return res.json(existingVocab);
      }

      // Get subtitles to extract vocabulary
      const subtitleData = await db
        .select()
        .from(subtitles)
        .where(eq(subtitles.videoId, videoId))
        .orderBy(subtitles.start);

      if (subtitleData.length === 0) {
        return res.status(404).json({ error: "No subtitles found for this video" });
      }

      // Extract vocabulary using OpenAI
      const prompt = `Given these subtitles from a video, identify important vocabulary words. For each word:
1. Consider the context it appears in
2. Only include words that would be valuable for language learning
3. Exclude common words unless they have special significance in context

Subtitles:
${subtitleData.map(s => s.text).join('\n')}

Return the response as a JSON array with objects containing:
- word: the vocabulary word
- context: the sentence or phrase it appears in
- timestamp: the timestamp in milliseconds when it appears

Format: [{"word": "example", "context": "This is an example sentence", "timestamp": 1000}, ...]`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a language learning assistant that identifies important vocabulary from video subtitles. Return only valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const vocabList = JSON.parse(completion.choices[0]?.message?.content || "[]").vocabulary || [];
      
      // Store vocabulary in database
      if (vocabList.length > 0) {
        const vocabularyData = vocabList.map((vocab: any) => ({
          videoId,
          word: vocab.word,
          context: vocab.context,
          timestamp: vocab.timestamp,
          language: subtitleData[0].language
        }));

        await db.insert(vocabulary).values(vocabularyData);
        return res.json(vocabularyData);
      }

      return res.json([]);
    } catch (error) {
      console.error("Error extracting vocabulary:", error);
      res.status(500).json({ error: "Failed to extract vocabulary" });
    }
  });
}