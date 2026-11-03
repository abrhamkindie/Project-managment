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
    // The API is reached through these rewrites; nothing else in the app hard-codes its host.
    async rewrites() {
        return [
            { source: '/api/:path*', destination: `${apiServer}/api/:path*` },
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
