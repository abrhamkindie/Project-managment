import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import { pinoHttp } from "pino-http";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/error.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

/**
 * Express application factory. Exported separately from the HTTP server so tests can
 * drive the exact same app with supertest.
 */
export function createApp(): Application {
  const app = express();

  // Behind the web proxy / a load balancer: needed for correct client IPs in the
  // rate limiter and in logs.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: env.isProd ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin requests (curl, health checks, the proxy) carry no Origin header.
        if (!origin || env.corsOrigins.includes(origin))
          {return callback(null, true);}
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req: Request) => req.url === "/api/health" },
      customLogLevel: (_req: Request, res: Response, err?: Error) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(requestIdMiddleware);
  app.use(apiRateLimit);
  app.use("/api", apiRouter);

  // 404 handler for unmatched routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not Found", path: req.path });
  });
  app.use(errorHandler);

  return app;
}
