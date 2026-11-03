import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { hashSecret, randomToken } from '../lib/crypto.js';
import { addSeconds } from '../lib/time.js';
import { signAccessToken } from '../lib/tokens.js';
import { Unauthorized } from '../domain/errors.js';

/**
 * Session handling: short-lived JWT access token + single-use rotating refresh token
 * stored (hashed) in the database. Both travel as httpOnly cookies, so no token is ever
 * readable from JavaScript — the XSS blast radius stays limited to reading data a user
 * can already see.
 */

export const ACCESS_COOKIE = 'atlas_at';
export const REFRESH_COOKIE = 'atlas_rt';

function cookieBase(): CookieOptions {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE,
        domain: env.COOKIE_DOMAIN || undefined,
        path: '/',
    };
}

export interface SessionTokens {
    accessToken: string;
    refreshToken: string;
    accessExpiresIn: number;
    refreshExpiresIn: number;
}

export function setSessionCookies(res: Response, tokens: SessionTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
        ...cookieBase(),
        maxAge: tokens.accessExpiresIn * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        ...cookieBase(),
        maxAge: tokens.refreshExpiresIn * 1000,
    });
}

export function clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, cookieBase());
    res.clearCookie(REFRESH_COOKIE, cookieBase());
}

export async function createSession(
    userId: string,
    meta: { userAgent?: string; ip?: string } = {},
): Promise<SessionTokens> {
    const raw = randomToken(48);
    const [user, stored] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, isActive: true } }),
        prisma.refreshToken.create({
            data: {
                userId,
                tokenHash: hashSecret(raw),
                userAgent: meta.userAgent?.slice(0, 250),
                ip: meta.ip?.slice(0, 64),
                expiresAt: addSeconds(new Date(), env.REFRESH_TOKEN_SECONDS),
            },
        }),
    ]);
    if (!user.isActive) {
        await prisma.refreshToken.delete({ where: { id: stored.id } });
        throw new Unauthorized('This account has been deactivated');
    }
    return {
        accessToken: signAccessToken({ sub: user.id, email: user.email }),
        refreshToken: raw,
        accessExpiresIn: env.ACCESS_TOKEN_SECONDS,
        refreshExpiresIn: env.REFRESH_TOKEN_SECONDS,
    };
}

export function readRefreshToken(req: Request): string | null {
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (fromCookie) return fromCookie;
    const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    return fromBody ?? null;
}

/**
 * Rotate a refresh token. Re-use of an already rotated token is treated as theft:
 * every session for that user is revoked and the caller must sign in again.
 */
export async function rotateSession(
    rawToken: string,
    meta: { userAgent?: string; ip?: string } = {},
): Promise<{ userId: string; tokens: SessionTokens }> {
    const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashSecret(rawToken) },
        include: { user: { select: { id: true, email: true, isActive: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
        if (stored?.revokedAt) {
            await prisma.refreshToken.updateMany({
                where: { userId: stored.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
        throw new Unauthorized('Session is no longer valid, please sign in again');
    }
    if (!stored.user.isActive) throw new Unauthorized('This account has been deactivated');

    await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });

    const tokens = await createSession(stored.userId, meta);
    return { userId: stored.userId, tokens };
}

export async function revokeSession(rawToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashSecret(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

export async function revokeAllSessions(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
