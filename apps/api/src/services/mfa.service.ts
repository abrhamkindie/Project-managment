import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { BadRequest, Unauthorized } from '../domain/errors.js';
import { decryptSecret, encryptSecret, hashSecret, verifyPassword } from '../lib/crypto.js';
import { createSession, type SessionTokens } from './session.js';
import type { SessionMeta } from './auth.service.js';
import type { AuthUser } from '../types/express.js';

/**
 * Two-factor authentication (TOTP).
 *
 * The seed is stored AES-encrypted (`lib/crypto.ts`) on the user row and is only ever decrypted to
 * compare a six-digit code. Enabling MFA issues eight single-use backup codes; their hashes are the
 * only thing kept, and each is consumed by marking `usedAt` — a code that no longer works is still
 * kept as evidence for the audit trail.
 *
 * Login is deliberately split in two: `/auth/login` verifies the password and returns a short-lived
 * challenge instead of a session, and only `/auth/mfa/verify` mints cookies. That way a leaked
 * password alone can never produce a working session, which is the entire point of enabling MFA.
 */

/** Setup and login steps are both meant to be finished within a couple of minutes. */
const CHALLENGE_TTL_SECONDS = 5 * 60;
const RECOVERY_CODE_COUNT = 8;

// One step of drift either way: phones are rarely exactly in sync, and a stricter window just
// pushes people to disable MFA altogether.
authenticator.options = { window: 1 };

export interface MfaStatus {
    enabled: boolean;
    /** A secret is held while the user is mid-enrollment, before `enabled` flips. */
    pendingSetup: boolean;
    recoveryCodesLeft: number;
}

export async function mfaStatus(user: AuthUser): Promise<MfaStatus> {
    const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { mfaEnabled: true, mfaSecret: true, recoveryCodes: { where: { usedAt: null }, select: { id: true } } },
    });
    return {
        enabled: row.mfaEnabled,
        pendingSetup: !row.mfaEnabled && Boolean(row.mfaSecret),
        recoveryCodesLeft: row.recoveryCodes.length,
    };
}

/**
 * Start (or restart) enrollment. The secret is persisted immediately so a page refresh does not
 * invalidate the QR code the user is about to scan; nothing is enforced until `enableMfa` succeeds.
 */
export async function beginSetup(user: AuthUser) {
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret) } });

    const otpauthUrl = authenticator.keyuri(user.email, 'ZORQEN', secret);
    return {
        secret,
        otpauthUrl,
        /** Data URL, so the browser never sends a secret to a third-party QR service. */
        qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1 }),
        /** Proof the scan worked before MFA is switched on. */
        currentCode: authenticator.generate(secret),
    };
}

/** Recovery codes are shown once, so they stay readable: six hex chars, dash-separated. */
function generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
        `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase(),
    );
}

const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
    await prisma.otpRecoveryCode.deleteMany({ where: { userId } });
    const codes = generateRecoveryCodes();
    await prisma.otpRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashSecret(normalizeCode(code)) })),
    });
    return codes;
}

/**
 * Confirm the scanned secret and turn enforcement on. Returns the backup codes — the only time
 * their plaintext exists.
 */
export async function enableMfa(user: AuthUser, code: string) {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaSecret: true } });
    const secret = decryptSecret(row.mfaSecret);
    if (!secret) throw new BadRequest('Start setup again — no pending authenticator secret');
    if (!authenticator.check(code.trim(), secret)) throw new BadRequest('That code is not valid right now');

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    const recoveryCodes = await replaceRecoveryCodes(user.id);
    return { enabled: true, recoveryCodes };
}

/**
 * Turn MFA off. The password is re-checked because this endpoint sits behind a session cookie that
 * may be living in a shared browser, and disabling two factors is not something to do on sight.
 */
export async function disableMfa(user: AuthUser, password: string) {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!row.passwordHash) throw new BadRequest('Single sign-on accounts cannot disable two-factor this way');
    if (!(await verifyPassword(password, row.passwordHash))) throw new BadRequest('Password does not match');

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
    await prisma.otpRecoveryCode.deleteMany({ where: { userId: user.id } });
    return { enabled: false };
}

/** New backup codes on demand (losing the printed ones is the common reason). */
export async function regenerateRecoveryCodes(user: AuthUser) {
    if (!(await isEnrolled(user.id))) throw new BadRequest('Two-factor is not enabled');
    return { recoveryCodes: await replaceRecoveryCodes(user.id) };
}

export async function isEnrolled(userId: string): Promise<boolean> {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
    return Boolean(row?.mfaEnabled);
}

/** Short-lived, signed proof that the password step passed. Cannot be used as an access token. */
export function signChallenge(userId: string): string {
    return jwt.sign({ sub: userId, purpose: 'mfa' }, env.JWT_ACCESS_SECRET, {
        expiresIn: CHALLENGE_TTL_SECONDS,
        issuer: 'zorqen-api',
        // A distinct audience is what keeps this from being accepted by `verifyAccessToken`.
        audience: 'zorqen-mfa',
    });
}

export function readChallenge(token: string): string {
    try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'zorqen-api', audience: 'zorqen-mfa' });
        if (typeof decoded === 'string' || !decoded.sub) throw new Error('malformed');
        return decoded.sub;
    } catch {
        throw new Unauthorized('The verification step expired, sign in again');
    }
}

export interface MfaLoginResult {
    userId: string;
    tokens: SessionTokens;
    /** Which factor was used, so the audit log can distinguish a TOTP code from a backup code. */
    via: 'totp' | 'recovery';
}

/**
 * Second login step. TOTP first, then backup codes: a consumed recovery code is marked rather than
 * deleted, so the row count is what "codes left" reports.
 */
export async function completeLogin(challenge: string, code: string, meta: SessionMeta): Promise<MfaLoginResult> {
    const userId = readChallenge(challenge);
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, mfaEnabled: true, mfaSecret: true },
    });
    if (!user || !user.isActive) throw new Unauthorized('Account is not available');
    if (!user.mfaEnabled) throw new Unauthorized('Two-factor is not enabled for this account');

    const secret = decryptSecret(user.mfaSecret);
    if (secret && authenticator.check(code.trim(), secret)) {
        return { userId: user.id, tokens: await createSession(user.id, meta), via: 'totp' };
    }

    const codeHash = hashSecret(normalizeCode(code.trim()));
    const recovery = await prisma.otpRecoveryCode.findFirst({ where: { userId, codeHash, usedAt: null } });
    if (recovery) {
        await prisma.otpRecoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } });
        return { userId: user.id, tokens: await createSession(user.id, meta), via: 'recovery' };
    }

    throw new Unauthorized('That code is not valid');
}
