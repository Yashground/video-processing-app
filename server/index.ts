import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { progressTracker } from "./lib/progress";
import { setupAuth } from "./auth";
import { setupProxy } from "./proxy";
import { authenticateWs } from "./auth";

const app = express();

// Global error handler
const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
};

// WebSocket CORS setup
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Body parsing middleware with increased limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

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

// Setup Vite or static serving based on environment
(async () => {
  try {
    if (process.env.NODE_ENV !== "production") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, "0.0.0.0", () => {
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
