import { rateLimit } from 'express-rate-limit';
import { type Request, type Response, type NextFunction } from 'express';
import { db } from '../lib/db-pool';

// Create different limiters for different endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      message: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime.getTime() - Date.now()) / 1000
    });
  }
});

// More restrictive limiter for video processing
const processingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 video processing requests per hour
  message: 'Processing limit reached, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      message: 'Processing limit reached, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime.getTime() - Date.now()) / 1000
    });
  }
});

// Translation and summarization limiter
const aiOperationsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // 30 requests per 10 minutes
  message: 'AI operation limit reached, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      message: 'AI operation limit reached, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime.getTime() - Date.now()) / 1000
    });
  }
});

// Cache operations limiter
const cacheLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  message: 'Cache operation limit reached, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// WebSocket connection limiter
const wsConnectionsPerIP = new Map<string, number>();

function wsRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const currentConnections = wsConnectionsPerIP.get(ip) || 0;
  
  if (currentConnections >= 5) { // Maximum 5 concurrent WebSocket connections per IP
    res.status(429).json({ 
      message: 'Too many WebSocket connections',
      retryAfter: 60 // Suggest retry after 1 minute
    });
    return;
  }
  
  wsConnectionsPerIP.set(ip, currentConnections + 1);
  next();
}

function decrementWSConnection(ip: string | undefined) {
  if (!ip) return;
  const currentConnections = wsConnectionsPerIP.get(ip) || 0;
  if (currentConnections > 0) {
    wsConnectionsPerIP.set(ip, currentConnections - 1);
  }
}

// Export all limiters
export { 
  apiLimiter, 
  processingLimiter, 
  aiOperationsLimiter, 
  cacheLimiter,
  wsRateLimit, 
  decrementWSConnection 
};
