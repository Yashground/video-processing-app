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

// Create memory store instance outside to be shared
const sessionStore = new (createMemoryStore(session))({
  checkPeriod: 86400000,
  ttl: 24 * 60 * 60 * 1000
});

export const authenticateWs = async (request: Request): Promise<AuthenticatedRequest | false> => {
  try {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      console.error('WebSocket authentication failed: no cookies found');
      return false;
    }

    const cookies = cookie.parse(cookieHeader);
    const sessionId = cookies['watch-hour-session'];
    
    if (!sessionId) {
      console.error('WebSocket authentication failed: no session cookie');
      return false;
    }

    // Clean the session ID by removing the 's:' prefix and signature
    const cleanSessionId = decodeURIComponent(sessionId.split('.')[0].replace(/^s:/, ''));
    
    return new Promise((resolve) => {
      sessionStore.get(cleanSessionId, async (err, session) => {
        if (err) {
          console.error('Session store error:', err);
          resolve(false);
          return;
        }

        if (!session) {
          console.error('No session found for ID:', cleanSessionId);
          resolve(false);
          return;
        }

        if (!session.passport?.user) {
          console.error('No user in session:', session);
          resolve(false);
          return;
        }

        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, session.passport.user))
            .limit(1);

          if (!user) {
            console.error('User not found in database:', session.passport.user);
            resolve(false);
            return;
          }

          // Attach user and session to request object
          const authenticatedRequest = request as AuthenticatedRequest;
          authenticatedRequest.user = user;
          authenticatedRequest.session = session as AuthenticatedSession;

          resolve(authenticatedRequest);
        } catch (error) {
          console.error('Database error during WebSocket authentication:', error);
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.error('WebSocket authentication error:', error);
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