import { OpenAI } from 'openai';
import { createWriteStream, createReadStream } from 'fs';
import { unlink, stat, mkdir, access, constants } from 'fs/promises';
import { join, basename } from 'path';
import youtubeDl from 'youtube-dl-exec';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { PassThrough, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { VideoCache } from './cache';
import { TranscriptionResult } from './types';
import { AppError, retryOperation } from './error';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuration constants
const MAX_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB for optimal OpenAI API performance
const MAX_VIDEO_DURATION = 7200; // 2 hours in seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const BUFFER_SIZE = 1024 * 1024; // 1MB buffer size for streaming

// Smart chunking configuration
const CHUNK_SIZE_CONFIG = {
  SHORT: { duration: 200, parallel: 2 },    // 0-15 minutes
  MEDIUM: { duration: 300, parallel: 4 },   // 15-45 minutes
  LONG: { duration: 400, parallel: 6 },     // 45-90 minutes
  EXTENDED: { duration: 500, parallel: 8 }  // 90+ minutes
};

interface AudioSegment {
  path: string;
  startTime: number;
}

// Get chunk configuration based on video duration
function getChunkConfig(duration: number) {
  if (duration <= 900) { // 15 minutes
    return CHUNK_SIZE_CONFIG.SHORT;
  } else if (duration <= 2700) { // 45 minutes
    return CHUNK_SIZE_CONFIG.MEDIUM;
  } else if (duration <= 5400) { // 90 minutes
    return CHUNK_SIZE_CONFIG.LONG;
  } else {
    return CHUNK_SIZE_CONFIG.EXTENDED;
  }
}

// Clean up function with improved error handling
async function cleanupFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
    await unlink(filePath);
    console.log(`Cleaned up file: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Failed to cleanup file ${filePath}:`, error);
    }
  }
}

// Ensure temp directory exists and is writable
async function ensureTempDir(dir: string): Promise<void> {
  try {
    await access(dir, constants.W_OK);
  } catch (error) {
    console.log(`Creating temp directory: ${dir}`);
    await mkdir(dir, { recursive: true, mode: 0o777 });
    await access(dir, constants.W_OK);
  }
}

export async function downloadAudio(videoId: string, maxLength?: number): Promise<string> {
  const tempDir = join(process.cwd(), 'temp');
  await ensureTempDir(tempDir);
  
  const audioPath = join(tempDir, `${videoId}.mp3`);
  await cleanupFile(audioPath);
  
  console.log(`[1/2] Starting download for video ${videoId}`);
  
  try {
    await retryOperation(async () => {
      await youtubeDl.exec(`https://www.youtube.com/watch?v=${videoId}`, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0,
        output: audioPath,
        maxFilesize: '100M',
        matchFilter: maxLength ? `duration <= ${maxLength}` : `duration <= ${MAX_VIDEO_DURATION}`,
        noWarnings: true,
        addHeader: [
          'referer:youtube.com',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
        ]
      });
    }, 3, 2000);

    console.log('[2/2] Download complete, verifying file');

    const stats = await stat(audioPath);
    if (stats.size === 0) {
      throw new AppError(400, 'Downloaded audio file is empty - the video might be unavailable or private');
    }

    if (stats.size < 1024) {
      throw new AppError(400, 'Downloaded audio file is too small - the video might be corrupted or restricted');
    }

    console.log(`Audio download complete (${stats.size} bytes)`);
    return audioPath;
  } catch (error) {
    await cleanupFile(audioPath);
    
    if (error instanceof AppError) throw error;
    
    let errorMessage = 'Failed to download audio: ';
    if (error instanceof Error) {
      if (error.message.includes('Video unavailable')) {
        throw new AppError(404, 'The video is unavailable or private');
      } else if (error.message.includes('maxFilesize')) {
        throw new AppError(400, 'The video file is too large (max 100MB)');
      } else if (error.message.includes('duration')) {
        throw new AppError(400, 'The video is too long (max 2 hours)');
      } else {
        throw new AppError(500, error.message);
      }
    }
    
    throw new AppError(500, 'Unknown error occurred during download');
  }
}

