import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { progressTracker } from "./lib/progress";
import { setupAuth } from "./auth";
import { setupProxy } from "./proxy";
import { authenticateWs } from "./auth";
import cors from "cors";

const app = express();

// Global error handler
const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
};

// CORS setup with proper WebSocket support
const allowedOrigins = [
  'http://localhost:5000',
  'http://localhost:3000',
  'http://0.0.0.0:5000',
  'http://0.0.0.0:3000'
];

if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
  allowedOrigins.push(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

// Body parsing middleware with increased limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Create server with proper timeouts
const server = createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Initialize WebSocket for progress tracking with authentication and error handling
progressTracker.initializeWebSocket(server, async (request) => {
  try {
    const authResult = await authenticateWs(request);
    return authResult;
  } catch (error) {
    console.error('WebSocket authentication error:', error);
    return false;
  }
});

// Setup authentication first
setupAuth(app);

// Register routes after auth setup
registerRoutes(app);

// Add error handler
app.use(errorHandler);

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
      console.log(`${new Date().toLocaleTimeString()} [express] serving on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();

// Handle unexpected errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Handle server shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
