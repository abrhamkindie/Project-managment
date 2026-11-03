import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Abuse control. Credential endpoints get a much tighter budget than the rest of the
 * API. Behind a reverse proxy the web app must forward `X-Forwarded-For` and the API
 * keeps `trust proxy` enabled (see `app.ts`) so the limiter sees real client IPs.
 */

const shared = {
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'too_many_requests', message: 'Too many requests, slow down' } },
};

export const apiRateLimit = rateLimit({
    ...shared,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
});

export const authRateLimit = rateLimit({
    ...shared,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
});
