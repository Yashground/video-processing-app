import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

export interface ProgressUpdate {
  videoId: string;
  stage: 'download' | 'processing' | 'transcription' | 'initialization' | 'analysis' | 'cleanup';
  progress: number;
  message?: string;
  error?: string;
  substage?: string;
}

class ProgressTracker extends EventEmitter {
  private static instance: ProgressTracker;
  private wss: WebSocketServer | null = null;
  private progressMap: Map<string, ProgressUpdate> = new Map();
  private clientHeartbeats: Map<WebSocket, NodeJS.Timeout> = new Map();
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly HEARTBEAT_TIMEOUT = 35000;

  private constructor() {
    super();
  }

  static getInstance(): ProgressTracker {
    if (!ProgressTracker.instance) {
      ProgressTracker.instance = new ProgressTracker();
    }
    return ProgressTracker.instance;
  }

  private handleHeartbeat(ws: WebSocket) {
    if (this.clientHeartbeats.has(ws)) {
      clearTimeout(this.clientHeartbeats.get(ws)!);
    }

    this.clientHeartbeats.set(ws, setTimeout(() => {
      console.log('Client heartbeat timeout, closing connection');
      ws.terminate();
    }, this.HEARTBEAT_TIMEOUT));
  }

  initializeWebSocket(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/progress'
    });
    
    this.wss.on('connection', (ws) => {
      console.log('Client connected to progress WebSocket');
      
      // Set up heartbeat for this connection
      this.handleHeartbeat(ws);
      
      // Send current progress for all active tasks
      this.progressMap.forEach((progress) => {
        ws.send(JSON.stringify(progress));
      });

      ws.on('pong', () => {
        this.handleHeartbeat(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.cleanup(ws);
      });

      ws.on('close', () => {
        console.log('Client disconnected from progress WebSocket');
        this.cleanup(ws);
      });

      // Start heartbeat interval
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(heartbeatInterval);
        }
      }, this.HEARTBEAT_INTERVAL);
    });

    this.on('progress', (update: ProgressUpdate) => {
      this.progressMap.set(update.videoId, update);
      this.broadcast(update);
    });
  }

  private cleanup(ws: WebSocket) {
    if (this.clientHeartbeats.has(ws)) {
      clearTimeout(this.clientHeartbeats.get(ws)!);
      this.clientHeartbeats.delete(ws);
    }
  }

  private broadcast(update: ProgressUpdate) {
    if (!this.wss) return;
    
    const message = JSON.stringify(update);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting progress update:', error);
          this.cleanup(client);
        }
      }
    });
  }

  updateProgress(
    videoId: string, 
    stage: ProgressUpdate['stage'], 
    progress: number, 
    message?: string,
    substage?: string
  ) {
    const update: ProgressUpdate = {
      videoId,
      stage,
      progress,
      message,
      substage
    };
    
    this.emit('progress', update);
  }

  reportError(videoId: string, error: string, stage?: ProgressUpdate['stage']) {
    const update: ProgressUpdate = {
      videoId,
      stage: stage || 'processing',
      progress: 0,
      error
    };
    
    this.emit('progress', update);
    this.progressMap.delete(videoId);
  }

  clearProgress(videoId: string) {
    this.progressMap.delete(videoId);
  }

  getProgress(videoId: string): ProgressUpdate | undefined {
    return this.progressMap.get(videoId);
  }
}

export const progressTracker = ProgressTracker.getInstance();
