import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
import { eq } from "drizzle-orm";
import { downloadAudio, transcribeAudio } from "./lib/audio";
import { mkdir } from "fs/promises";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Ensure temp directory exists
mkdir(join(process.cwd(), 'temp')).catch(() => {});

const MAX_VIDEO_DURATION = 1800; // 30 minutes in seconds

export function registerRoutes(app: Express) {
  app.get("/api/subtitles/:videoId", async (req, res) => {
    try {
      const videoId = req.params.videoId;
      
      // First check if subtitles exist in database
      const existingSubtitles = await db.select()
        .from(subtitles)
        .where(eq(subtitles.videoId, videoId))
        .orderBy(subtitles.start);

      if (existingSubtitles.length > 0) {
        return res.json(existingSubtitles);
      }

      // If not in database, process audio and generate subtitles
      try {
        // Download audio with max duration limit
        const audioPath = await downloadAudio(videoId, MAX_VIDEO_DURATION);
        
        // Generate transcription using Whisper
        const subtitleData = await transcribeAudio(audioPath);
        
        // Add videoId to each subtitle
        const subtitlesWithVideoId = subtitleData.map(sub => ({
          ...sub,
          videoId
        }));

        // Save to database
        await db.insert(subtitles).values(subtitlesWithVideoId);

        // Return the subtitles
        res.json(subtitlesWithVideoId);
      } catch (error: any) {
        console.error("Error processing audio:", error);
        
        // Handle specific error cases
        if (error.message?.includes("Maximum content size")) {
          res.status(413).json({ 
            error: "Video is too long. Please try a shorter video (max 30 minutes)." 
          });
        } else if (error.message?.includes("no suitable")) {
          res.status(400).json({ 
            error: "Could not download audio from this video. Please try another video." 
          });
        } else {
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
        text: z.string()
      })).parse(req.body);

      await db.insert(subtitles).values(subtitleData);
      res.status(201).json({ message: "Subtitles saved successfully" });
    } catch (error) {
      console.error("Error saving subtitles:", error);
      res.status(500).json({ error: "Failed to save subtitles" });
    }
  });
}
