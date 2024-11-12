import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';

export const setupProxy = (app: Express) => {
  const viteProxy = createProxyMiddleware({
    target: 'http://localhost:5173',
    ws: true,
    changeOrigin: true,
    secure: false,
    xfwd: true,
    proxyTimeout: 60000,
    timeout: 60000,
    headers: {
      'Connection': 'keep-alive'
    },
    onProxyReq: (proxyReq: any, req: IncomingMessage) => {
      // Copy cookies to proxy request
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }

      // Handle WebSocket upgrade
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        proxyReq.setHeader('Connection', 'Upgrade');
        proxyReq.setHeader('Upgrade', 'websocket');
      }
    },
    onProxyRes: (proxyRes: any, req: IncomingMessage, res: ServerResponse) => {
      // Add CORS headers for development
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
      }

      // Handle WebSocket upgrade
      if (proxyRes.headers.upgrade && proxyRes.headers.upgrade.toLowerCase() === 'websocket') {
        proxyRes.headers.connection = 'Upgrade';
      }

      // Copy cookies from proxy response
      const cookies = proxyRes.headers['set-cookie'];
      if (cookies) {
        res.setHeader('Set-Cookie', cookies);
      }
    },
    onError: (err: Error, req: IncomingMessage, res: ServerResponse) => {
      console.error('Proxy error:', err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
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

  // Handle WebSocket upgrade events
  app.on('upgrade', (req: any, socket: any, head: any) => {
    if (req.url?.startsWith('/__vite_hmr') || req.url?.startsWith('/@vite')) {
      viteProxy.upgrade(req, socket, head);
    }
  });
};
