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

  // Apply rate limiting middleware
  app.use('/api/', apiLimiter); // General API rate limit
  app.use('/api/subtitles', processingLimiter); // Video processing rate limit
  app.use('/api/translate', aiOperationsLimiter); // Translation rate limit
  app.use('/api/summarize', aiOperationsLimiter); // Summarization rate limit
  app.use('/api/cache', cacheLimiter); // Cache operations rate limit
  app.use('/api/ws', wsRateLimit); // WebSocket rate limit
  
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
