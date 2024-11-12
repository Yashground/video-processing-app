import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { subtitles } from "../db/schema";
import { eq, desc, sum } from "drizzle-orm";
import { downloadAudio, transcribeAudio } from "./lib/audio";
import { mkdir, unlink, access } from "fs/promises";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { OpenAI } from "openai";
import { VideoCache } from "./lib/cache";
import { AppError, handleError, withErrorHandler, retryOperation } from "./lib/error";
import { constants } from "fs";
import { processingQueue } from './lib/queue';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Authentication middleware
function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

// Ensure temp directory exists
const tempDir = join(process.cwd(), 'temp');
mkdir(tempDir, { recursive: true }).catch(err => {
  console.error('Error creating temp directory:', err);
});

const MAX_VIDEO_DURATION = 7200; // 2 hours in seconds
const AVG_READING_SPEED = 400; // words per minute

// Input validation schemas
const videoIdSchema = z.string().min(1).max(20);
const textSchema = z.string().min(1).max(25000);
const languageSchema = z.string().min(2).max(5);

async function getVideoMetadata(videoId: string) {
  return retryOperation(async () => {
    if (!process.env.YOUTUBE_API_KEY) {
      throw new AppError(500, 'YouTube API key is not configured');
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );

    if (!response.ok) {
      throw new AppError(response.status, `YouTube API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.items?.[0]) {
      throw new AppError(404, 'Video not found');
    }

    const snippet = data.items[0].snippet;
    return {
      title: snippet.title || 'Untitled Video',
      thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null
    };
  });
}

export function registerRoutes(app: Express) {
  // Get all videos with total time saved
  app.get("/api/videos", requireAuth, withErrorHandler(async (req, res) => {
    const videos = await db
      .select({
        videoId: subtitles.videoId,
        title: subtitles.title,
        thumbnailUrl: subtitles.thumbnailUrl,
        createdAt: subtitles.createdAt,
        timeSaved: subtitles.timeSaved
      })
      .from(subtitles)
      .where(eq(subtitles.userId, req.user!.id))
      .groupBy(subtitles.videoId, subtitles.title, subtitles.thumbnailUrl, subtitles.createdAt, subtitles.timeSaved)
      .orderBy(desc(subtitles.createdAt));

    const totalTimeSaved = await db
      .select({ total: sum(subtitles.timeSaved) })
      .from(subtitles)
      .where(eq(subtitles.userId, req.user!.id));

    const updatedVideos = await Promise.all(
      videos.map(async (video) => {
        if (!video.title) {
          try {
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
          } catch (error) {
            console.error(`Error updating metadata for video ${video.videoId}:`, error);
          }
        }
        return video;
      })
    );

    res.json({
      videos: updatedVideos,
      totalTimeSaved: totalTimeSaved[0]?.total || 0
    });
  }));

  // Export videos
  app.get("/api/videos/export", requireAuth, withErrorHandler(async (req, res) => {
    const allVideos = await db
      .select()
      .from(subtitles)
      .where(eq(subtitles.userId, req.user!.id))
      .orderBy(desc(subtitles.createdAt));

    const videoMap = allVideos.reduce((acc, subtitle) => {
      if (!acc[subtitle.videoId]) {
        acc[subtitle.videoId] = {
          videoId: subtitle.videoId,
          title: subtitle.title,
          createdAt: subtitle.createdAt,
          language: subtitle.language,
          subtitles: []
        };
      }
      acc[subtitle.videoId].subtitles.push({
        start: subtitle.start,
        end: subtitle.end,
        text: subtitle.text
      });
      return acc;
    }, {} as Record<string, any>);

    const exportData = {
      exportDate: new Date().toISOString(),
      videos: Object.values(videoMap)
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=video-history-export.json');
    res.json(exportData);
  }));

  // Clear all videos
  app.delete("/api/videos", requireAuth, withErrorHandler(async (req, res) => {
    await db.delete(subtitles).where(eq(subtitles.userId, req.user!.id));
    res.json({ message: "History cleared successfully" });
  }));

  // Get cache stats
  app.get("/api/cache/stats", requireAuth, withErrorHandler((req, res) => {
    const cache = VideoCache.getInstance();
    const stats = cache.getCacheStats();
    res.json({
      ...stats,
      totalSizeMB: Math.round(stats.totalSize / (1024 * 1024) * 100) / 100
    });
  }));

  // Delete cache entry
  app.delete("/api/cache/:videoId", requireAuth, withErrorHandler(async (req, res) => {
    const { videoId } = await z.object({ videoId: videoIdSchema }).parseAsync(req.params);
    const cache = VideoCache.getInstance();
    await cache.invalidateCache(videoId);
    res.json({ message: "Cache entry deleted successfully" });
  }));

  // Delete video
  app.delete("/api/videos/:videoId", requireAuth, withErrorHandler(async (req, res) => {
    const { videoId } = await z.object({ videoId: videoIdSchema }).parseAsync(req.params);
    const cache = VideoCache.getInstance();
    
    await Promise.all([
      db.delete(subtitles)
        .where(eq(subtitles.videoId, videoId))
        .where(eq(subtitles.userId, req.user!.id)),
      cache.invalidateCache(videoId)
    ]);
    
    res.json({ message: "Video deleted successfully" });
  }));

  // Generate summary
  app.post("/api/summarize", requireAuth, withErrorHandler(async (req, res) => {
    const { text } = await z.object({ text: textSchema }).parseAsync(req.body).catch(error => {
      if (error.issues?.[0]?.code === 'too_big') {
        throw new AppError(400, 'Text is too long for summarization. Maximum length is 25,000 characters.');
      }
      throw error;
    });

    const summary = await retryOperation(async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that creates detailed and informative summaries. Include key points, main ideas, and important details while maintaining clarity and coherence. Structure the summary with sections if appropriate."
            },
            {
              role: "user",
              content: `Please provide a concise summary of the following text:\n\n${text}`
            }
          ],
          temperature: 0.7,
          max_tokens: 1000
        });

        const summaryText = completion.choices[0]?.message?.content;
        if (!summaryText) throw new AppError(500, "No summary generated");
        return summaryText;
      } catch (error: any) {
        console.error('Summary generation error:', error);
        
        if (error.response?.status === 429) {
          throw new AppError(429, "Rate limit exceeded. Please try again later.");
        }
        
        if (error.response?.status === 400 && error.response?.data?.error?.includes('maximum context length')) {
          throw new AppError(400, "Text is too long for the current model. Please try with a shorter text.");
        }

        if (error.response?.status === 401) {
          throw new AppError(401, "API key error. Please contact support.");
        }

        throw new AppError(500, "Failed to generate summary. Please try again.");
      }
    }, 3, 2000);

    res.json({ summary });
  }));

  // Get subtitles
  app.get("/api/subtitles/:videoId", requireAuth, withErrorHandler(async (req, res) => {
    const { videoId } = await z.object({ videoId: videoIdSchema }).parseAsync(req.params);
    let audioPath: string | null = null;
    
    // First check if subtitles exist in database
    const existingSubtitles = await db.select()
      .from(subtitles)
      .where(eq(subtitles.videoId, videoId))
      .where(eq(subtitles.userId, req.user!.id))
      .orderBy(subtitles.start);

    if (existingSubtitles.length > 0) {
      // Update metadata if missing
      if (!existingSubtitles[0].title) {
        try {
          const metadata = await getVideoMetadata(videoId);
          await db
            .update(subtitles)
            .set({
              title: metadata.title,
              thumbnailUrl: metadata.thumbnailUrl
            })
            .where(eq(subtitles.videoId, videoId))
            .where(eq(subtitles.userId, req.user!.id));
          existingSubtitles.forEach(subtitle => {
            subtitle.title = metadata.title;
            subtitle.thumbnailUrl = metadata.thumbnailUrl;
          });
        } catch (error) {
          console.error(`Error updating metadata for video ${videoId}:`, error);
        }
      }
      return res.json(existingSubtitles);
    }

    try {
      // Check if video is already being processed
      if (processingQueue.isProcessing(videoId) || processingQueue.isQueued(videoId)) {
        const queueStatus = processingQueue.getQueueStatus();
        const position = processingQueue.getQueuePosition(videoId);
        
        return res.status(409).json({
          message: 'Video is already being processed',
          queuePosition: position,
          queueStatus: {
            ahead: position - 1,
            processing: queueStatus.processing,
            estimatedWaitTime: position * 2 // Rough estimate: 2 minutes per video
          }
        });
      }

      // Get video metadata before processing
      const metadata = await getVideoMetadata(videoId);

      // Add to processing queue with normal priority
      await processingQueue.enqueue(videoId, req.user!.id, 1);

      // Return accepted status with queue information
      const queueStatus = processingQueue.getQueueStatus();
      const position = processingQueue.getQueuePosition(videoId);
      
      return res.status(202).json({
        message: 'Video added to processing queue',
        queueStatus: {
          position,
          ahead: position - 1,
          processing: queueStatus.processing,
          estimatedWaitTime: position * 2 // Rough estimate: 2 minutes per video
        }
      });

    } catch (error) {
      console.error('Error processing video:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return res.status(500).json({
        error: errorMessage,
        message: 'Failed to process video'
      });
    }

    try {
      // Process video only when it reaches the front of the queue
      audioPath = await downloadAudio(videoId, MAX_VIDEO_DURATION);
      const subtitleData = await transcribeAudio(audioPath);
      
      // Calculate time saved
      const totalWords = subtitleData.reduce((sum, sub) => sum + sub.text.trim().split(/\s+/).length, 0);
      const readingTimeMinutes = totalWords / AVG_READING_SPEED;
      const videoDurationMinutes = subtitleData[subtitleData.length - 1].end / (1000 * 60);
      const timeSaved = Math.max(0, videoDurationMinutes - readingTimeMinutes);
      
      const subtitlesWithMetadata = subtitleData.map((sub, index) => ({
        ...sub,
        videoId,
        title: metadata.title,
        thumbnailUrl: metadata.thumbnailUrl,
        timeSaved: index === 0 ? timeSaved : 0,
        userId: req.user!.id
      }));

      await db.insert(subtitles).values(subtitlesWithMetadata);
      res.json(subtitlesWithMetadata);
    } finally {
      if (audioPath) {
        try {
          await access(audioPath, constants.F_OK);
          await unlink(audioPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error('Error cleaning up audio file:', error);
          }
        }
      }
    }
  }));

  // Translate text
  app.post("/api/translate", requireAuth, withErrorHandler(async (req, res) => {
    const { text, targetLanguage } = await z.object({
      text: textSchema,
      targetLanguage: languageSchema
    }).parseAsync(req.body);

    const translatedText = await retryOperation(async () => {
      const translation = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a translation assistant. Translate the following text to ${targetLanguage}. Keep the same meaning and tone, but make it natural in the target language.`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const result = translation.choices[0]?.message?.content;
      if (!result) throw new AppError(500, "No translation generated");
      return result;
    });

    res.json({ translatedText });
  }));

  // Get queue status
  app.get("/api/queue/status", requireAuth, withErrorHandler(async (req, res) => {
    const status = processingQueue.getQueueStatus();
    res.json(status);
  }));

  // Remove from queue (useful for cancellation)
  app.delete("/api/queue/:videoId", requireAuth, withErrorHandler(async (req, res) => {
    const { videoId } = await z.object({ videoId: videoIdSchema }).parseAsync(req.params);
    const removed = processingQueue.removeFromQueue(videoId);
    if (removed) {
      res.json({ message: 'Removed from queue successfully' });
    } else {
      res.status(404).json({ message: 'Video not found in queue' });
    }
  }));
}