import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, Unauthorized } from "../domain/errors.js";
import { mapPrismaError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

/** 404 for unmatched routes, normalised into the same envelope as every other error. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json({
      error: {
        code: "not_found",
        message: `No route for ${req.method} ${req.path}`,
      },
    });
};

/**
 * Terminal error handler. Express only routes errors to a middleware that declares four
 * arguments, so `_next` stays in the signature even though every branch responds.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = mapPrismaError(err);
  const requestId =
    (req as unknown as { requestId?: string }).requestId || "unknown";

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request failed validation",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        requestId,
      },
    });
  }

  if (error instanceof AppError) {
    if (error.status >= 500)
      {logger.error({ err: error, reqId: requestId }, error.message);}
    const response = error.toJSON();
    return res.status(error.status).json({ ...response, requestId });
  }

  // Body parser rejects, malformed JSON, unexpected failures.
  const anyErr = error as { type?: string; message?: string; status?: number };
  if (anyErr?.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({
        error: {
          code: "bad_request",
          message: "Malformed JSON body",
          requestId,
        },
      });
  }
  if (
    typeof anyErr?.status === "number" &&
    anyErr.status >= 400 &&
    anyErr.status < 500
  ) {
    return res
      .status(anyErr.status)
      .json({
        error: { code: "bad_request", message: anyErr.message, requestId },
      });
  }

  logger.fatal(
    { err: error, reqId: requestId, path: req.path },
    "Unhandled error",
  );
  return res.status(500).json({
    error: {
      code: "internal_error",
      message: "Unexpected server error",
      requestId,
      // Stack stays out of the response in production; it is logged instead.
      ...(env.isProd ? {} : { details: String(anyErr?.message ?? error) }),
    },
  });
};

/** Guards against unauthenticated access to the cookie-based session. */
export function requireSameOriginCsrf(): RequestHandler {
  // Cookies are SameSite=Lax, which already blocks cross-site writes. This is a
  // defence-in-depth check for state-changing requests coming from another origin.
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !env.corsOrigins.includes(origin)) {
      return next(new Unauthorized("Origin not allowed"));
    }
    return next();
  };
}
