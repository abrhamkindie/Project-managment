import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Case-insensitive "contains" that stays correct on both supported databases.
 *
 * The schema is authored once for SQLite (dev/test) and PostgreSQL (production). Prisma
 * only exposes `mode: 'insensitive'` for PostgreSQL, and SQLite's `LIKE` already folds
 * ASCII case — so passing `mode` on SQLite throws at query time. Branching here keeps
 * search behaving the same in both environments instead of silently turning
 * case-sensitive the moment the app runs on its production database.
 */
export function contains(value: string): Prisma.StringFilter {
    const term = value.trim();
    if (env.isPostgres) return { contains: term, mode: 'insensitive' } as unknown as Prisma.StringFilter;
    return { contains: term };
}
