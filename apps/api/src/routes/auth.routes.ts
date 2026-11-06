import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { validate, input } from '../middleware/validate.js';
import { authenticate, currentUser, requireSession } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as authService from '../services/auth.service.js';
import { loginWithGoogle } from '../services/oauth/google.service.js';
import * as oidc from '../services/oauth/oidc.service.js';
import { enabledProviders } from '../services/oauth/registry.js';
import * as mfa from '../services/mfa.service.js';
import {
    clearSessionCookies,
    readRefreshToken,
    revokeAllSessions,
    revokeSession,
    rotateSession,
    setSessionCookies,
} from '../services/session.js';
import { Unauthorized } from '../domain/errors.js';
import { env } from '../config/env.js';
import { fingerprint } from '../lib/crypto.js';
import {
    changePasswordSchema,
    forgotPasswordSchema,
    loginSchema,
    mfaChallengeSchema,
    mfaDisableSchema,
    mfaSetupVerifySchema,
    registerSchema,
    resetPasswordSchema,
    resetTokenQuerySchema,
    updateProfileSchema,
    type ChangePasswordInput,
    type ForgotPasswordInput,
    type LoginInput,
    type MfaChallengeInput,
    type MfaDisableInput,
    type MfaSetupVerifyInput,
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
        const result = await authService.login(input<LoginInput>(req), sessionMeta(req));
        // Second factor: no cookies are set, and the challenge is the only thing the caller holds.
        if (result.mfaRequired) {
            return res.json({ mfaRequired: true, challenge: mfa.signChallenge(result.userId) });
        }
        setSessionCookies(res, result.tokens);
        return res.json(await authService.profile(result.userId));
    }),
);

/** Which SSO buttons the login page may render, and the client ids they need. */
authRouter.get('/providers', asyncHandler(async (_req, res) => {
    res.json({ items: enabledProviders() });
}));

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
    requireSession,
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
        const result = await loginWithGoogle(idToken, sessionMeta(req));
        // An SSO account with two-factor enabled answers exactly like the password form, so the
        // client has one second-step screen instead of one per sign-in method.
        if (result.mfaRequired) {
            return res.status(200).json({ mfaRequired: true, challenge: mfa.signChallenge(result.userId) });
        }
        setSessionCookies(res, result.tokens);
        return res.json(await authService.profile(result.userId));
    }),
);

// ------------------------------------------------------------------- two-factor

authRouter.get('/mfa', authenticate, asyncHandler(async (req, res) => {
    res.json(await mfa.mfaStatus(currentUser(req)));
}));

/** New seed plus a QR data URL. Nothing is enforced until `/mfa/enable` proves the scan. */
authRouter.post('/mfa/setup', authenticate, requireSession, asyncHandler(async (req, res) => {
    res.json(await mfa.beginSetup(currentUser(req)));
}));

authRouter.post(
    '/mfa/enable',
    authenticate,
    requireSession,
    credentialLimit({ bucket: 'mfa-setup', identity: (req) => currentUser(req).id }),
    validate(mfaSetupVerifySchema),
    asyncHandler(async (req, res) => {
        res.json(await mfa.enableMfa(currentUser(req), input<MfaSetupVerifyInput>(req).code));
    }),
);

authRouter.post(
    '/mfa/disable',
    authenticate,
    requireSession,
    validate(mfaDisableSchema),
    asyncHandler(async (req, res) => {
        res.json(await mfa.disableMfa(currentUser(req), input<MfaDisableInput>(req).password));
    }),
);

/** Replace the backup-code set (losing the printed list is the usual reason). */
authRouter.post('/mfa/recovery-codes', authenticate, requireSession, asyncHandler(async (req, res) => {
    res.json(await mfa.regenerateRecoveryCodes(currentUser(req)));
}));

/**
 * Second login step. Anonymous apart from the challenge, and throttled per IP because it is the
 * last thing standing between a leaked password and a session.
 */
authRouter.post(
    '/mfa/verify',
    authRateLimit,
    credentialLimit({ bucket: 'mfa-login', identity: accountTarget }),
    validate(mfaChallengeSchema),
    asyncHandler(async (req, res) => {
        const { challenge, code } = input<MfaChallengeInput>(req);
        const result = await mfa.completeLogin(challenge, code, sessionMeta(req));
        setSessionCookies(res, result.tokens);
        res.json(await authService.profile(result.userId));
    }),
);

// ---------------------------------------------------------------------- OIDC SSO

/** Same-site paths only, so a signed state cannot turn SSO into an open redirect. */
const safeReturnTo = (value: unknown): string =>
    typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';

authRouter.get(
    '/oidc/start',
    credentialLimit({ bucket: 'oidc-start', identity: anonymousTarget, limit: 30 }),
    asyncHandler(async (req, res) => {
        const { url } = await oidc.beginLogin(safeReturnTo(req.query.returnTo));
        res.redirect(url);
    }),
);

authRouter.get(
    '/oidc/callback',
    credentialLimit({ bucket: 'oidc-callback', identity: anonymousTarget, limit: 30 }),
    asyncHandler(async (req, res) => {
        const code = String(req.query.code ?? '');
        const state = String(req.query.state ?? '');
        if (!code || !state) return res.redirect(`${env.WEB_URL}/login?error=sso`);

        const { returnTo } = oidc.readState(state);
        const result = await oidc.loginWithOidc(code, state, sessionMeta(req));
        if (result.mfaRequired) {
            // The code screen needs the challenge, and a redirect is the only channel here. It is the
            // same kind of short-lived, single-purpose value as the `code` the IdP just handed us.
            return res.redirect(`${env.WEB_URL}/login?mfa=${encodeURIComponent(mfa.signChallenge(result.userId))}`);
        }
        setSessionCookies(res, result.tokens);
        return res.redirect(`${env.WEB_URL}${returnTo}`);
    }),
);

