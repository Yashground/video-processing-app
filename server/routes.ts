import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
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

  // ... rest of the routes remain unchanged ...
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
        // ... error handling remains the same ...
        throw error;
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
}
