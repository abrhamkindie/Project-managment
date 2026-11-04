import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { validate, input } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as authService from '../services/auth.service.js';
import { loginWithGoogle } from '../services/google-auth.service.js';
import {
    clearSessionCookies,
    readRefreshToken,
    revokeAllSessions,
    revokeSession,
    rotateSession,
    setSessionCookies,
} from '../services/session.js';
import { Unauthorized } from '../domain/errors.js';
import { fingerprint } from '../lib/crypto.js';
import {
    changePasswordSchema,
    forgotPasswordSchema,
    loginSchema,
    registerSchema,
    resetPasswordSchema,
    resetTokenQuerySchema,
    updateProfileSchema,
    type ChangePasswordInput,
    type ForgotPasswordInput,
    type LoginInput,
    type RegisterInput,
    type ResetPasswordInput,
    type UpdateProfileInput,
} from '../domain/schemas.js';
import { authRateLimit, credentialLimit } from '../middleware/rateLimit.js';
import type { Request } from 'express';

/**
 * Session endpoints.
 *
 * Login/register issue the httpOnly cookie pair, so the browser (and only the browser)
 * holds credentials. `refresh` is what the web client calls once the access token has
 * expired; `logout` revokes the current refresh token, `DELETE /sessions` revokes all.
 */
export const authRouter = Router();

function sessionMeta(req: Request) {
    return {
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        ip: req.ip,
    };
}

/** `ip + the account being attacked`, hashed: a durable counter that leaks no PII. */
function accountTarget(req: Request) {
    const email = String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase();
    return `${req.ip ?? 'unknown'}:${fingerprint(email)}`;
}

const anonymousTarget = (req: Request) => req.ip ?? 'unknown';

authRouter.post(
    '/register',
    authRateLimit,
    validate(registerSchema),
    asyncHandler(async (req, res) => {
        const { userId, tokens } = await authService.register(input<RegisterInput>(req), sessionMeta(req));
        setSessionCookies(res, tokens);
        res.status(201).json(await authService.profile(userId));
    }),
);

authRouter.post(
    '/login',
    authRateLimit,
    credentialLimit({ bucket: 'login', identity: accountTarget }),
    validate(loginSchema),
    asyncHandler(async (req, res) => {
        const { userId, tokens } = await authService.login(input<LoginInput>(req), sessionMeta(req));
        setSessionCookies(res, tokens);
        res.json(await authService.profile(userId));
    }),
);

// ------------------------------------------------------------- password recovery

authRouter.post(
    '/forgot-password',
    authRateLimit,
    credentialLimit({ bucket: 'pw-forgot', identity: accountTarget }),
    validate(forgotPasswordSchema),
    asyncHandler(async (req, res) => {
        res.json(await authService.requestPasswordReset(input<ForgotPasswordInput>(req).email));
    }),
);

/** Lets the reset screen validate its link (and name the address) before asking for input. */
authRouter.get(
    '/password-reset',
    credentialLimit({ bucket: 'pw-state', identity: anonymousTarget, limit: 30 }),
    validate(resetTokenQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        res.json(await authService.passwordResetState(input<{ token: string }>(req, 'query').token));
    }),
);

authRouter.post(
    '/reset-password',
    authRateLimit,
    credentialLimit({ bucket: 'pw-reset', identity: anonymousTarget }),
    validate(resetPasswordSchema),
    asyncHandler(async (req, res) => {
        const { token, password } = input<ResetPasswordInput>(req);
        await authService.resetPassword(token, password);
        // A reset kills every session, so this one cannot be kept either.
        clearSessionCookies(res);
        res.json({ ok: true, message: 'Password changed, sign in with the new one' });
    }),
);

authRouter.post(
    '/refresh',
    asyncHandler(async (req, res) => {
        const raw = readRefreshToken(req);
        if (!raw) throw new Unauthorized('No session to refresh');
        const { userId, tokens } = await rotateSession(raw, sessionMeta(req));
        setSessionCookies(res, tokens);
        res.json(await authService.profile(userId));
    }),
);

authRouter.post(
    '/logout',
    asyncHandler(async (req, res) => {
        const raw = readRefreshToken(req);
        if (raw) await revokeSession(raw);
        clearSessionCookies(res);
        res.json({ ok: true });
    }),
);

authRouter.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
        res.json(await authService.profile(currentUser(req).id));
    }),
);

/** Active devices, so a user can see and revoke sessions they do not recognise. */
authRouter.get(
    '/sessions',
    authenticate,
    asyncHandler(async (req, res) => {
        const items = await prisma.refreshToken.findMany({
            where: { userId: currentUser(req).id, revokedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
            orderBy: { createdAt: 'desc' },
            take: 25,
        });
        res.json({ items });
    }),
);

authRouter.delete(
    '/sessions',
    authenticate,
    asyncHandler(async (req, res) => {
        await revokeAllSessions(currentUser(req).id);
        clearSessionCookies(res);
        res.json({ ok: true });
    }),
);

authRouter.patch(
    '/profile',
    authenticate,
    validate(updateProfileSchema),
    asyncHandler(async (req, res) => {
        const user = currentUser(req);
        await authService.updateProfile(user.id, input<UpdateProfileInput>(req));
        // Same envelope as /auth/me, so the client can drop the response straight into its
        // session cache after a profile edit.
        res.json(await authService.profile(user.id));
    }),
);

authRouter.post(
    '/password',
    authenticate,
    authRateLimit,
    validate(changePasswordSchema),
    asyncHandler(async (req, res) => {
        const { currentPassword, newPassword } = input<ChangePasswordInput>(req);
        await authService.changePassword(currentUser(req).id, currentPassword, newPassword);
        clearSessionCookies(res);
        res.json({ ok: true, message: 'Password changed, sign in again' });
    }),
);

// ---------------------------------------------------------------- Google OAuth

const googleSchema = z.object({ idToken: z.string().min(1, 'Google ID token is required') });

authRouter.post(
    '/google',
    authRateLimit,
    validate(googleSchema),
    asyncHandler(async (req, res) => {
        const { idToken } = input<{ idToken: string }>(req);
        const { userId, tokens } = await loginWithGoogle(idToken, sessionMeta(req));
        setSessionCookies(res, tokens);
        res.json(await authService.profile(userId));
    }),
);
