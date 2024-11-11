import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';

export interface ProgressUpdate {
  videoId: string;
  stage: 'download' | 'processing' | 'transcription';
  progress: number;
  message?: string;
  error?: string;
}

class ProgressTracker extends EventEmitter {
  private static instance: ProgressTracker;
  private wss: WebSocketServer | null = null;
  private progressMap: Map<string, ProgressUpdate> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): ProgressTracker {
    if (!ProgressTracker.instance) {
      ProgressTracker.instance = new ProgressTracker();
    }
    return ProgressTracker.instance;
  }

  initializeWebSocket(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/progress'
    });
    
    this.wss.on('connection', (ws) => {
      console.log('Client connected to progress WebSocket');
      
      // Send current progress for all active tasks
      this.progressMap.forEach((progress) => {
        ws.send(JSON.stringify(progress));
      });

      ws.on('error', console.error);
    });

    this.on('progress', (update: ProgressUpdate) => {
      this.progressMap.set(update.videoId, update);
      this.broadcast(update);
    });
  }

  private broadcast(update: ProgressUpdate) {
    if (!this.wss) return;
    
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify(update));
      }
    });
  }

  updateProgress(videoId: string, stage: ProgressUpdate['stage'], progress: number, message?: string) {
    const update: ProgressUpdate = {
      videoId,
      stage,
      progress,
      message
    };
    
    this.emit('progress', update);
  }

  reportError(videoId: string, error: string) {
    const update: ProgressUpdate = {
      videoId,
      stage: 'processing',
      progress: 0,
      error
    };
    
    this.emit('progress', update);
    this.progressMap.delete(videoId);
  }

  clearProgress(videoId: string) {
    this.progressMap.delete(videoId);
  }
}

export const progressTracker = ProgressTracker.getInstance();
