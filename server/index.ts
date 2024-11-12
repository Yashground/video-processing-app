import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { progressTracker } from "./lib/progress";
import { setupAuth } from "./auth";
import { setupProxy } from "./proxy";
import { authenticateWs } from "./auth";
import { 
  apiLimiter, 
  processingLimiter, 
  aiOperationsLimiter,
  cacheLimiter,
  wsRateLimit 
} from "./middleware/rate-limit";
import { db, checkDBConnection, closePool } from "./lib/db-pool";
import { VideoCache } from "./lib/cache";
import cluster from "cluster";
import os from "os";
import compression from "compression";

if (cluster.isPrimary) {
  // Get the number of available CPU cores
  const numCPUs = os.cpus().length;
  
  // Fork workers based on available cores (keep 1 core free for system)
  const workerCount = Math.max(1, Math.min(numCPUs - 1, 4));
  
  console.log(`Primary ${process.pid} is running`);
  console.log(`Starting ${workerCount} workers...`);

  // Fork workers
  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  const app = express();

  // Configure trust proxy settings for specific proxy IPs
  app.set('trust proxy', function(ip: string) {
    // Only trust specific proxy IPs
    if (process.env.NODE_ENV === 'production') {
      // In production, only trust known proxy IPs
      const trustedProxies = (process.env.TRUSTED_PROXIES || '127.0.0.1').split(',');
      return trustedProxies.includes(ip);
    }
    // In development, trust local IPs
    return ip === '127.0.0.1' || ip === '::1';
  });

  // Global error handler
  const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  };

  // Enable compression
  app.use(compression());

  // WebSocket CORS setup with improved headers
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours
    }
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // Body parsing middleware with increased limits
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));

  // Middleware to get real IP address
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor && typeof forwardedFor === 'string') {
      const ips = forwardedFor.split(',').map(ip => ip.trim());
      // Use the leftmost non-private IP
      const realIP = ips.find(ip => !isPrivateIP(ip)) || ips[0];
      req.realIP = realIP;
    } else {
      req.realIP = req.ip;
    }
    next();
  });

  // Apply rate limiting middleware with proper headers
  app.use('/api/', apiLimiter);
  app.use('/api/subtitles', processingLimiter);
  app.use('/api/translate', aiOperationsLimiter);
  app.use('/api/summarize', aiOperationsLimiter);
  app.use('/api/cache', cacheLimiter);
  app.use('/api/ws', wsRateLimit);
  
  // Create server with proper timeouts
  const server = createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Initialize WebSocket for progress tracking with authentication
  progressTracker.initializeWebSocket(server, authenticateWs);

  // Setup authentication first
  setupAuth(app);

  // Register routes after auth setup
  registerRoutes(app);

  // Add error handler
  app.use(errorHandler);

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    const dbHealthy = await checkDBConnection();
    res.json({
      status: 'healthy',
      database: dbHealthy ? 'connected' : 'error',
      worker: process.pid
    });
  });

  // Setup Vite or static serving based on environment
  (async () => {
    try {
      if (process.env.NODE_ENV !== "production") {
        await setupVite(app, server);
      } else {
        serveStatic(app);
      }

      const PORT = process.env.PORT || 5000;
      server.listen(PORT, () => {
        console.log(`${new Date().toLocaleTimeString()} [express] Worker ${process.pid} serving on port ${PORT}`);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    
    // Close server first to stop accepting new connections
    server.close(() => {
      console.log('Server closed');
    });

    // Close database pool
    await closePool();
    
    // Close cache connections
    await VideoCache.getInstance().close();
    
    // Exit process
    process.exit(0);
  };

  // Handle unexpected errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown();
  });

  process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
    shutdown();
  });

  // Handle termination signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Helper function to check for private IP addresses
function isPrivateIP(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|127\.)/.test(ip);
}

// Add TypeScript declaration for Request
declare global {
  namespace Express {
    interface Request {
      realIP: string;
    }
  }
}
