import { OpenAI } from 'openai';
import { createWriteStream, createReadStream } from 'fs';
import { unlink, stat, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import youtubeDl from 'youtube-dl-exec';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB
const CHUNK_DURATION = 600; // 10 minutes in seconds

interface AudioSegment {
  path: string;
  startTime: number;
}

export async function downloadAudio(videoId: string, maxLength?: number): Promise<string> {
  const tempDir = join(process.cwd(), 'temp');
  await mkdir(tempDir, { recursive: true });
  
  const outputPath = join(tempDir, `${videoId}.mp3`);
  
  try {
    // Clean up any existing file
    await unlink(outputPath).catch(() => {});
    
    let attempts = 3;
    while (attempts > 0) {
      try {
        console.log(`Attempting to download audio for video ${videoId} (attempt ${4 - attempts}/3)`);
        
        await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
          extractAudio: true,
          audioFormat: 'mp3',
          audioQuality: 0,
          output: outputPath,
          maxFilesize: '25M',
          matchFilter: maxLength ? `duration <= ${maxLength}` : undefined,
          noWarnings: true,
          noCallHome: true,
          addHeader: [
            'referer:youtube.com',
            'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
          ]
        });
        
        // Verify file exists and is accessible
        const fileStats = await stat(outputPath);
        console.log(`Successfully downloaded audio: ${fileStats.size} bytes`);
        break;
      } catch (error) {
        attempts--;
        console.error(`Download attempt failed (${attempts} attempts remaining):`, error);
        if (attempts === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return outputPath;
  } catch (error: any) {
    console.error('Error downloading audio:', error);
    
    // Clean up any partially downloaded files
    await unlink(outputPath).catch(() => {});
    
    if (error.stderr?.includes('Video unavailable')) {
      throw new Error('Video is unavailable or private');
    } else if (error.stderr?.includes('maxFilesize')) {
      throw new Error('Video file is too large');
    } else if (error.stderr?.includes('duration')) {
      throw new Error('Video duration exceeds the maximum limit');
    } else if (error.stderr?.includes('copyright')) {
      throw new Error('Video is not accessible due to copyright restrictions');
    } else if (error.code === 'ENOENT') {
      throw new Error('Failed to save audio file');
    }
    
    throw new Error('Failed to download video audio');
  }
}

async function splitAudio(audioPath: string): Promise<AudioSegment[]> {
  const segments: AudioSegment[] = [];
  const tempDir = join(process.cwd(), 'temp');
  await mkdir(tempDir, { recursive: true });
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, async (err, metadata) => {
      if (err) {
        console.error('Error probing audio file:', err);
        return reject(err);
      }
      
      const duration = metadata.format.duration || 0;
      const numChunks = Math.ceil(duration / CHUNK_DURATION);
      
      try {
        for (let i = 0; i < numChunks; i++) {
          const startTime = i * CHUNK_DURATION;
          const segmentPath = join(tempDir, `${basename(audioPath, '.mp3')}_${i}.mp3`);
          
          // Clean up any existing segment file
          await unlink(segmentPath).catch(() => {});
          
          await new Promise<void>((res, rej) => {
            ffmpeg(audioPath)
              .setStartTime(startTime)
              .setDuration(CHUNK_DURATION)
              .output(segmentPath)
              .audioCodec('libmp3lame')
              .audioBitrate('64k')
              .on('end', () => res())
              .on('error', (err) => {
                console.error('Error creating segment:', err);
                rej(err);
              })
              .run();
          });
          
          // Verify segment file exists
          await stat(segmentPath);
          segments.push({ path: segmentPath, startTime: startTime * 1000 });
        }
        
        resolve(segments);
      } catch (error) {
        console.error('Error splitting audio:', error);
        // Clean up any created segments
        await Promise.all(segments.map(segment => unlink(segment.path).catch(() => {})));
        reject(error);
      }
    });
  });
}

export async function transcribeAudio(audioPath: string): Promise<Array<{start: number, end: number, text: string}>> {
  try {
    // Verify input file exists
    const stats = await stat(audioPath);
    const fileSize = stats.size;
    
    if (fileSize > MAX_CHUNK_SIZE) {
      // Split audio into chunks and process each chunk
      const segments = await splitAudio(audioPath);
      let allSubtitles: Array<{start: number, end: number, text: string}> = [];
      
      for (const segment of segments) {
        try {
          const transcription = await openai.audio.transcriptions.create({
            file: createReadStream(segment.path),
            model: "whisper-1",
            response_format: "verbose_json"
          });
          
          if (transcription.segments) {
            const subtitles = transcription.segments.map(seg => ({
              start: Math.floor(seg.start * 1000) + segment.startTime,
              end: Math.floor(seg.end * 1000) + segment.startTime,
              text: seg.text.trim()
            }));
            
            allSubtitles = [...allSubtitles, ...subtitles];
          }
        } catch (error) {
          console.error('Error transcribing segment:', error);
          throw error;
        } finally {
          // Clean up segment file
          await unlink(segment.path).catch(console.error);
        }
      }
      
      // Clean up original file
      await unlink(audioPath).catch(console.error);
      
      if (allSubtitles.length === 0) {
        throw new Error('No transcription segments generated');
      }
      
      return allSubtitles;
    } else {
      // Process single file
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json"
      });
      
      // Clean up original file
      await unlink(audioPath).catch(console.error);
      
      if (!transcription.segments || transcription.segments.length === 0) {
        throw new Error('No transcription segments found');
      }
      
      return transcription.segments.map(segment => ({
        start: Math.floor(segment.start * 1000),
        end: Math.floor(segment.end * 1000),
        text: segment.text.trim()
      }));
    }
  } catch (error) {
    console.error('Transcription error:', error);
    // Ensure cleanup of input file
    await unlink(audioPath).catch(console.error);
    throw error;
  }
}