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
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );
    const data = await response.json();
    
    if (!data.items?.[0]) {
      throw new Error('Video not found');
    }

    const snippet = data.items[0].snippet;
    return {
      title: snippet.title,
      thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url
    };
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    return null;
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

      res.json(videos);
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
    
    console.log(`Processing subtitle request for video: ${videoId}`);
    
    try {
      // First check if subtitles exist in database
      const existingSubtitles = await db.select()
        .from(subtitles)
        .where(eq(subtitles.videoId, videoId))
        .orderBy(subtitles.start);

      if (existingSubtitles.length > 0) {
        console.log(`Found existing subtitles for video ${videoId}`);
        return res.json(existingSubtitles);
      }

      console.log(`No existing subtitles found for ${videoId}, processing audio...`);

      // Fetch video metadata
      const metadata = await getVideoMetadata(videoId);
      if (!metadata) {
        return res.status(400).json({ error: "Failed to fetch video metadata" });
      }

      // Process audio and generate subtitles
      try {
        audioPath = await downloadAudio(videoId, MAX_VIDEO_DURATION);
        console.log(`Successfully downloaded audio to ${audioPath}`);
        
        const subtitleData = await transcribeAudio(audioPath);
        console.log(`Successfully generated transcription with ${subtitleData.length} segments in ${subtitleData[0]?.language || 'unknown'} language`);
        
        // Add videoId and metadata to each subtitle
        const subtitlesWithMetadata = subtitleData.map(sub => ({
          ...sub,
          videoId,
          title: metadata.title,
          thumbnailUrl: metadata.thumbnailUrl
        }));

        // Save to database
        await db.insert(subtitles).values(subtitlesWithMetadata);
        console.log(`Successfully saved subtitles to database`);

        // Return the subtitles
        res.json(subtitlesWithMetadata);
      } catch (error: any) {
        console.error("Error processing audio:", error);
        
        if (audioPath) {
          await unlink(audioPath).catch(err => {
            console.error("Error cleaning up audio file:", err);
          });
        }
        
        if (error.message?.includes("too large") || error.message?.includes("maxFilesize")) {
          res.status(413).json({ 
            error: "Video file is too large (max 100MB). Please try a shorter video." 
          });
        } else if (error.message?.includes("duration") || error.message?.includes("maximum limit")) {
          res.status(413).json({ 
            error: `Video is too long. Maximum supported duration is ${MAX_VIDEO_DURATION / 3600} hours.` 
          });
        } else if (error.message?.includes("unavailable") || error.message?.includes("private")) {
          res.status(400).json({ 
            error: "Video is unavailable or private. Please try another video." 
          });
        } else if (error.message?.includes("copyright")) {
          res.status(403).json({ 
            error: "Video is not accessible due to copyright restrictions." 
          });
        } else if (error.message?.includes("format")) {
          res.status(400).json({ 
            error: "Failed to extract audio in the required format. Please try another video." 
          });
        } else if (error.code === 'ENOENT') {
          res.status(500).json({ 
            error: "Failed to process audio file. Please try again." 
          });
        } else {
          console.error("Unexpected error details:", error);
          res.status(500).json({ 
            error: "Failed to process audio. Please try again." 
          });
        }
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
