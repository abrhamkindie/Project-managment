import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** URL-safe random secret (invitations, refresh tokens). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Refresh tokens are stored hashed so a database leak cannot be replayed. */
export const hashSecret = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Short stable fingerprint for a value that must appear in a log or a key but never in
 * full (client IPs, e-mail addresses). Not a security boundary — just non-reversible
 * enough that a table of counters does not leak who requested what.
 */
export const fingerprint = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

export function slugify(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

/** `acme` -> `acme`, `acme-2`, `acme-3`, ... for unique slugs. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
    const root = slugify(base) || 'org';
    for (let i = 1; i <= 50; i += 1) {
        const candidate = i === 1 ? root : `${root}-${i}`;
        if (!(await exists(candidate))) return candidate;
    }
    // Numbered suffixes are exhausted (public sign-up pages can get here): use randomness
    // rather than returning a slug we already know is taken.
    for (let i = 0; i < 5; i += 1) {
        const candidate = `${root}-${crypto.randomBytes(3).toString('hex')}`;
        if (!(await exists(candidate))) return candidate;
    }
    throw new Error(`Could not reserve a slug for "${base}"`);
}

/**
 * Fractional ranking: insert between two neighbours without renumbering the whole list.
 * Used by the Kanban board so dragging one card is a single-row update.
 */
export function rankBetween(before: number | null, after: number | null): number {
    if (before === null && after === null) return 1000;
    if (before === null) return (after as number) / 2;
    if (after === null) return before + 1000;
    return (before + after) / 2;
}
