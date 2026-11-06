import "dotenv/config";
import { z } from "zod";
import { durationSeconds } from "../lib/time.js";

/**
 * Every runtime knob of the API lives here. Validation is strict: the process
 * refuses to boot with a misconfigured environment instead of failing at request
 * time. Nothing else in the codebase reads `process.env` directly.
 */
const Booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean"
      ? v
      : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
  );

const Schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  APP_VERSION: z.string().default("1.0.0"),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  /** Lifetime of a "forgot password" link. Short, because it is a bearer credential by e-mail. */
  PASSWORD_RESET_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(1440)
    .default(60),
  /**
   * Budget for the credential endpoints, enforced durably in the database (see
   * `middleware/rateLimit.ts`) so it survives a restart and is shared by every replica.
   */
  CREDENTIAL_RATE_LIMIT: z.coerce.number().int().positive().default(8),
  CREDENTIAL_RATE_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),

  /**
   * How recently a realtime heartbeat must have arrived for somebody to still count as online.
   * The web client beats once a minute, so this tolerates two lost beats before the dot greys.
   */
  PRESENCE_STALE_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(150),

  WEB_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: Booleanish.default(false),
  COOKIE_DOMAIN: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),

  MAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("ZORQEN <no-reply@zorqen.local>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  CRON_ENABLED: Booleanish.default(true),
  DUE_REMINDER_CRON: z.string().default("0 8 * * *"),
  HOUSEKEEPING_CRON: z.string().default("30 3 * * *"),
  /** Recurring-task materialisation sweep; hourly so a completed instance re-issues same-day. */
  RECURRENCE_CRON: z.string().default("15 * * * *"),
  /** Inbox hygiene: notifications older than this are pruned by the housekeeping job. */
  NOTIFICATION_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(7)
    .max(365)
    .default(90),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  /** Cards per Kanban column before the board has to page the rest in from the API. */
  BOARD_SECTION_TASK_LIMIT: z.coerce
    .number()
    .int()
    .min(10)
    .max(2000)
    .default(200),
  /** Timeline rows (activity + comments) loaded when a task drawer opens. */
  TIMELINE_ITEM_LIMIT: z.coerce.number().int().min(20).max(1000).default(200),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Symmetric key for secrets that must be readable at runtime (the TOTP seed). Optional: the
   * access-token secret is used as the KDF input when unset, so existing deployments keep booting.
   */
  APP_ENCRYPTION_KEY: z.string().min(16).optional(),

  /** Generic OIDC SSO (Keycloak, Authentik, Okta, Entra tenant...). All three must be set. */
  OIDC_ISSUER_BASE_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /** Optional override for issuers whose discovery document advertises a public-facing URL. */
  OIDC_REDIRECT_URL: z.string().optional(),
  /** Extra `audience` claim accepted besides the client id (multi-audience IdPs). */
  OIDC_AUDIENCE: z.string().optional(),

  /** Outbound webhook HTTP budget; a slow receiver must never hold the request that fired it. */
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  /** Attempts before a delivery is abandoned as failed. */
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  /** Retry sweep; DB polling rather than a queue so Redis stays optional. */
  WEBHOOK_RETRY_CRON: z.string().default("*/5 * * * *"),

  /** Redis configuration for Socket.IO scaling (required in production) */
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().int().positive().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).optional(),
});

const parsed = Schema.safeParse(process.env);

if (!parsed.success) {
  // Printed to stdout on purpose so it survives in container logs.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** Numeric TTLs (seconds) shared by JWT expiry and cookie `Max-Age`. */
  ACCESS_TOKEN_SECONDS: durationSeconds(parsed.data.ACCESS_TOKEN_TTL),
  REFRESH_TOKEN_SECONDS: parsed.data.REFRESH_TOKEN_TTL_DAYS * 86_400,
  get isProd() {
    return parsed.data.NODE_ENV === "production";
  },
  get isTest() {
    return parsed.data.NODE_ENV === "test";
  },
  /**
   * The schema is authored once for SQLite (dev/test) and PostgreSQL (production), but a
   * few query features are not portable: case-insensitive `contains` only exists on
   * PostgreSQL. Search helpers branch on this instead of failing at query time.
   */
  get isPostgres() {
    return (
      parsed.data.DATABASE_URL.startsWith("postgres://") ||
      parsed.data.DATABASE_URL.startsWith("postgresql://")
    );
  },
  get corsOrigins() {
    return parsed.data.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  },
  get redisConfig() {
    // Prefer REDIS_URL if provided, otherwise build from individual components
    if (parsed.data.REDIS_URL) {
      return { url: parsed.data.REDIS_URL };
    }
    if (parsed.data.REDIS_HOST && parsed.data.REDIS_PORT) {
      return {
        host: parsed.data.REDIS_HOST,
        port: parsed.data.REDIS_PORT,
        password: parsed.data.REDIS_PASSWORD,
        db: parsed.data.REDIS_DB ?? 0,
      };
    }
    // Return null for development without Redis
    return null;
  },
  get hasRedis(): boolean {
    return this.redisConfig !== null;
  },
  /** SSO providers that are actually usable; empty means the login page shows no buttons. */
  get oauthProviders(): Record<string, { clientId: string }> {
    const out: Record<string, { clientId: string }> = {};
    if (parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET) {
      out.google = { clientId: parsed.data.GOOGLE_CLIENT_ID };
    }
    if (
      parsed.data.OIDC_ISSUER_BASE_URL &&
      parsed.data.OIDC_CLIENT_ID &&
      parsed.data.OIDC_CLIENT_SECRET
    ) {
      out.oidc = { clientId: parsed.data.OIDC_CLIENT_ID };
    }
    return out;
  },
};

export type Env = typeof env;

if (env.isProd && parsed.data.JWT_ACCESS_SECRET.startsWith("dev-only")) {
  console.error(
    "Refusing to start in production with the development JWT secret.",
  );
  process.exit(1);
}