export async function splitAudio(audioPath: string): Promise<AudioSegment[]> {
  const segments: AudioSegment[] = [];
  const tempDir = join(process.cwd(), 'temp');
  await ensureTempDir(tempDir);
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, async (err, metadata) => {
      if (err) {
        console.error('Error probing audio file:', err);
        return reject(new AppError(500, 'Failed to analyze audio file'));
      }
      
      const duration = metadata.format.duration || 0;
      const chunkConfig = getChunkConfig(duration);
      const numChunks = Math.ceil(duration / chunkConfig.duration);
      
      console.log(`Using chunk configuration: ${chunkConfig.duration}s chunks with ${chunkConfig.parallel} parallel processes`);
      
      try {
        const chunkPromises = Array.from({ length: numChunks }, async (_, i) => {
          const startTime = i * chunkConfig.duration;
          const segmentPath = join(tempDir, `${basename(audioPath, '.mp3')}_${i}.mp3`);
          
          await cleanupFile(segmentPath);
          
          await retryOperation(async () => {
            await new Promise<void>((res, rej) => {
              ffmpeg(audioPath)
                .setStartTime(startTime)
                .setDuration(Math.min(chunkConfig.duration, duration - startTime))
                .audioFrequency(16000)
                .audioChannels(1)
                .audioBitrate('128k')
                .outputOptions(['-acodec', 'libmp3lame'])
                .output(segmentPath)
                .on('end', () => res())
                .on('error', (err) => rej(new AppError(500, `Failed to process audio segment: ${err.message}`)))
                .run();
            });
          });
          
          const stats = await stat(segmentPath);
          if (stats.size === 0) {
            throw new AppError(500, `Generated segment file is empty: ${segmentPath}`);
          }
          
          return { path: segmentPath, startTime: startTime * 1000 };
        });

        // Process chunks in parallel with dynamic limit
        const results = [];
        for (let i = 0; i < chunkPromises.length; i += chunkConfig.parallel) {
          const batch = chunkPromises.slice(i, i + chunkConfig.parallel);
          const batchResults = await Promise.all(batch);
          results.push(...batchResults);
        }
        
        resolve(results.sort((a, b) => a.startTime - b.startTime));
      } catch (error) {
        console.error('Error splitting audio:', error);
        await Promise.all(segments.map(segment => cleanupFile(segment.path)));
        reject(error instanceof AppError ? error : new AppError(500, 'Failed to split audio file'));
      }
    });
  });
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult[]> {
  const videoId = basename(audioPath, '.mp3');
  const cache = VideoCache.getInstance();
  
  try {
    const cachedResults = await cache.getCached(videoId);
    if (cachedResults) {
      console.log('Using cached transcription results');
      return cachedResults;
    }

    let transcriptionLanguage: string | undefined;
    let allSubtitles: TranscriptionResult[] = [];
    
    const stats = await stat(audioPath);
    const fileSize = stats.size;
    
    if (fileSize > MAX_CHUNK_SIZE) {
      const segments = await splitAudio(audioPath);
      const chunkConfig = await new Promise<{ parallel: number }>((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
          if (err) reject(new AppError(500, 'Failed to analyze audio file'));
          const duration = metadata.format.duration || 0;
          resolve(getChunkConfig(duration));
        });
      });
      
      for (let i = 0; i < segments.length; i += chunkConfig.parallel) {
        const batch = segments.slice(i, i + chunkConfig.parallel);
        const batchResults = await Promise.all(batch.map(async segment => {
          try {
            const transcription = await retryOperation(async () => {
              return await openai.audio.transcriptions.create({
                file: createReadStream(segment.path),
                model: "whisper-1",
                response_format: "verbose_json",
                language: transcriptionLanguage
              });
            });
            
            if (!transcriptionLanguage && transcription.language) {
              transcriptionLanguage = transcription.language;
              console.log(`Detected language: ${transcriptionLanguage}`);
            }
            
            return transcription.segments?.map(seg => ({
              start: Math.floor(seg.start * 1000) + segment.startTime,
              end: Math.floor(seg.end * 1000) + segment.startTime,
              text: seg.text.trim(),
              language: transcriptionLanguage
            })) || [];
          } finally {
            await cleanupFile(segment.path);
          }
        }));
        
        allSubtitles = [...allSubtitles, ...batchResults.flat()];
      }
    } else {
      const transcription = await retryOperation(async () => {
        return await openai.audio.transcriptions.create({
          file: createReadStream(audioPath),
          model: "whisper-1",
          response_format: "verbose_json"
        });
      });
      
      transcriptionLanguage = transcription.language;
      console.log(`Detected language: ${transcriptionLanguage}`);
      
      if (!transcription.segments || transcription.segments.length === 0) {
        throw new AppError(500, 'No transcription segments found');
      }
      
      allSubtitles = transcription.segments.map(segment => ({
        start: Math.floor(segment.start * 1000),
        end: Math.floor(segment.end * 1000),
        text: segment.text.trim(),
        language: transcriptionLanguage
      }));
    }
    
    await cleanupFile(audioPath);
    
    if (allSubtitles.length === 0) {
      throw new AppError(500, 'No transcription segments generated');
    }

    await cache.setCached(videoId, allSubtitles);
    
    return allSubtitles;
  } catch (error) {
    console.error('Transcription error:', error);
    await cleanupFile(audioPath);
    throw error instanceof AppError ? error : new AppError(500, 'Failed to transcribe audio');
  }
}
