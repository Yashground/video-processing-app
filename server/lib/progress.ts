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

interface WebSocketWithId extends WebSocket {
  id?: string;
  isAlive?: boolean;
  userId?: string;
}

class ProgressTracker extends EventEmitter {
  private static instance: ProgressTracker;
  private wss: WebSocketServer | null = null;
  private progressMap: Map<string, ProgressUpdate> = new Map();
  private clientHeartbeats: Map<WebSocket, NodeJS.Timeout> = new Map();
  private readonly HEARTBEAT_INTERVAL = 10000;
  private readonly HEARTBEAT_TIMEOUT = 30000;
  private readonly MAX_CLIENTS_PER_USER = 5;
  private userConnections: Map<string, Set<WebSocketWithId>> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): ProgressTracker {
    if (!ProgressTracker.instance) {
      ProgressTracker.instance = new ProgressTracker();
    }
    return ProgressTracker.instance;
  }

  private handleHeartbeat(ws: WebSocketWithId) {
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

    this.wss = new WebSocketServer({
      server,
      path: '/api/ws/progress',
      verifyClient: async (info, callback) => {
        try {
          console.log('Verifying WebSocket client connection');
          const authResult = await authenticate(info.req);
          
          if (!authResult) {
            console.error('WebSocket authentication failed');
            callback(false, 401, 'Unauthorized');
            return;
          }

          // Check connection limit per user
          const userId = authResult.user?.id;
          const userConnections = this.userConnections.get(userId) || new Set();
          if (userConnections.size >= this.MAX_CLIENTS_PER_USER) {
            callback(false, 429, 'Too many connections');
            return;
          }

          // Store authenticated user info in the request object
          Object.assign(info.req, {
            user: authResult.user,
            session: authResult.session
          });

          callback(true);
        } catch (error) {
          console.error('WebSocket authentication error:', error);
          callback(false, 500, 'Internal Server Error');
        }
      }
    });

    this.wss.on('connection', (ws: WebSocketWithId, req: AuthenticatedRequest) => {
      const userId = req.user?.id;
      console.log('New WebSocket connection established for user:', userId);

      // Set up connection tracking
      ws.id = Math.random().toString(36).substring(2, 15);
      ws.userId = userId;
      ws.isAlive = true;

      // Add to user connections
      if (userId) {
        if (!this.userConnections.has(userId)) {
          this.userConnections.set(userId, new Set());
        }
        this.userConnections.get(userId)?.add(ws);
      }

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
            console.error('Error sending initial progress:', error);
          }
        }
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
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
          console.error('Error handling WebSocket message:', error);
        }
      });

      // Setup heartbeat ping interval
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
          this.cleanup(ws);
        }
      }, this.HEARTBEAT_INTERVAL);

      // Handle connection close
      ws.on('close', () => {
        console.log(`WebSocket connection closed for user ${userId}`);
        clearInterval(heartbeatInterval);
        this.cleanup(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for user ${userId}:`, error);
        clearInterval(heartbeatInterval);
        this.cleanup(ws);
      });
    });

    // Handle server errors
    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
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

  private cleanup(ws: WebSocketWithId) {
    // Remove from heartbeat tracking
    if (this.clientHeartbeats.has(ws)) {
      clearTimeout(this.clientHeartbeats.get(ws)!);
      this.clientHeartbeats.delete(ws);
    }

    // Remove from user connections
    if (ws.userId) {
      const userConnections = this.userConnections.get(ws.userId);
      if (userConnections) {
        userConnections.delete(ws);
        if (userConnections.size === 0) {
          this.userConnections.delete(ws.userId);
        }
      }
    }

    // Close connection if still open
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
          this.cleanup(client as WebSocketWithId);
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
