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

  // WebSocket upgrade handler
  const handleUpgrade = async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      if (!req.headers.upgrade?.toLowerCase().includes('websocket')) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Handle progress WebSocket endpoint
      if (req.url?.startsWith('/api/ws/progress')) {
        if (!req.headers.cookie) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Forward essential headers
        const headers = {
          ...req.headers,
          'Connection': 'upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Key': req.headers['sec-websocket-key'],
          'Sec-WebSocket-Version': req.headers['sec-websocket-version']
        };
        
        // Apply headers before authentication
        req.headers = headers;

        const authResult = await authenticateWs(req as unknown as Request);
        if (!authResult) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        socket.setNoDelay(true);
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        socket.on('error', () => socket.destroy());
        socket.on('timeout', () => socket.destroy());

        viteProxy.upgrade(req, socket, head);
      }
      // Handle Vite HMR WebSocket endpoint
      else if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        viteProxy.upgrade(req, socket, head);
      }
      else {
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
