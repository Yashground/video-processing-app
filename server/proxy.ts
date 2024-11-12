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
    proxyTimeout: 120000, // Increased timeout
    timeout: 120000, // Increased timeout
    headers: {
      'Connection': 'keep-alive',
      'Keep-Alive': 'timeout=120' // Match the timeout settings
    },
    onProxyReq: (proxyReq: any, req: IncomingMessage) => {
      // Copy cookies to proxy request
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }

      // Handle WebSocket upgrade with improved headers
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        proxyReq.setHeader('Connection', 'Upgrade');
        proxyReq.setHeader('Upgrade', 'websocket');
        proxyReq.setHeader('Sec-WebSocket-Version', '13');
        if (req.headers['sec-websocket-key']) {
          proxyReq.setHeader('Sec-WebSocket-Key', req.headers['sec-websocket-key']);
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
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, Sec-WebSocket-Key, Sec-WebSocket-Version');
        res.setHeader('Access-Control-Max-Age', '86400');
      }

      // Handle WebSocket upgrade response
      if (proxyRes.headers.upgrade && proxyRes.headers.upgrade.toLowerCase() === 'websocket') {
        proxyRes.headers.connection = 'Upgrade';
        proxyRes.headers['sec-websocket-accept'] = proxyRes.headers['sec-websocket-accept'];
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
      if (req.url?.startsWith('/progress')) {
        // Apply authentication before upgrading
        const isAuthenticated = await authenticateWs(req);
        if (!isAuthenticated) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Set socket timeout
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);

        // After authentication, handle the upgrade
        viteProxy.upgrade(req, socket, head);
      }
      
      if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
        // Set socket timeout for HMR connections
        socket.setTimeout(120000);
        socket.setKeepAlive(true, 60000);
        viteProxy.upgrade(req, socket, head);
      }
    } catch (error) {
      console.error('WebSocket upgrade error:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });
};
