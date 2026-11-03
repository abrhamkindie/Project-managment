import type { Page } from './types';

/**
 * One HTTP entry point for every API call, in the browser and on the server.
 *
 * Rules the whole app depends on:
 * - the browser always talks to its own origin (`/api/...`), which Next proxies to the API,
 *   so session cookies are first-party and no CORS preflight is involved;
 * - a 401 triggers exactly one `POST /auth/refresh` and a single retry. Rotating refresh
 *   tokens make a second concurrent refresh invalid, so parallel 401s share one promise;
 * - failures are always `ApiError`, carrying the server's `code`/`details` so forms can
 *   show field-level messages instead of guessing.
 */

const PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || '/api';
const SERVER_URL = process.env.API_SERVER_URL || 'http://127.0.0.1:4000';

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }

    /** True when nobody is signed in (or the session is gone) — pages redirect on this. */
    get isUnauthorized() {
        return this.status === 401;
    }

    /** Zod rejects the request body: `details` is `[{ path, message }]`. */
    get isValidation() {
        return this.code === 'validation_error';
    }

    /** Per-field messages for forms, keyed by dotted path (`title`, `assigneeIds.0`, ...). */
    get fieldErrors(): Record<string, string> {
        if (!Array.isArray(this.details)) return {};
        const out: Record<string, string> = {};
        for (const issue of this.details as { path?: string; message?: string }[]) {
            if (issue?.path && issue.message && !out[issue.path]) out[issue.path] = issue.message;
        }
        return out;
    }
}

/** `true` only in a browser: server components need the absolute upstream URL. */
export const isBrowser = typeof window !== 'undefined';

function url(path: string) {
    return isBrowser ? `${PREFIX}${path}` : `${SERVER_URL}${PREFIX}${path}`;
}

export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** Sent raw (multipart) — the browser sets the content type and boundary. */
    form?: FormData;
    query?: Record<string, string | number | boolean | readonly (string | number)[] | undefined | null>;
    signal?: AbortSignal;
    /** Server components forward the visitor's cookies to the API proxy. */
    headers?: Record<string, string>;
    /** Opt out of the automatic refresh-and-retry (used by the refresh call itself). */
    retryOn401?: boolean;
    cache?: RequestCache;
}

function queryString(query?: RequestOptions['query']): string {
    if (!query) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}

async function parse(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        // A proxy or the API can answer with HTML (502 page, health check); keep it readable.
        return { error: { code: 'bad_response', message: text.slice(0, 200) } };
    }
}

/** Shared refresh so five parallel 401s cause one token rotation, not five. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(headers?: Record<string, string>): Promise<boolean> {
    if (!refreshInFlight) {
        refreshInFlight = (async () => {
            try {
                const response = await fetch(url('/auth/refresh'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
                });
                return response.ok;
            } catch {
                return false;
            }
        })().then((ok) => {
            // Reset after settling, so every waiter shares one rotation.
            refreshInFlight = null;
            return ok;
        });
    }
    return refreshInFlight;
}

function toError(status: number, payload: unknown): ApiError {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    return new ApiError(status, error?.code ?? 'request_failed', error?.message ?? `Request failed (${status})`, error?.details);
}

/** Performs the request; returns the parsed body or throws `ApiError`. */
async function send<T>(path: string, options: RequestOptions): Promise<T> {
    const response = await fetch(url(path) + queryString(options.query), {
        method: options.method ?? 'GET',
        credentials: 'include',
        signal: options.signal,
        cache: options.cache ?? 'no-store',
        headers: {
            accept: 'application/json',
            ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...options.headers,
        },
        body: options.form ? options.form : options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const payload = await parse(response);
    if (!response.ok) throw toError(response.status, payload);
    return payload as T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    try {
        return await send<T>(path, options);
    } catch (error) {
        const retryable =
            error instanceof ApiError &&
            error.isUnauthorized &&
            options.retryOn401 !== false &&
            !path.startsWith('/auth/');
        if (!retryable) throw error;

        // Expired access token: refresh once, then replay the original call.
        if (!(await refreshSession(options.headers))) throw error;
        return send<T>(path, options);
    }
}

export const api = {
    get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'POST', body }),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PATCH', body }),
    put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: 'PUT', body }),
    del: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
    upload: <T>(path: string, form: FormData, options?: RequestOptions) => request<T>(path, { ...options, method: 'POST', form }),
};

/** Download links are plain hrefs: the browser sends the session cookie itself. */
export function absoluteUrl(path: string): string {
    return isBrowser ? path : `${SERVER_URL}${path}`;
}

/** Convenience for endpoints that return a bare array instead of a page envelope. */
export async function list<T>(path: string, query?: RequestOptions['query']): Promise<T[]> {
    const payload = await request<{ items?: T[] } | T[]>(path, { query });
    return Array.isArray(payload) ? payload : (payload.items ?? []);
}

export async function page<T>(path: string, query?: RequestOptions['query']): Promise<Page<T>> {
    return request<Page<T>>(path, { query });
}
