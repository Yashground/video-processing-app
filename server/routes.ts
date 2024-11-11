import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles, flashcards } from "../db/schema";
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
  // Existing routes...
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

      const updatedVideos = await Promise.all(
        videos.map(async (video) => {
          if (!video.title) {
            const metadata = await getVideoMetadata(video.videoId);
            if (metadata.title !== 'Untitled Video') {
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

  // ... Other existing routes ...

  // New flashcard routes
  app.get("/api/flashcards/:videoId", async (req, res) => {
    try {
      const result = await db
        .select()
        .from(flashcards)
        .where(eq(flashcards.videoId, req.params.videoId))
        .orderBy(desc(flashcards.createdAt));
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching flashcards:", error);
      res.status(500).json({ error: "Failed to fetch flashcards" });
    }
  });

  app.post("/api/flashcards", async (req, res) => {
    try {
      const { videoId, front, back, context, timestamp } = z.object({
        videoId: z.string(),
        front: z.string(),
        back: z.string(),
        context: z.string().optional(),
        timestamp: z.number()
      }).parse(req.body);

      await db.insert(flashcards).values({
        videoId,
        front,
        back,
        context,
        timestamp
      });

      res.status(201).json({ message: "Flashcard created successfully" });
    } catch (error) {
      console.error("Error creating flashcard:", error);
      res.status(500).json({ error: "Failed to create flashcard" });
    }
  });

  app.post("/api/flashcards/:id/review", async (req, res) => {
    try {
      await db
        .update(flashcards)
        .set({ lastReviewed: new Date() })
        .where(eq(flashcards.id, parseInt(req.params.id)));
      
      res.json({ message: "Review timestamp updated" });
    } catch (error) {
      console.error("Error updating review timestamp:", error);
      res.status(500).json({ error: "Failed to update review timestamp" });
    }
  });

  // ... Rest of the existing routes ...
}
