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

/**
 * AES-256-GCM envelope for small secrets that must be readable at runtime (the TOTP seed).
 *
 * `hashSecret` cannot serve here: a TOTP secret has to be decrypted on every verification,
 * so it needs a reversible store. The key is derived from `APP_ENCRYPTION_KEY`, falling back
 * to the access-token secret so an existing deployment boots without a new env var — rotating
 * either one invalidates stored secrets, which is why the version byte is in the payload.
 */
const SECRET_PREFIX = 'v1';

function encryptionKey(): Buffer {
    return crypto
        .createHash('sha256')
        .update(env.APP_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET)
        .digest();
}

export function encryptSecret(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [SECRET_PREFIX, iv.toString('base64url'), data.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** `null` for anything that was not produced here or has been tampered with. */
export function decryptSecret(value: string | null | undefined): string | null {
    if (!value) return null;
    const [version, iv, data, tag] = value.split('.');
    if (version !== SECRET_PREFIX || !iv || !data || !tag) return null;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

/** Constant-time compare of two hex digests; lengths must match before any byte is read. */
export function safeEqualHex(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

/** HMAC-SHA256 hex digest — the webhook payload signature. */
export const hmacSha256 = (secret: string, payload: string) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');
