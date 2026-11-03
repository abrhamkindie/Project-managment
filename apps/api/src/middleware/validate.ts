import type { Request, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { BadRequest } from '../domain/errors.js';

type Part = 'body' | 'query' | 'params';

/**
 * Validate one part of the request against a Zod schema and cache the coerced result.
 * Handlers read the parsed value through `input()` so they always work with trusted,
 * typed data instead of raw strings.
 */
export function validate(schema: ZodTypeAny, part: Part = 'body'): RequestHandler {
    return (req, _res, next) => {
        const result = schema.safeParse(req[part] ?? {});
        if (!result.success) {
            return next(
                new BadRequest(
                    'Request failed validation',
                    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
                ),
            );
        }
        req.parsed = { ...(req.parsed ?? {}), [part]: result.data };
        if (part === 'body') req.body = result.data;
        return next();
    };
}

export function input<T>(req: Request, part: Part = 'body'): T {
    return (req.parsed?.[part] ?? {}) as T;
}

export type Infer<S extends ZodTypeAny> = z.infer<S>;
