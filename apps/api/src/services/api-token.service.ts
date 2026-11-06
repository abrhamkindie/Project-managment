import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Forbidden, NotFound, Unauthorized } from '../domain/errors.js';
import { hashSecret, randomToken } from '../lib/crypto.js';
import { API_TOKEN_PREFIX, type ApiTokenScope } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import type { CreateApiTokenInput } from '../domain/schemas.js';

/**
 * Personal access tokens.
 *
 * A token is a long-lived bearer credential for scripts and integrations, so it follows the
 * refresh-token rules: only the SHA-256 digest is stored, the plaintext is returned once at
 * creation, and revocation is a timestamp rather than a delete so the audit list keeps its rows.
 *
 * Scopes are checked by name, not hierarchy: `read` covers safe methods, `write` covers the rest,
 * and `*` is the only scope that grants both. A token can never do anything its owner cannot —
 * authorization still runs through the same `can()` rules as a browser session.
 */

/** `lastUsedAt` is a convenience for the settings list, not an audit trail: one write per 5 min. */
const LAST_USED_THROTTLE_MS = 5 * 60_000;

const DAY_MS = 86_400_000;

export function parseScopes(raw: string): ApiTokenScope[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item): item is ApiTokenScope => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

/** `*` swallows the narrower scopes, so a token never shows `read, write, *` in the UI. */
function normalizeScopes(scopes: ApiTokenScope[]): ApiTokenScope[] {
    const unique = [...new Set(scopes)];
    return unique.includes('*') ? ['*'] : unique;
}

export function scopeAllows(scopes: readonly string[], required: ApiTokenScope): boolean {
    return scopes.includes('*') || scopes.includes(required);
}

/**
 * Which scope a request needs. `GET`/`HEAD`/`OPTIONS` are reads by HTTP contract; everything
 * else mutates, including the odd read that is modelled as a POST (search-with-body endpoints
 * are not part of this API, so there is no exception list to maintain).
 */
export function requiredScopeFor(method: string): ApiTokenScope {
    const upper = method.toUpperCase();
    return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS' ? 'read' : 'write';
}

export async function createToken(user: AuthUser, input: CreateApiTokenInput) {
    const scopes = normalizeScopes(input.scopes);
    if (scopes.length === 0) throw new BadRequest('Pick at least one scope');
    const secret = `${API_TOKEN_PREFIX}${randomToken(30)}`;

    const row = await prisma.apiToken.create({
        data: {
            userId: user.id,
            name: input.name,
            tokenHash: hashSecret(secret),
            scopes: JSON.stringify(scopes),
            expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
        },
    });

    return {
        id: row.id,
        name: row.name,
        scopes: parseScopes(row.scopes),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        /** Shown once. There is no way to read this back, by design. */
        token: secret,
    };
}

export async function listTokens(userId: string) {
    const rows = await prisma.apiToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
    });
    const now = Date.now();
    return rows.map((row) => ({
        ...row,
        scopes: parseScopes(row.scopes),
        /** Derived so the UI has one boolean to render instead of three date comparisons. */
        status: row.revokedAt ? ('revoked' as const) : row.expiresAt && row.expiresAt.getTime() < now ? ('expired' as const) : ('active' as const),
    }));
}

/**
 * Revoke by id. Only the owner can revoke their own token — an admin who could revoke other
 * people's tokens would be able to silently break their integrations, which is not a power the
 * organization role carries anywhere else.
 */
export async function revokeToken(userId: string, id: string) {
    const row = await prisma.apiToken.findFirst({ where: { id, userId }, select: { id: true, revokedAt: true } });
    if (!row) throw new NotFound('No such token');
    if (!row.revokedAt) {
        await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    }
    return { id: row.id, revoked: true };
}

export interface TokenIdentity {
    token: Prisma.ApiTokenGetPayload<{ include: { user: true } }>;
    scopes: ApiTokenScope[];
}

/** Resolve a presented token to its owner. Throws `Unauthorized` for anything unusable. */
export async function resolveApiToken(secret: string): Promise<TokenIdentity> {
    const row = await prisma.apiToken.findUnique({
        where: { tokenHash: hashSecret(secret) },
        include: { user: true },
    });
    if (!row || row.revokedAt) throw new Unauthorized('Token is not valid');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new Unauthorized('Token has expired');
    if (!row.user.isActive) throw new Unauthorized('Account is not available');

    const lastUsed = row.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
        // Never block the request on bookkeeping.
        void prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { token: row, scopes: parseScopes(row.scopes) };
}

/**
 * Scope gate for a token-authenticated request. Kept in the service so tests can call it directly
 * and the middleware stays a three-line branch.
 */
export function assertScope(scopes: readonly string[], method: string) {
    const required = requiredScopeFor(method);
    if (!scopeAllows(scopes, required)) {
        throw new Forbidden(`This token does not have the ${required} scope`);
    }
}
