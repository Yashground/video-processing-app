import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
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

  // Mount proxy middleware
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
  app.on('upgrade', async (req: any, socket: any, head: any) => {
    try {
      const isWebSocketRequest = req.headers.upgrade?.toLowerCase() === 'websocket';
      if (!isWebSocketRequest) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Handle progress WebSocket endpoint
      if (req.url?.startsWith('/api/ws/progress')) {
        const authResult = await authenticateWs(req);
        if (!authResult) {
          console.error('[WebSocket Upgrade] Authentication failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Setup socket configurations
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        socket.on('error', (err: Error) => {
          console.error('[WebSocket Socket Error]:', err);
          socket.destroy();
        });

        // Proceed with upgrade after successful authentication
        viteProxy.upgrade(req, socket, head);
      } 
      // Handle Vite HMR WebSocket endpoint
      else if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);
        
        socket.on('error', (err: Error) => {
          console.error('[HMR WebSocket Error]:', err);
          socket.destroy();
        });

        viteProxy.upgrade(req, socket, head);
      } 
      // Reject unknown WebSocket endpoints
      else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    } catch (error) {
      console.error('[WebSocket Upgrade Error]:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });
};