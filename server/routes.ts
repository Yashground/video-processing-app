import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
import { eq } from "drizzle-orm";
import { downloadAudio, transcribeAudio } from "./lib/audio";
import { mkdir } from "fs/promises";
import { join } from "path";

// Ensure temp directory exists
mkdir(join(process.cwd(), 'temp')).catch(() => {});

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
        // Download audio
        const audioPath = await downloadAudio(videoId);
        
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
      } catch (error) {
        console.error("Error processing audio:", error);
        res.status(500).json({ error: "Failed to process audio" });
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