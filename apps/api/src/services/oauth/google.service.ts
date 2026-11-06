import { env } from '../../config/env.js';
import { BadRequest, Unauthorized } from '../../domain/errors.js';
import { provisionFromIdentity, type ProvisionResult } from './provision.js';
import type { SessionMeta } from '../auth.service.js';

/**
 * Google sign-in.
 *
 * The browser obtains an ID token from Google Identity Services and posts it here; we confirm it
 * with Google's tokeninfo endpoint instead of pulling in a verification library. The account
 * decision (attach `googleId`, link by e-mail, or create) is the shared one in `oauth/provision.ts`.
 */

interface GooglePayload {
    sub: string;
    email: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    email_verified?: boolean | string;
    aud?: string;
    iss?: string;
}

export function isConfigured(): boolean {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Verify the ID token with Google and return the decoded payload. */
async function verifyIdToken(idToken: string): Promise<GooglePayload> {
    const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { headers: { accept: 'application/json' } },
    );
    if (!response.ok) throw new Unauthorized('Invalid Google token');
    const payload = (await response.json()) as GooglePayload;

    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        throw new Unauthorized('Token not issued by Google');
    }
    if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Unauthorized('Token audience mismatch');

    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!verified) throw new BadRequest('Google account email is not verified');

    return payload;
}

export async function loginWithGoogle(idToken: string, meta: SessionMeta): Promise<ProvisionResult> {
    if (!isConfigured()) throw new BadRequest('Google sign-in is not configured');

    const payload = await verifyIdToken(idToken);
    const email = payload.email.toLowerCase();
    return provisionFromIdentity(
        {
            email,
            firstName: payload.given_name || email.split('@')[0] || 'User',
            lastName: payload.family_name || '',
            avatarUrl: payload.picture ?? null,
            externalId: { field: 'googleId', value: payload.sub },
        },
        meta,
    );
}
