import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express } from 'express';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import { authenticateWs } from './auth';

export const setupProxy = (app: Express) => {
  const viteProxy = createProxyMiddleware({
    target: 'http://localhost:5173',
    ws: true,
    changeOrigin: true,
    secure: false,
    xfwd: true,
    proxyTimeout: 120000,
    timeout: 120000,
    headers: {
      'Connection': 'keep-alive',
      'Keep-Alive': 'timeout=120'
    }
  });

  // Mount proxy middleware for Vite development routes
  app.use([
    '/@vite',
    '/@fs',
    '/@id',
    '/src',
    '/__vite_hmr',
    '/.vite',
    '/node_modules'
  ], viteProxy);

  // Enhanced WebSocket upgrade handling
  app.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      console.log('[WebSocket Upgrade] Request received:', req.url);

      // Ensure proper upgrade header
      if (!req.headers.upgrade?.toLowerCase().includes('websocket')) {
        console.error('[WebSocket Upgrade] Invalid upgrade header');
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      // Handle WebSocket endpoints
      if (req.url?.startsWith('/api/ws/progress')) {
        console.log('[WebSocket Upgrade] Processing progress endpoint');
        
        // Authenticate WebSocket connection
        const authResult = await authenticateWs(req);
        if (!authResult) {
          console.error('[WebSocket Upgrade] Authentication failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        // Configure socket
        socket.setNoDelay(true);
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        // Setup error handlers
        socket.on('error', (err: Error) => {
          console.error('[WebSocket Error]:', err);
          socket.destroy();
        });

        socket.on('timeout', () => {
          console.error('[WebSocket Timeout]');
          socket.destroy();
        });

        // Forward authenticated request
        console.log('[WebSocket Upgrade] Authentication successful');
        viteProxy.upgrade(req, socket, head);
      } 
      // Handle Vite HMR WebSocket endpoint
      else if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        console.log('[WebSocket Upgrade] Processing Vite HMR request');
        
        // Configure socket
        socket.setNoDelay(true);
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        // Setup error handlers
        socket.on('error', (err: Error) => {
          console.error('[HMR WebSocket Error]:', err);
          socket.destroy();
        });

        socket.on('timeout', () => {
          console.error('[HMR WebSocket Timeout]');
          socket.destroy();
        });

        viteProxy.upgrade(req, socket, head);
      } 
      // Reject unknown WebSocket endpoints
      else {
        console.error('[WebSocket Upgrade] Unknown endpoint:', req.url);
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    } catch (error) {
      console.error('[WebSocket Upgrade Error]:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
};