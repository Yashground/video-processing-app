import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';

export const setupProxy = (app: Express) => {
  const viteProxy = createProxyMiddleware({
    target: 'http://localhost:5173',
    ws: true,
    changeOrigin: true,
    secure: false,
    headers: {
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    },
    onProxyReq: (proxyReq: any, req: IncomingMessage) => {
      // Handle WebSocket upgrade requests
      if (req.headers.upgrade === 'websocket') {
        proxyReq.setHeader('Connection', 'Upgrade');
        proxyReq.setHeader('Upgrade', 'websocket');
      }
    },
    onProxyRes: (proxyRes: any) => {
      // Ensure proper headers for WebSocket connections
      if (proxyRes.headers.upgrade === 'websocket') {
        proxyRes.headers.connection = 'Upgrade';
      }
    },
    onError: (err: Error, req: IncomingMessage, res: ServerResponse) => {
      console.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy error occurred');
      }
    }
  });

  // Mount proxy middleware for Vite paths
  app.use([
    '/@vite',
    '/@fs',
    '/@id',
    '/__vite_hmr',
    '/.vite',
    '/node_modules',
    '/src'
  ], (req, res, next) => {
    if (req.headers.upgrade === 'websocket') {
      res.setHeader('Connection', 'Upgrade');
      res.setHeader('Upgrade', 'websocket');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Connection, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    viteProxy(req, res, next);
  });

  // Handle WebSocket upgrade events
  app.on('upgrade', (req: any, socket: any, head: any) => {
    if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
      socket.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
      });
      viteProxy.upgrade(req, socket, head);
    }
  });
};
