import { OpenAI } from 'openai';
import { createWriteStream, createReadStream } from 'fs';
import { unlink, stat, mkdir, access, constants } from 'fs/promises';
import { join, basename } from 'path';
import youtubeDl from 'youtube-dl-exec';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { PassThrough, Transform } from 'stream';
import { pipeline } from 'stream/promises';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Optimized chunk sizes and processing configurations
const MAX_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB for optimal OpenAI API performance
const CHUNK_DURATION = 300; // 5 minutes in seconds for faster parallel processing
const MAX_VIDEO_DURATION = 7200; // 2 hours in seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const PARALLEL_LIMIT = 4;
const CACHE_SIZE = 10;
const BUFFER_SIZE = 1024 * 1024; // 1MB buffer size for streaming

// Simple in-memory LRU cache for processed segments
class SegmentCache {
  private cache: Map<string, TranscriptionResult[]>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: string): TranscriptionResult[] | undefined {
    const value = this.cache.get(key);
    if (value) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: TranscriptionResult[]): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const segmentCache = new SegmentCache(CACHE_SIZE);

interface AudioSegment {
  path: string;
  startTime: number;
}

interface TranscriptionResult {
  start: number;
  end: number;
  text: string;
  language?: string;
}

// Utility function for exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying operation, ${retries} attempts remaining...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
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
    // Download with direct file output
    await withRetry(async () => {
      await youtubeDl.exec(`https://www.youtube.com/watch?v=${videoId}`, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0, // Best quality
        output: audioPath,
        maxFilesize: '100M',
        matchFilter: maxLength ? `duration <= ${maxLength}` : `duration <= ${MAX_VIDEO_DURATION}`,
        noWarnings: true,
        addHeader: [
          'referer:youtube.com',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
        ]
      });
    });

    console.log('[2/2] Download complete, verifying file');

    // Verify the output file
    const stats = await stat(audioPath);
    if (stats.size === 0) {
      throw new Error('Downloaded audio file is empty - the video might be unavailable or private');
    }

    if (stats.size < 1024) { // Less than 1KB
      throw new Error('Downloaded audio file is too small - the video might be corrupted or restricted');
    }

    console.log(`Audio download complete (${stats.size} bytes)`);
    return audioPath;
  } catch (error) {
    await cleanupFile(audioPath);
    
    // Enhance error message based on the error type
    let errorMessage = 'Failed to download audio: ';
    if (error instanceof Error) {
      if (error.message.includes('Video unavailable')) {
        errorMessage += 'The video is unavailable or private';
      } else if (error.message.includes('maxFilesize')) {
        errorMessage += 'The video file is too large (max 100MB)';
      } else if (error.message.includes('duration')) {
        errorMessage += 'The video is too long (max 2 hours)';
      } else {
        errorMessage += error.message;
      }
    } else {
      errorMessage += 'Unknown error occurred';
    }
    
    console.error('Error in audio download:', errorMessage);
    throw new Error(errorMessage);
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
        return reject(err);
      }
      
      const duration = metadata.format.duration || 0;
      const numChunks = Math.ceil(duration / CHUNK_DURATION);
      
      try {
        const chunkPromises = Array.from({ length: numChunks }, async (_, i) => {
          const startTime = i * CHUNK_DURATION;
          const segmentPath = join(tempDir, `${basename(audioPath, '.mp3')}_${i}.mp3`);
          
          await cleanupFile(segmentPath);
          
          await new Promise<void>((res, rej) => {
            ffmpeg(audioPath)
              .setStartTime(startTime)
              .setDuration(Math.min(CHUNK_DURATION, duration - startTime))
              .audioFrequency(16000)
              .audioChannels(1)
              .audioBitrate('128k')
              .outputOptions(['-acodec', 'libmp3lame'])
              .output(segmentPath)
              .on('end', () => res())
              .on('error', (err) => {
                console.error('Error creating segment:', err);
                rej(err);
              })
              .run();
          });
          
          const stats = await stat(segmentPath);
          if (stats.size === 0) {
            throw new Error(`Generated segment file is empty: ${segmentPath}`);
          }
          
          return { path: segmentPath, startTime: startTime * 1000 };
        });

        // Process chunks in parallel with increased limit
        const results = [];
        for (let i = 0; i < chunkPromises.length; i += PARALLEL_LIMIT) {
          const batch = chunkPromises.slice(i, i + PARALLEL_LIMIT);
          const batchResults = await Promise.all(batch);
          results.push(...batchResults);
        }
        
        resolve(results.sort((a, b) => a.startTime - b.startTime));
      } catch (error) {
        console.error('Error splitting audio:', error);
        await Promise.all(segments.map(segment => cleanupFile(segment.path)));
        reject(error);
      }
    });
  });
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult[]> {
  try {
    const stats = await stat(audioPath);
    const fileSize = stats.size;
    
    // Check cache first
    const cacheKey = `${audioPath}_${fileSize}`;
    const cachedResults = segmentCache.get(cacheKey);
    if (cachedResults) {
      console.log('Using cached transcription results');
      return cachedResults;
    }

    let transcriptionLanguage: string | undefined;
    let allSubtitles: TranscriptionResult[] = [];
    
    if (fileSize > MAX_CHUNK_SIZE) {
      const segments = await splitAudio(audioPath);
      
      // Process segments in parallel with increased limit
      for (let i = 0; i < segments.length; i += PARALLEL_LIMIT) {
        const batch = segments.slice(i, i + PARALLEL_LIMIT);
        const batchResults = await Promise.all(batch.map(async segment => {
          try {
            const transcription = await withRetry(async () => {
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
      const transcription = await withRetry(async () => {
        return await openai.audio.transcriptions.create({
          file: createReadStream(audioPath),
          model: "whisper-1",
          response_format: "verbose_json"
        });
      });
      
      transcriptionLanguage = transcription.language;
      console.log(`Detected language: ${transcriptionLanguage}`);
      
      if (!transcription.segments || transcription.segments.length === 0) {
        throw new Error('No transcription segments found');
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
      throw new Error('No transcription segments generated');
    }

    // Cache the results
    segmentCache.set(cacheKey, allSubtitles);
    
    return allSubtitles;
  } catch (error) {
    console.error('Transcription error:', error);
    await cleanupFile(audioPath);
    throw error;
  }
}