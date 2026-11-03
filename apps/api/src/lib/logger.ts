import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logs in production (parsed by Datadog/ELK/Loki), human readable in
 * development. Redaction below is what keeps secrets out of log drains.
 */
export const logger = pino({
    level: env.isTest ? 'silent' : env.LOG_LEVEL,
    base: { service: 'atlas-api', env: env.NODE_ENV },
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'newPassword',
            'currentPassword',
            'token',
            'refreshToken',
            '*.passwordHash',
            '*.tokenHash',
        ],
        censor: '[redacted]',
    },
    transport:
        env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } }
            : undefined,
});

export type Logger = typeof logger;
