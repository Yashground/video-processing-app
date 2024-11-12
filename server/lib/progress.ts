import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { AuthenticatedRequest } from '../auth';

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
  private readonly MAX_RETRIES = 3;

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
      this.cleanup(ws);
    }, this.HEARTBEAT_TIMEOUT));
  }

  initializeWebSocket(server: Server, authenticate: (request: any) => Promise<AuthenticatedRequest | false>) {
    if (this.wss) {
      console.log('WebSocket server already initialized');
      return;
    }

    this.wss = new WebSocketServer({
      server,
      path: '/progress',
      clientTracking: true
    });

    this.wss.on('connection', async (ws, req) => {
      console.log('New WebSocket connection attempt');
      
      try {
        const authResult = await authenticate(req);
        if (!authResult) {
          console.log('WebSocket authentication failed');
          ws.close(1008, 'Authentication failed');
          return;
        }

        console.log('Client authenticated and connected to progress WebSocket');
        
        // Set up heartbeat handling
        this.handleHeartbeat(ws);
        
        // Send initial progress state
        this.progressMap.forEach((progress) => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify(progress));
            } catch (error) {
              console.error('Error sending initial progress:', error);
            }
          }
        });

        ws.on('pong', () => {
          this.handleHeartbeat(ws);
        });

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
              this.handleHeartbeat(ws);
            }
          } catch (error) {
            console.error('Error handling WebSocket message:', error);
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.cleanup(ws);
        });

        ws.on('close', (code, reason) => {
          console.log(`Client disconnected from progress WebSocket: ${code} - ${reason}`);
          this.cleanup(ws);
        });

        // Setup heartbeat interval
        const heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.ping();
            } catch (error) {
              console.error('Error sending ping:', error);
              clearInterval(heartbeatInterval);
              this.cleanup(ws);
            }
          } else {
            clearInterval(heartbeatInterval);
          }
        }, this.HEARTBEAT_INTERVAL);

        ws.on('close', () => clearInterval(heartbeatInterval));

      } catch (error) {
        console.error('Error in WebSocket connection:', error);
        ws.close(1011, 'Internal Server Error');
      }
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    // Handle progress updates
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
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, 'Normal Closure');
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
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
