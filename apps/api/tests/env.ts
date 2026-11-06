/**
 * Environment for the test worker.
 *
 * This module has no imports on purpose: it is the first thing `tests/setup.ts`
 * imports, so these values are in `process.env` before `src/config/env.ts` (and its
 * `dotenv/config`) is evaluated. That ordering is what keeps the suite off `dev.db`.
 *
 * bcrypt is dialed down and rate limiting is switched off: both are configuration, and
 * they are covered by `tests/permissions.test.ts` and the smoke script, not by these
 * integration tests.
 */
export const TEST_ENV: Record<string, string> = {
    NODE_ENV: 'test',
    // Prisma resolves relative SQLite paths against `prisma/`, so this lands on
    // `apps/api/prisma/test.db` — the same file `TEST_DB_FILE` points at below.
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-not-a-real-one',
    JWT_REFRESH_SECRET: 'test-refresh-secret-not-a-real-one',
    ACCESS_TOKEN_TTL: '15m',
    BCRYPT_ROUNDS: '4',
    LOG_LEVEL: 'silent',
    MAIL_DRIVER: 'console',
    CRON_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: './uploads/test',
    COOKIE_SECURE: 'false',
    WEB_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_MAX: '1000000',
    AUTH_RATE_LIMIT_MAX: '1000000',
    // Durable credential counters are covered by their own unit test, not by every
    // integration spec that logs in repeatedly.
    CREDENTIAL_RATE_LIMIT: '1000000',
    // Generic OIDC is exercised against a stub issuer (`tests/oidc.test.ts`), so the provider
    // counts as configured for the whole run — no test reaches out to a real identity provider.
    OIDC_ISSUER_BASE_URL: 'https://idp.test',
    OIDC_CLIENT_ID: 'zorqen-test-client',
    OIDC_CLIENT_SECRET: 'zorqen-test-secret',
};

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;

/** Absolute path of the throwaway database, for the code that creates and drops it. */
export const TEST_DB_FILE = new URL('../prisma/test.db', import.meta.url).pathname;
export const TEST_UPLOAD_DIR = new URL('../uploads/test', import.meta.url).pathname;
