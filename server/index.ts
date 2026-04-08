import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

app.use(cookieParser());

// ─── Performance & Ingestion Metrics ─────────────────────────────────────────

interface DataOperationMetric {
  operation: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  timestamp: string;
}

const recentMetrics: DataOperationMetric[] = [];
const MAX_METRICS = 500;

export function recordDataOperation(
  operation: string,
  durationMs: number,
  success: boolean,
  errorMessage?: string
): void {
  const metric: DataOperationMetric = {
    operation,
    durationMs,
    success,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
  recentMetrics.push(metric);
  if (recentMetrics.length > MAX_METRICS) recentMetrics.shift();

  if (!success) {
    console.error(
      `[data-error] ${operation} failed in ${durationMs}ms — ${errorMessage ?? "unknown error"}`
    );
  }
}

export function getRecentMetrics(): DataOperationMetric[] {
  return [...recentMetrics];
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);

      // Track data ingestion operations for monitoring
      const isDataWrite =
        (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") &&
        (path.includes("/records") ||
          path.includes("/scan") ||
          path.includes("/log-search") ||
          path.includes("/data/validate") ||
          path.includes("/data/deduplicate") ||
          path.includes("/data/archive"));

      if (isDataWrite) {
        const success = res.statusCode >= 200 && res.statusCode < 300;
        const errorMessage = !success && capturedJsonResponse?.error
          ? String(capturedJsonResponse.error)
          : undefined;
        recordDataOperation(`${req.method} ${path}`, duration, success, errorMessage);
      }
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // === DATA OPERATIONS METRICS ENDPOINT (admin only via cookie/header auth) ===
  app.get("/api/metrics/data-operations", (req, res) => {
    const metrics = getRecentMetrics();
    const total = metrics.length;
    const failed = metrics.filter((m) => !m.success).length;
    const avgDuration =
      total > 0
        ? Math.round(metrics.reduce((s, m) => s + m.durationMs, 0) / total)
        : 0;
    res.json({
      total,
      failed,
      successRate: total > 0 ? Math.round(((total - failed) / total) * 100) : 100,
      avgDurationMs: avgDuration,
      recent: metrics.slice(-50),
    });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
