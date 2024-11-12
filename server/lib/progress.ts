import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { AuthenticatedRequest } from '../auth';
import type { IncomingMessage } from 'http';

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
  private readonly HEARTBEAT_INTERVAL = 10000;
  private readonly HEARTBEAT_TIMEOUT = 30000;

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

  initializeWebSocket(server: Server, authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest | false>) {
    if (this.wss) {
      console.log('WebSocket server already initialized');
      return;
    }

    // Create WebSocket server with explicit configuration
    this.wss = new WebSocketServer({
      noServer: true,
      clientTracking: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
      }
    });

    // Handle upgrade requests
    server.on('upgrade', async (request, socket, head) => {
      if (!request.url?.startsWith('/api/ws/progress')) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const authResult = await authenticate(request);
        if (!authResult) {
          console.error('WebSocket authentication failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Store authenticated user info in the request object
        Object.assign(request, {
          user: authResult.user,
          session: authResult.session
        });

        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, authResult);
        });
      } catch (error) {
        console.error('WebSocket upgrade error:', error);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: AuthenticatedRequest) => {
      const userId = req.user?.id;
      console.log('[WebSocket] New connection established for user:', userId);

      // Set up heartbeat handling
      this.handleHeartbeat(ws);

      // Send initial progress state if available
      this.progressMap.forEach((progress) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: 'progress',
              ...progress
            }));
          } catch (error) {
            console.error('[WebSocket] Error sending initial progress:', error);
          }
        }
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'ping') {
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now(),
              userId
            }));
            this.handleHeartbeat(ws);
          }

          if (message.type === 'init' && message.videoId) {
            const progress = this.progressMap.get(message.videoId);
            if (progress) {
              ws.send(JSON.stringify({
                type: 'progress',
                ...progress
              }));
            }
          }
        } catch (error) {
          console.error('[WebSocket] Error handling message:', error);
        }
      });

      // Setup heartbeat ping interval
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (error) {
            console.error('[WebSocket] Error sending ping:', error);
            clearInterval(heartbeatInterval);
            this.cleanup(ws);
          }
        } else {
          clearInterval(heartbeatInterval);
          this.cleanup(ws);
        }
      }, this.HEARTBEAT_INTERVAL);

      // Handle connection close
      ws.on('close', () => {
        console.log(`[WebSocket] Connection closed for user ${userId}`);
        clearInterval(heartbeatInterval);
        this.cleanup(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket] Error for user ${userId}:`, error);
        clearInterval(heartbeatInterval);
        this.cleanup(ws);
      });
    });

    // Handle server errors
    this.wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });

    // Handle progress updates
    this.on('progress', (update: ProgressUpdate) => {
      this.progressMap.set(update.videoId, update);
      this.broadcast(JSON.stringify({
        type: 'progress',
        ...update
      }));
    });
  }

  private cleanup(ws: WebSocket) {
    if (this.clientHeartbeats.has(ws)) {
      clearTimeout(this.clientHeartbeats.get(ws)!);
      this.clientHeartbeats.delete(ws);
    }

    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, 'Normal closure');
      } catch (error) {
        console.error('Error closing WebSocket:', error);
        try {
          ws.terminate();
        } catch (terminateError) {
          console.error('Error terminating WebSocket:', terminateError);
        }
      }
    }
  }

  private broadcast(message: string) {
    if (!this.wss) return;

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting message:', error);
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