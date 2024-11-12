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
  lastPing?: number;
  heartbeatInterval?: NodeJS.Timeout;
  reconnectAttempts?: number;
}

interface ConnectionPool {
  id: string;
  connections: Set<WebSocketWithId>;
  lastBalanced: number;
}

class ProgressTracker extends EventEmitter {
  private static instance: ProgressTracker;
  private wss: WebSocketServer | null = null;
  private progressMap: Map<string, ProgressUpdate> = new Map();
  private readonly HEARTBEAT_INTERVAL = 10000; // Reduced from 15000
  private readonly HEARTBEAT_TIMEOUT = 30000; // Reduced from 45000
  private readonly MAX_CLIENTS_PER_USER = 5;
  private readonly MAX_POOL_SIZE = 250; // Reduced from 500
  private readonly POOL_REBALANCE_INTERVAL = 15000; // Reduced from 30000
  private readonly STALE_CONNECTION_TIMEOUT = 60000; // Reduced from 180000
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 1000;

  private userConnections: Map<string, Set<WebSocketWithId>> = new Map();
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private poolRebalanceInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.startPoolRebalancing();
  }

  static getInstance(): ProgressTracker {
    if (!ProgressTracker.instance) {
      ProgressTracker.instance = new ProgressTracker();
    }
    return ProgressTracker.instance;
  }

  private startPoolRebalancing() {
    if (this.poolRebalanceInterval) {
      clearInterval(this.poolRebalanceInterval);
    }
    
    this.poolRebalanceInterval = setInterval(() => {
      this.rebalanceConnectionPools();
    }, this.POOL_REBALANCE_INTERVAL);
  }

  private rebalanceConnectionPools() {
    const now = Date.now();
    
    // Clean up stale connections
    for (const [poolId, pool] of this.connectionPools) {
      const staleConnections = Array.from(pool.connections)
        .filter(ws => {
          const isStale = now - (ws.lastPing || 0) > this.STALE_CONNECTION_TIMEOUT;
          const isInactive = ws.readyState !== WebSocket.OPEN;
          return isStale || isInactive;
        });
      
      for (const ws of staleConnections) {
        console.log(`Cleaning up stale connection in pool ${poolId}`);
        this.cleanup(ws);
      }
      
      if (pool.connections.size === 0) {
        this.connectionPools.delete(poolId);
        continue;
      }

      // Check pool health
      if (now - pool.lastBalanced > this.POOL_REBALANCE_INTERVAL * 2) {
        console.log(`Pool ${poolId} hasn't been balanced recently, forcing rebalance`);
        this.redistributeConnections(pool);
      }
    }

    // Balance load across pools
    this.balancePoolLoad();
  }

  private redistributeConnections(sourcePool: ConnectionPool) {
    const connections = Array.from(sourcePool.connections)
      .filter(ws => ws.readyState === WebSocket.OPEN);
    
    const targetPools = Array.from(this.connectionPools.values())
      .filter(p => p.id !== sourcePool.id && p.connections.size < this.MAX_POOL_SIZE);
    
    if (targetPools.length === 0) return;

    for (let i = 0; i < connections.length; i++) {
      const targetPool = targetPools[i % targetPools.length];
      const conn = connections[i];
      
      sourcePool.connections.delete(conn);
      targetPool.connections.add(conn);
    }
  }

  private balancePoolLoad() {
    const pools = Array.from(this.connectionPools.values());
    if (pools.length < 2) return;

    const avgPoolSize = Math.floor(
      pools.reduce((sum, pool) => sum + pool.connections.size, 0) / pools.length
    );
    
    for (const pool of pools) {
      if (pool.connections.size > avgPoolSize + 2) { // Reduced threshold from 3
        const excessConnections = Array.from(pool.connections)
          .slice(avgPoolSize)
          .slice(0, pool.connections.size - avgPoolSize)
          .filter(ws => ws.readyState === WebSocket.OPEN);
        
        for (const conn of excessConnections) {
          const targetPool = pools.find(p => p.connections.size < avgPoolSize);
          if (targetPool) {
            pool.connections.delete(conn);
            targetPool.connections.add(conn);
          }
        }
      }
      pool.lastBalanced = Date.now();
    }
  }

  private getOrCreatePool(): ConnectionPool {
    // Find the pool with the least connections
    let targetPool: ConnectionPool | undefined;
    let minConnections = Infinity;

    for (const pool of this.connectionPools.values()) {
      const activeConnections = Array.from(pool.connections)
        .filter(ws => ws.readyState === WebSocket.OPEN).length;
      
      if (activeConnections < minConnections && activeConnections < this.MAX_POOL_SIZE) {
        targetPool = pool;
        minConnections = activeConnections;
      }
    }

    // Create new pool if needed
    if (!targetPool || minConnections >= this.MAX_POOL_SIZE) {
      const poolId = `pool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      targetPool = {
        id: poolId,
        connections: new Set(),
        lastBalanced: Date.now()
      };
      this.connectionPools.set(poolId, targetPool);
    }

    return targetPool;
  }

  private handleHeartbeat(ws: WebSocketWithId) {
    ws.isAlive = true;
    ws.lastPing = Date.now();
    ws.reconnectAttempts = 0; // Reset reconnect attempts on successful heartbeat

    // Clear existing heartbeat timeout
    if (ws.heartbeatInterval) {
      clearTimeout(ws.heartbeatInterval);
    }

    // Set new heartbeat timeout
    ws.heartbeatInterval = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        // Set a timeout to close the connection if no pong is received
        setTimeout(() => {
          if (ws.isAlive === false) {
            console.log('Client heartbeat timeout, closing connection');
            this.cleanup(ws);
          }
        }, 5000);
      } else {
        this.cleanup(ws);
      }
    }, this.HEARTBEAT_INTERVAL);
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
          console.log('[WebSocket] Verifying client connection');
          const authResult = await authenticate(info.req);
          
          if (!authResult) {
            console.error('[WebSocket] Authentication failed');
            callback(false, 401, 'Unauthorized');
            return;
          }

          const userId = authResult.user?.id;
          if (!userId) {
            console.error('[WebSocket] No user ID in authentication result');
            callback(false, 401, 'Invalid user');
            return;
          }

          // Add rate limiting for WebSocket connections
          const userConnections = this.userConnections.get(userId) || new Set();
          if (userConnections.size >= this.MAX_CLIENTS_PER_USER) {
            console.error(`[WebSocket] Too many connections for user ${userId}`);
            callback(false, 429, 'Too many connections');
            return;
          }

          info.req.headers['x-user-id'] = userId;
          callback(true);
        } catch (error) {
          console.error('[WebSocket] Authentication error:', error);
          callback(false, 500, 'Internal Server Error');
        }
      },
      clientTracking: true
    });

    // Enhanced connection handling
    this.wss.on('connection', async (ws: WebSocketWithId, req: AuthenticatedRequest) => {
      try {
        const userId = req.headers['x-user-id'] as string;
        if (!userId) {
          console.error('[WebSocket] No user ID in headers');
          ws.close(1011, 'Authentication failed');
          return;
        }

        console.log(`[WebSocket] New connection established for user: ${userId}`);

        ws.id = `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        ws.userId = userId;
        ws.isAlive = true;
        ws.lastPing = Date.now();
        ws.reconnectAttempts = 0;

        // Add to connection pool
        const pool = this.getOrCreatePool();
        pool.connections.add(ws);

        // Add to user connections
        if (!this.userConnections.has(userId)) {
          this.userConnections.set(userId, new Set());
        }
        this.userConnections.get(userId)?.add(ws);

        // Setup heartbeat
        const heartbeatInterval = setInterval(() => {
          if (!ws.isAlive) {
            console.log('[WebSocket] Client lost connection, terminating');
            clearInterval(heartbeatInterval);
            this.cleanup(ws);
            return;
          }
          ws.isAlive = false;
          ws.ping();
        }, this.HEARTBEAT_INTERVAL);

        ws.on('pong', () => {
          ws.isAlive = true;
          ws.lastPing = Date.now();
          this.handleHeartbeat(ws);
        });

        // Send initial state
        if (ws.readyState === WebSocket.OPEN) {
          this.sendInitialState(ws);
        }

        // Handle messages with improved error handling
        ws.on('message', (data) => {
          try {
            this.handleMessage(ws, data);
          } catch (error) {
            console.error('[WebSocket] Message handling error:', error);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'Failed to process message',
                timestamp: Date.now()
              }));
            }
          }
        });

        ws.on('close', (code, reason) => {
          console.log(`[WebSocket] Connection closed for user ${userId}:`, code, reason.toString());
          clearInterval(heartbeatInterval);
          this.cleanup(ws);
        });

        ws.on('error', (error) => {
          console.error(`[WebSocket] Error for user ${userId}:`, error);
          clearInterval(heartbeatInterval);
          this.cleanup(ws);
        });

      } catch (error) {
        console.error('[WebSocket] Connection handling error:', error);
        ws.close(1011, 'Internal error');
      }
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
        ...update,
        timestamp: Date.now()
      }));
    });
  }

  private sendInitialState(ws: WebSocketWithId) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
        
        this.progressMap.forEach((progress) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'progress',
              ...progress
            }));
          }
        });
      }
    } catch (error) {
      console.error('Error sending initial state:', error);
      this.cleanup(ws);
    }
  }

  private handleMessage(ws: WebSocketWithId, data: any) {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'ping':
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'pong',
              timestamp: Date.now()
            }));
            this.handleHeartbeat(ws);
          }
          break;
          
        case 'init':
          if (message.videoId) {
            const progress = this.progressMap.get(message.videoId);
            if (progress && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'progress',
                ...progress
              }));
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'An unknown error occurred',
          message: 'Failed to process WebSocket message'
        }));
      }
    }
  }

  private cleanup(ws: WebSocketWithId) {
    // Remove from heartbeat tracking
    if (ws.heartbeatInterval) {
      clearTimeout(ws.heartbeatInterval);
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

    // Remove from connection pools
    for (const pool of this.connectionPools.values()) {
      if (pool.connections.has(ws)) {
        pool.connections.delete(ws);
        break;
      }
    }

    // Close connection if still open
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, "Normal closure");
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

    // Broadcast to all pools
    for (const pool of this.connectionPools.values()) {
      for (const client of pool.connections) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (error) {
            console.error('Error broadcasting message:', error);
            this.cleanup(client);
          }
        }
      }
    }
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
      error: error,
      message: 'An error occurred during processing'
    };
    this.emit('progress', update);
    
    // Broadcast error to all connected clients
    this.broadcast(JSON.stringify({
      type: 'error',
      videoId,
      error: error,
      message: 'Video processing failed'
    }));
    
    this.progressMap.delete(videoId);
  }

  clearProgress(videoId: string) {
    this.progressMap.delete(videoId);
  }

  getProgress(videoId: string): ProgressUpdate | undefined {
    return this.progressMap.get(videoId);
  }

  shutdown() {
    if (this.poolRebalanceInterval) {
      clearInterval(this.poolRebalanceInterval);
    }

    // Cleanup all connections
    for (const pool of this.connectionPools.values()) {
      for (const ws of pool.connections) {
        this.cleanup(ws);
      }
    }

    if (this.wss) {
      this.wss.close();
    }
  }
}

export const progressTracker = ProgressTracker.getInstance();