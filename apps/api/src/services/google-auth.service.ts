import { prisma } from '../lib/prisma.js';
import { uniqueSlug } from '../lib/crypto.js';
import { BadRequest, Unauthorized } from '../domain/errors.js';
import { createSession, type SessionTokens } from './session.js';
import { env } from '../config/env.js';
import { mails, sendMail } from './mailer.js';
import type { OrgRole } from '../domain/enums.js';

const GOOGLE_CLIENT_ID: string | undefined = process.env.GOOGLE_CLIENT_ID;

/**
 * Google OAuth: the client obtains an ID token via Google Identity Services,
 * sends it here, and we verify it with Google's tokeninfo endpoint.
 *
 * If the email already belongs to a password user we link the Google account
 * rather than creating a duplicate.
 */

interface GooglePayload {
    sub: string;
    email: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    email_verified?: boolean | string;
}

interface Authenticated {
    userId: string;
    tokens: SessionTokens;
}

export interface SessionMeta {
    userAgent?: string;
    ip?: string;
}

/**
 * Verify the ID token with Google and return the decoded payload.
 * Uses the lightweight tokeninfo endpoint — no extra dependency needed.
 */
async function verifyIdToken(idToken: string): Promise<GooglePayload> {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) throw new Unauthorized('Invalid Google token');
    const payload = (await res.json()) as GooglePayload & { aud?: string; iss?: string };

    // Verify issuer and audience.
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        throw new Unauthorized('Token not issued by Google');
    }
    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
        throw new Unauthorized('Token audience mismatch');
    }

    // Verify email is confirmed.
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!verified) throw new BadRequest('Google account email is not verified');

    return payload;
}

/**
 * Find or create a user from a verified Google ID token, then bootstrap a session.
 */
export async function loginWithGoogle(idToken: string, meta: SessionMeta): Promise<Authenticated> {
    if (!GOOGLE_CLIENT_ID) {
        throw new BadRequest('Google sign-in is not configured');
    }

    const payload = await verifyIdToken(idToken);
    const email = payload.email.toLowerCase();

    // Check if a user with this googleId already exists.
    let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });

    if (!user) {
        // Check if the email is already registered (password account) — link Google to it.
        const byEmail = await prisma.user.findUnique({ where: { email } });
        if (byEmail) {
            user = await prisma.user.update({
                where: { id: byEmail.id },
                data: { googleId: payload.sub, avatarUrl: byEmail.avatarUrl ?? payload.picture ?? null },
            });
        } else {
            // Create a brand-new account from Google profile data.
            const firstName = payload.given_name || email.split('@')[0] || 'User';
            const lastName = payload.family_name || '';
            user = await prisma.user.create({
                data: {
                    email,
                    googleId: payload.sub,
                    firstName,
                    lastName,
                    avatarUrl: payload.picture ?? null,
                    // No passwordHash — this is an OAuth-only account.
                },
            });

            // Bootstrap a default workspace so the user lands in a working state.
            const orgName = `${firstName}'s workspace`;
            const slug = await uniqueSlug(orgName, async (candidate) =>
                Boolean(await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })),
            );
            await prisma.organization.create({
                data: {
                    name: orgName,
                    slug,
                    ownerId: user.id,
                    members: { create: { userId: user.id, role: 'admin' as OrgRole } },
                },
            });

            // Welcome email for Google-signup users (fire-and-forget).
            void sendMail(mails.welcome({
                to: email,
                firstName,
                orgName,
                link: `${env.WEB_URL}/w/${slug}/dashboard`,
            }));
        }
    }

    if (!user.isActive) throw new Unauthorized('This account has been deactivated');

    const tokens = await createSession(user.id, meta);
    return { userId: user.id, tokens };
}
