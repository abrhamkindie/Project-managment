import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

/**
 * Request ID middleware.
 *
 * Generates a unique request ID for each incoming request and attaches it to
 * the request object. This ID is used for tracing requests through logs and
 * across services.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) || randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
