import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { TooMany } from '../domain/errors.js';

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

/**
 * Durable fixed-window counter for the endpoints an attacker targets with stolen
 * credentials: the in-memory limiter above is per-process, so its counters vanish on
 * every deploy and multiply across replicas. These rows are shared by all of them.
 *
 * The window is encoded in the key, so a hit is one atomic upsert and no cleanup is
 * required beyond the housekeeping job. Counting is best-effort by design: a lost race
 * costs one unit of budget, never the protection itself.
 *
 * `identity` decides what is rate limited — an IP for anonymous endpoints, an account
 * for password changes — and is hashed because it can be a secret-adjacent value.
 */
export function credentialLimit(options: {
    bucket: string;
    identity: (req: Parameters<RequestHandler>[0]) => string;
    limit?: number;
    windowMs?: number;
}): RequestHandler {
    const limit = options.limit ?? env.CREDENTIAL_RATE_LIMIT;
    const windowMs = options.windowMs ?? env.CREDENTIAL_RATE_WINDOW_MS;

    return async (req, _res, next) => {
        try {
            if (limit <= 0) return next();
            const window = Math.floor(Date.now() / windowMs);
            const bucketKey = `${options.bucket}:${window}:${options.identity(req)}`;
            const row = await prisma.rateLimitBucket.upsert({
                where: { bucketKey },
                create: { bucketKey, count: 1, windowStart: new Date(window * windowMs), expiresAt: new Date((window + 1) * windowMs) },
                update: { count: { increment: 1 } },
            });
            // The row answers with the incremented value, so two replicas racing on the same
            // window still get one budget between them rather than each thinking they were first.
            if (row.count > limit) return next(new TooMany('Too many attempts, try again later'));
        } catch {
            // A counter that cannot be written must not lock honest users out of the
            // product; the in-memory limiter still applies to the same route.
            return next();
        }
        return next();
    };
}
