import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; role: string };
    }
  }
}

const sessions = new Map<string, { userId: number; role: string; expiresAt: number }>();

export function generateToken(): string {
  return crypto.randomUUID();
}

export function createSession(userId: number, role: string): string {
  const token = generateToken();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  sessions.set(token, { userId, role, expiresAt });
  return token;
}

export function getSession(token: string): { userId: number; role: string } | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return { userId: session.userId, role: session.role };
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Check cookie first, then Authorization header
  const cookieToken = req.cookies?.session;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const session = getSession(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  req.user = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
