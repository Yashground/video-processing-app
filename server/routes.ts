import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXML = promisify(parseString);
const youtube = google.youtube('v3');

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

      // If not in database, fetch from YouTube
      const response = await youtube.captions.list({
        key: process.env.YOUTUBE_API_KEY,
        part: ['snippet'],
        videoId: videoId
      });

      if (!response.data.items || response.data.items.length === 0) {
        return res.status(404).json({ error: "No subtitles found for this video" });
      }

      // Get the first English caption track or the first available track
      const captionTrack = response.data.items.find(item => 
        item.snippet?.language === 'en'
      ) || response.data.items[0];

      if (!captionTrack || !captionTrack.id) {
        return res.status(404).json({ error: "No suitable caption track found" });
      }

      // Download the caption track
      const captions = await youtube.captions.download({
        key: process.env.YOUTUBE_API_KEY,
        id: captionTrack.id
      });

      // Parse the XML captions
      const parsedXml = await parseXML(captions.data);
      const captionElements = parsedXml.transcript.text;
      
      // Transform captions into our format
      const subtitleData = captionElements.map((caption: any) => ({
        videoId,
        start: Math.floor(parseFloat(caption.$.start) * 1000),
        end: Math.floor((parseFloat(caption.$.start) + parseFloat(caption.$.dur)) * 1000),
        text: caption._
      }));

      // Save to database
      await db.insert(subtitles).values(subtitleData);

      // Return the subtitles
      res.json(subtitleData);
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
