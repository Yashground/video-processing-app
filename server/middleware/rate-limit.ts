import { rateLimit } from 'express-rate-limit';
import { type Request, type Response, type NextFunction } from 'express';

// Create a store to track API calls
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Specific limiter for video processing
const processingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 video processing requests per hour
  message: 'Processing limit reached, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// WebSocket connection limiter
const wsConnectionsPerIP = new Map<string, number>();

export function wsRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const currentConnections = wsConnectionsPerIP.get(ip) || 0;
  
  if (currentConnections >= 5) { // Maximum 5 concurrent WebSocket connections per IP
    res.status(429).json({ message: 'Too many WebSocket connections' });
    return;
  }
  
  wsConnectionsPerIP.set(ip, currentConnections + 1);
  next();
}

export function decrementWSConnection(ip: string | undefined) {
  if (!ip) return;
  const currentConnections = wsConnectionsPerIP.get(ip) || 0;
  if (currentConnections > 0) {
    wsConnectionsPerIP.set(ip, currentConnections - 1);
  }
}

export { apiLimiter, processingLimiter };
