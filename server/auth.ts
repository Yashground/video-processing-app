import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express, Request } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type User as SelectUser } from "db/schema";
import { db } from "db";
import { eq } from "drizzle-orm";
import cookie from "cookie";
import { createHash } from 'crypto';
import { AuthenticatedSession } from "./types/express-session";

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      suppliedPassword,
      salt,
      64
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

export interface AuthenticatedRequest extends Request {
  user?: Express.User;
  session: AuthenticatedSession;
}

const SECRET = process.env.REPL_ID || "watch-hour-secret";

// Create memory store instance outside to be shared
const sessionStore = new (createMemoryStore(session))({
  checkPeriod: 86400000, // 24 hours
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  stale: false
});

// Verify session signature
function verifySignature(signed: string, secret: string): string | false {
  if (!signed) return false;
  
  const [versionTag, sessionId, hash] = signed.split('.');
  if (!versionTag || !sessionId || !hash) {
    return false;
  }

  const expectedHash = createHash('sha256')
    .update(versionTag + '.' + sessionId + secret)
    .digest('base64')
    .replace(/\=+$/, '');

  return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash)) ? sessionId : false;
}

export const authenticateWs = async (request: Request): Promise<AuthenticatedRequest | false> => {
  try {
    // Step 1: Validate cookie header
    console.log('[WebSocket Auth] Starting authentication process');
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      console.error('[WebSocket Auth] No cookies found in request');
      return false;
    }

    // Step 2: Parse and validate cookies
    let cookies;
    try {
      cookies = cookie.parse(cookieHeader);
    } catch (err) {
      console.error('[WebSocket Auth] Cookie parsing error:', err);
      return false;
    }

    const sessionCookie = cookies['watch-hour-session'];
    if (!sessionCookie) {
      console.error('[WebSocket Auth] Session cookie not found');
      return false;
    }

    // Step 3: Decode and verify session ID
    console.log('[WebSocket Auth] Verifying session signature');
    const decodedCookie = decodeURIComponent(sessionCookie);
    const sessionId = verifySignature(decodedCookie, SECRET);

    if (!sessionId) {
      console.error('[WebSocket Auth] Invalid session signature');
      return false;
    }

    // Step 4: Session store access and validation
    return new Promise((resolve) => {
      console.log('[WebSocket Auth] Accessing session store');
      sessionStore.get(sessionId, async (err, session) => {
        if (err) {
          console.error('[WebSocket Auth] Session store error:', err);
          resolve(false);
          return;
        }

        if (!session) {
          console.error('[WebSocket Auth] No session found in store');
          resolve(false);
          return;
        }

        // Step 5: Validate session data
        if (!session.passport?.user) {
          console.error('[WebSocket Auth] No user data in session');
          resolve(false);
          return;
        }

        // Step 6: Validate session expiration
        if (session.cookie?.expires && new Date(session.cookie.expires) < new Date()) {
          console.error('[WebSocket Auth] Session expired');
          resolve(false);
          return;
        }

        try {
          // Step 7: Verify user exists in database
          console.log('[WebSocket Auth] Verifying user in database');
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, session.passport.user))
            .limit(1);

          if (!user) {
            console.error('[WebSocket Auth] User not found in database');
            resolve(false);
            return;
          }

          // Step 8: Update session activity and extend expiration
          const now = Date.now();
          if (session.cookie) {
            session.cookie.expires = new Date(now + (24 * 60 * 60 * 1000));
            session.lastAccess = now;
          }

          // Step 9: Save updated session
          await new Promise<void>((resolveSession) => {
            sessionStore.set(sessionId, session, (err) => {
              if (err) {
                console.error('[WebSocket Auth] Failed to update session:', err);
              }
              resolveSession();
            });
          });

          // Step 10: Create authenticated request
          const authenticatedRequest = request as AuthenticatedRequest;
          authenticatedRequest.user = user;
          authenticatedRequest.session = session as AuthenticatedSession;

          console.log('[WebSocket Auth] Authentication successful');
          resolve(authenticatedRequest);
        } catch (error) {
          console.error('[WebSocket Auth] Database error:', error);
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.error('[WebSocket Auth] Unexpected error:', error);
    return false;
  }
};

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || "watch-hour-secret",
    resave: false,
    saveUninitialized: false,
    name: 'watch-hour-session',
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: app.get("env") === "production",
      path: '/'
    },
    store: sessionStore,
    rolling: true // Refresh session on each request
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          return done(null, false, { message: "Incorrect username." });
        }
        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: "Incorrect password." });
        }
        return done(null, user);
      } catch (err) {
        console.error('Authentication error:', err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });

  // Login route
  app.post("/login", (req, res, next) => {
    const result = insertUserSchema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid input", errors: result.error.flatten() });
    }

    passport.authenticate("local", (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        console.error('Authentication error:', err);
        return next(err);
      }
      if (!user) {
        return res.status(400).json({
          message: info.message ?? "Login failed",
        });
      }
      
      req.login(user, (err) => {
        if (err) {
          console.error('Login error:', err);
          return next(err);
        }
        req.session.save((err) => {
          if (err) {
            console.error('Session save error:', err);
            return next(err);
          }
          return res.json({
            message: "Login successful",
            user: { id: user.id, username: user.username },
          });
        });
      });
    })(req, res, next);
  });

  // Registration route
  app.post("/register", async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res
          .status(400)
          .json({ message: "Invalid input", errors: result.error.flatten() });
      }

      const { username, password } = result.data;

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await crypto.hash(password);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
        })
        .returning();

      req.login(newUser, (err) => {
        if (err) {
          console.error('Login after registration failed:', err);
          return next(err);
        }
        req.session.save((err) => {
          if (err) {
            console.error('Session save after registration failed:', err);
            return next(err);
          }
          return res.json({
            message: "Registration successful",
            user: { id: newUser.id, username: newUser.username },
          });
        });
      });
    } catch (error) {
      console.error('Registration error:', error);
      next(error);
    }
  });

  // Logout route
  app.post("/logout", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(400).json({ message: "Not logged in" });
    }
    
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ message: "Logout failed" });
      }
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destruction error:', err);
          return res.status(500).json({ message: "Logout partially failed" });
        }
        res.clearCookie('watch-hour-session');
        res.json({ message: "Logout successful" });
      });
    });
  });

  // User info route
  app.get("/api/user", (req, res) => {
    if (!req.session) {
      return res.status(401).json({ message: "No session found" });
    }
    
    if (req.isAuthenticated()) {
      return res.json(req.user);
    }
    res.status(401).json({ message: "Unauthorized" });
  });
}