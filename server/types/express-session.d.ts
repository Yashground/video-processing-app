import { SessionData } from 'express-session';
import { User } from '../../db/schema';

declare module 'express-session' {
  interface SessionData {
    passport?: {
      user: number;
    };
    userId?: number;
    cookie: {
      maxAge: number;
    };
  }
}

export interface AuthenticatedSession extends SessionData {
  id: string;
  regenerate: (callback: (err: any) => void) => void;
  destroy: (callback: (err: any) => void) => void;
  reload: (callback: (err: any) => void) => void;
  save: (callback: (err: any) => void) => void;
  touch: () => void;
  passport: {
    user: number;
  };
}
