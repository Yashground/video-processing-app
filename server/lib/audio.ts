import { OpenAI } from 'openai';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import youtubeDl from 'youtube-dl-exec';
import { createReadStream } from 'fs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function downloadAudio(videoId: string): Promise<string> {
  const outputPath = join(process.cwd(), 'temp', `${videoId}.mp3`);
  
  await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
    extractAudio: true,
    audioFormat: 'mp3',
    output: outputPath
  });

  return outputPath;
}

export async function transcribeAudio(audioPath: string): Promise<Array<{start: number, end: number, text: string}>> {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json"
    });

    // Clean up the audio file
    await unlink(audioPath).catch(console.error);

    return transcription.segments.map(segment => ({
      start: Math.floor(segment.start * 1000),
      end: Math.floor(segment.end * 1000),
      text: segment.text.trim()
    }));
  } catch (error) {
    console.error('Transcription error:', error);
    throw error;
  }
}
