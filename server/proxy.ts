import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express } from 'express';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import type { Request } from 'express';
import { authenticateWs } from './auth';
import type { Server } from 'http';

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

  const server = app.get('server') as Server;

  // WebSocket upgrade handler with improved error handling
  const handleUpgrade = async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      // Handle progress WebSocket endpoint
      if (req.url?.startsWith('/api/ws/progress')) {
        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) {
          console.error('[WebSocket Upgrade] No cookie header');
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Set essential headers for WebSocket upgrade
        const headers = {
          ...req.headers,
          'Cookie': cookieHeader,
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': req.headers['sec-websocket-key'],
          'Sec-WebSocket-Version': req.headers['sec-websocket-version'],
          'Sec-WebSocket-Protocol': req.headers['sec-websocket-protocol']
        };

        // Apply headers before authentication
        Object.assign(req.headers, headers);

        // Authenticate WebSocket connection
        const authResult = await authenticateWs(req as unknown as Request);
        if (!authResult) {
          console.error('[WebSocket Auth] Authentication failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Enhanced socket configuration
        socket.setNoDelay(true);
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        // Improved error handling for socket events
        socket.on('error', (err) => {
          console.error('[WebSocket Socket Error]:', err);
          socket.destroy();
        });

        socket.on('timeout', () => {
          console.error('[WebSocket Socket Timeout]');
          socket.destroy();
        });

        // Forward the upgrade request to WebSocket server
        try {
          viteProxy.upgrade(req, socket, head);
        } catch (upgradeError) {
          console.error('[WebSocket Upgrade Error]:', upgradeError);
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
        }
      }
      // Handle Vite HMR WebSocket endpoint
      else if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        viteProxy.upgrade(req, socket, head);
      }
      else {
        console.error('[WebSocket Upgrade] Unknown endpoint:', req.url);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    } catch (error) {
      console.error('[WebSocket Upgrade Error]:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  };

  server.on('upgrade', handleUpgrade);
  return viteProxy;
};
