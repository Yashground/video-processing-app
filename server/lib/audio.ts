import { OpenAI } from 'openai';
import { createWriteStream, createReadStream } from 'fs';
import { unlink, stat } from 'fs/promises';
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
  const outputPath = join(process.cwd(), 'temp', `${videoId}.mp3`);
  
  try {
    await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      output: outputPath,
      maxFilesize: '25M',
      matchFilter: maxLength ? `duration <= ${maxLength}` : undefined,
      postprocessorArgs: ['-b:a', '64k'],
    });

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
    }
    
    throw error;
  }
}

async function splitAudio(audioPath: string): Promise<AudioSegment[]> {
  const segments: AudioSegment[] = [];
  const tempDir = join(process.cwd(), 'temp');
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, async (err, metadata) => {
      if (err) return reject(err);
      
      const duration = metadata.format.duration || 0;
      const numChunks = Math.ceil(duration / CHUNK_DURATION);
      
      try {
        for (let i = 0; i < numChunks; i++) {
          const startTime = i * CHUNK_DURATION;
          const segmentPath = join(tempDir, `${basename(audioPath, '.mp3')}_${i}.mp3`);
          
          await new Promise<void>((res, rej) => {
            ffmpeg(audioPath)
              .setStartTime(startTime)
              .setDuration(CHUNK_DURATION)
              .output(segmentPath)
              .audioCodec('libmp3lame')
              .audioBitrate('64k')
              .on('end', () => res())
              .on('error', rej)
              .run();
          });
          
          segments.push({ path: segmentPath, startTime: startTime * 1000 }); // Convert to milliseconds
        }
        
        resolve(segments);
      } catch (error) {
        console.error('Error splitting audio:', error);
        // Clean up any created segments
        segments.forEach(segment => unlink(segment.path).catch(() => {}));
        reject(error);
      }
    });
  });
}

export async function transcribeAudio(audioPath: string): Promise<Array<{start: number, end: number, text: string}>> {
  try {
    const stats = await stat(audioPath);
    const fileSize = stats.size;
    
    if (fileSize > MAX_CHUNK_SIZE) {
      // Split audio into chunks and process each chunk
      const segments = await splitAudio(audioPath);
      let allSubtitles: Array<{start: number, end: number, text: string}> = [];
      
      for (const segment of segments) {
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
        
        // Clean up segment file
        await unlink(segment.path).catch(console.error);
      }
      
      // Clean up original file
      await unlink(audioPath).catch(console.error);
      
      return allSubtitles;
    } else {
      // Process single file
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json"
      });
      
      await unlink(audioPath).catch(console.error);
      
      if (!transcription.segments) {
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
    await unlink(audioPath).catch(console.error);
    throw error;
  }
}
