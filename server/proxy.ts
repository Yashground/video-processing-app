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
    },
    onProxyReq: (proxyReq: any, req: IncomingMessage) => {
      // Copy cookies to proxy request
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }

      // Handle WebSocket upgrade with improved headers
      if (req.headers.upgrade?.toLowerCase() === 'websocket') {
        proxyReq.setHeader('Connection', 'Upgrade');
        proxyReq.setHeader('Upgrade', 'websocket');
        proxyReq.setHeader('Sec-WebSocket-Version', '13');
        if (req.headers['sec-websocket-key']) {
          proxyReq.setHeader('Sec-WebSocket-Key', req.headers['sec-websocket-key']);
        }
        // Add origin header for WebSocket
        if (req.headers.origin) {
          proxyReq.setHeader('Origin', req.headers.origin);
        }
      }
    },
    onProxyRes: (proxyRes: any, req: IncomingMessage, res: ServerResponse) => {
      // Add CORS headers with improved settings
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions');
        res.setHeader('Access-Control-Max-Age', '86400');
      }

      // Handle WebSocket upgrade response
      if (proxyRes.headers.upgrade?.toLowerCase() === 'websocket') {
        proxyRes.headers.connection = 'Upgrade';
        proxyRes.headers['sec-websocket-accept'] = proxyRes.headers['sec-websocket-accept'];
        // Add WebSocket protocol if present
        if (proxyRes.headers['sec-websocket-protocol']) {
          res.setHeader('Sec-WebSocket-Protocol', proxyRes.headers['sec-websocket-protocol']);
        }
      }

      // Copy cookies from proxy response
      const cookies = proxyRes.headers['set-cookie'];
      if (cookies) {
        res.setHeader('Set-Cookie', cookies);
      }

      // Set keep-alive headers
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Keep-Alive', 'timeout=120');
    },
    onError: (err: Error, req: IncomingMessage, res: ServerResponse) => {
      console.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502, { 
          'Content-Type': 'application/json',
          'Connection': 'keep-alive'
        });
        res.end(JSON.stringify({ 
          error: 'Proxy error occurred',
          details: process.env.NODE_ENV === 'development' ? err.message : undefined
        }));
      }
    }
  });

  // Mount proxy middleware for development paths
  app.use([
    '/@vite',
    '/@fs',
    '/@id',
    '/src',
    '/__vite_hmr',
    '/.vite',
    '/node_modules'
  ], viteProxy);

  // Handle WebSocket upgrade events with improved error handling
  app.on('upgrade', async (req: any, socket: any, head: any) => {
    try {
      const isWebSocketRequest = req.headers.upgrade?.toLowerCase() === 'websocket';
      if (!isWebSocketRequest) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      if (req.url?.startsWith('/api/ws/progress')) {
        // Apply authentication before upgrading
        const isAuthenticated = await authenticateWs(req);
        if (!isAuthenticated) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Set socket timeout and keep-alive
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        // Handle socket errors
        socket.on('error', (err: Error) => {
          console.error('WebSocket socket error:', err);
          socket.destroy();
        });

        // After authentication, handle the upgrade
        viteProxy.upgrade(req, socket, head);
      } else if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        // Set socket timeout for HMR connections
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);
        
        socket.on('error', (err: Error) => {
          console.error('HMR WebSocket error:', err);
          socket.destroy();
        });

        viteProxy.upgrade(req, socket, head);
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    } catch (error) {
      console.error('WebSocket upgrade error:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });
};
