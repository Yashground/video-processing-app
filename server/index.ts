import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { progressTracker } from "./lib/progress";
import { setupAuth } from "./auth";
import { setupProxy } from "./proxy";

const app = express();

// Add CORS headers for development with proper WebSocket support
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Connection, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle WebSocket upgrade requests
    if (req.headers.upgrade === 'websocket') {
      res.header('Connection', 'Upgrade');
      res.header('Upgrade', 'websocket');
    }
  }
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Move proxy setup before other middleware
setupProxy(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

(async () => {
  const server = createServer(app);
  
  // Increase server timeout for long-running WebSocket connections
  server.timeout = 300000; // 5 minutes
  server.keepAliveTimeout = 300000;
  server.headersTimeout = 301000; // Slightly higher than keepAliveTimeout
  
  // Set up authentication and routes after proxy
  setupAuth(app);
  registerRoutes(app);
  
  // Initialize WebSocket server for progress tracking
  progressTracker.initializeWebSocket(server);

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  // Set up Vite in development mode
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    const formattedTime = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    console.log(`${formattedTime} [express] serving on port ${PORT}`);
  });
})();
