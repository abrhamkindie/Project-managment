/**
 * Next.js configuration.
 *
 * The browser only ever talks to the web origin: `/api/*` and `/realtime/*` are proxied
 * to the API. That keeps session cookies first-party (no CORS, no cross-origin `SameSite`
 * gymnastics) and means the same build works behind any reverse proxy. In production the
 * container image does not need these rewrites — nginx/compose routes the same paths —
 * but keeping them makes `next start` self-sufficient for smoke tests.
 */
const apiServer = process.env.API_SERVER_URL ?? 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const config = {
    reactStrictMode: true,
    poweredByHeader: false,
    // Small, self-contained server bundle for the Docker image.
    output: 'standalone',
    // engine.io addresses the socket as `/realtime/`, and a trailing-slash redirect is fatal for
    // it: a WebSocket handshake cannot follow one and the polling fallback reports the 3xx as an
    // error. The cost is that a page now renders with or without its trailing slash instead of
    // being normalised — which a front door (nginx, ALB) canonicalises anyway.
    skipTrailingSlashRedirect: true,
    // The API is reached through these rewrites; nothing else in the app hard-codes its host.
    async rewrites() {
        return [
            { source: '/api/:path*', destination: `${apiServer}/api/:path*` },
            // Socket.IO asks for `<path>/?EIO=4&…`, and every other engine.io request lives under
            // that same prefix, so both shapes are declared: the bare path is what a client that
            // followed a redirect would send, the prefixed one is what it actually sends.
            { source: '/realtime', destination: `${apiServer}/realtime/` },
            { source: '/realtime/:path*', destination: `${apiServer}/realtime/:path*` },
        ];
    },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ];
    },
};

export default config;
