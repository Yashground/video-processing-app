# YouTube Language Learning Platform

## Overview
A language learning platform that leverages YouTube content for subtitle-based study. Process videos to extract subtitles, generate summaries, and track learning progress.

## Features
- YouTube video processing and subtitle extraction
- AI-powered text summarization
- Multi-language support with translation capabilities
- History tracking with thumbnail previews
- Responsive UI with dark mode support

## Prerequisites
- Node.js 18+ and npm
- PostgreSQL database
- OpenAI API key (for transcription and summarization)
- YouTube Data API key (for video metadata)

## Environment Variables
```env
DATABASE_URL=postgresql://user:password@host:port/dbname
OPENAI_API_KEY=your_openai_api_key
YOUTUBE_API_KEY=your_youtube_api_key
```

## Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables in your `.env` file
4. Initialize database: `npm run db:push`
5. Start development server: `npm run dev`

## Usage
1. Enter a YouTube URL (supports youtube.com/watch?v= and youtu.be/ formats)
2. Wait for audio processing and transcription
3. View transcribed text and generated summary
4. Use the translation panel for multi-language support
5. Access video history in the sidebar

## API Documentation

### GET /api/videos
Retrieves the history of processed videos with metadata.

Response:
```json
[
  {
    "videoId": "string",
    "title": "string",
    "thumbnailUrl": "string",
    "createdAt": "string"
  }
]
```

### GET /api/subtitles/:videoId
Fetches or generates subtitles for a specific video.

Response:
```json
[
  {
    "start": "number",
    "end": "number",
    "text": "string",
    "language": "string"
  }
]
```

### POST /api/summarize
Generates an AI-powered summary of the provided text.

Request:
```json
{
  "text": "string"
}
```

Response:
```json
{
  "summary": "string"
}
```

## Technologies Used
- Frontend:
  - React with TypeScript
  - Tailwind CSS for styling
  - shadcn/ui component library
  - SWR for data fetching
  - wouter for routing
- Backend:
  - Express.js server
  - PostgreSQL with Drizzle ORM
  - FFmpeg for audio processing
- APIs:
  - OpenAI Whisper API for transcription
  - OpenAI GPT-3.5 for summarization
  - YouTube Data API for video metadata
  - LibreTranslate for translations

## License
MIT License

Copyright (c) 2024 YouTube Language Learning Platform

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
