import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
import { eq } from "drizzle-orm";
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

export function registerRoutes(app: Express) {
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

      // If not in database, process audio and generate subtitles
      try {
        // Download audio with max duration limit
        audioPath = await downloadAudio(videoId, MAX_VIDEO_DURATION);
        console.log(`Successfully downloaded audio to ${audioPath}`);
        
        // Generate transcription using Whisper
        const subtitleData = await transcribeAudio(audioPath);
        console.log(`Successfully generated transcription with ${subtitleData.length} segments in ${subtitleData[0]?.language || 'unknown'} language`);
        
        // Add videoId to each subtitle
        const subtitlesWithVideoId = subtitleData.map(sub => ({
          ...sub,
          videoId
        }));

        // Save to database
        await db.insert(subtitles).values(subtitlesWithVideoId);
        console.log(`Successfully saved subtitles to database`);

        // Return the subtitles
        res.json(subtitlesWithVideoId);
      } catch (error: any) {
        console.error("Error processing audio:", error);
        
        // Clean up any incomplete downloads
        if (audioPath) {
          await unlink(audioPath).catch(err => {
            console.error("Error cleaning up audio file:", err);
          });
        }
        
        // Handle specific error cases with improved messages
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