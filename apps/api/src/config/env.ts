import 'dotenv/config';
import { z } from 'zod';
import { durationSeconds } from '../lib/time.js';

/**
 * Every runtime knob of the API lives here. Validation is strict: the process
 * refuses to boot with a misconfigured environment instead of failing at request
 * time. Nothing else in the codebase reads `process.env` directly.
 */
const Booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default('1.0.0'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  WEB_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: Booleanish.default(false),
  COOKIE_DOMAIN: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),

  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Atlas <no-reply@atlas.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  CRON_ENABLED: Booleanish.default(true),
  DUE_REMINDER_CRON: z.string().default('0 8 * * *'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = Schema.safeParse(process.env);

if (!parsed.success) {
  // Printed to stdout on purpose so it survives in container logs.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** Numeric TTLs (seconds) shared by JWT expiry and cookie `Max-Age`. */
  ACCESS_TOKEN_SECONDS: durationSeconds(parsed.data.ACCESS_TOKEN_TTL),
  REFRESH_TOKEN_SECONDS: parsed.data.REFRESH_TOKEN_TTL_DAYS * 86_400,
  get isProd() {
    return parsed.data.NODE_ENV === 'production';
  },
  get isTest() {
    return parsed.data.NODE_ENV === 'test';
  },
  get corsOrigins() {
    return parsed.data.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  },
};

export type Env = typeof env;

if (env.isProd && parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
  console.error('Refusing to start in production with the development JWT secret.');
  process.exit(1);
}
