import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BadRequest, Unauthorized } from '../../domain/errors.js';
import { provisionFromIdentity, type ProvisionResult } from './provision.js';
import type { SessionMeta } from '../auth.service.js';

/**
 * Generic OpenID Connect sign-in (Keycloak, Authentik, Okta, an Entra tenant, Dexie…).
 *
 * The code flow is implemented directly on `fetch` + `node:crypto` rather than through an
 * `openid-client` dependency: the surface actually needed is discovery, one redirect, one token
 * exchange and one RS256 signature check, and having it in one readable file means it can be tested
 * against a stub issuer instead of a live IdP.
 *
 * Accounts are matched by e-mail, exactly like the Google flow: an IdP that asserts
 * `email_verified` for an address already registered by password links to that account rather than
 * creating a duplicate. The subject is not persisted, so the IdP remains the source of truth for
 * who exists — removing somebody there is enough to lock them out.
 */

const CLOCK_SKEW_SECONDS = 120;
const DISCOVERY_TTL_MS = 10 * 60_000;

export interface OidcDiscovery {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
}

export interface OidcClaims {
    sub: string;
    email: string;
    email_verified?: boolean | string;
    given_name?: string;
    family_name?: string;
    name?: string;
    picture?: string;
    nonce?: string;
    iss: string;
    aud: string | string[];
    exp: number;
    iat?: number;
}

export function isConfigured(): boolean {
    return Boolean(env.OIDC_ISSUER_BASE_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
}

function requireConfigured() {
    if (!isConfigured()) throw new BadRequest('Single sign-on is not configured');
    return {
        issuer: env.OIDC_ISSUER_BASE_URL as string,
        clientId: env.OIDC_CLIENT_ID as string,
        clientSecret: env.OIDC_CLIENT_SECRET as string,
    };
}

/** Where the IdP sends the browser back to. Overridable for deployments behind an unusual proxy. */
export function redirectUri(): string {
    return env.OIDC_REDIRECT_URL ?? `${env.WEB_URL}/api/v1/auth/oidc/callback`;
}

const discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();

/** `…/.well-known/openid-configuration`, cached: the endpoints never change while deployed. */
export async function discover(fetchImpl: typeof fetch = globalThis.fetch): Promise<OidcDiscovery> {
    const { issuer } = requireConfigured();
    const root = issuer.replace(/\/+$/, '');
    const key = root;
    const hit = discoveryCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const response = await fetchImpl(`${root}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new BadRequest('Identity provider discovery failed');
    const document = (await response.json()) as Partial<OidcDiscovery>;
    if (!document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) {
        throw new BadRequest('Discovery document is missing the required endpoints');
    }
    const value: OidcDiscovery = {
        issuer: document.issuer ?? root,
        authorization_endpoint: document.authorization_endpoint,
        token_endpoint: document.token_endpoint,
        jwks_uri: document.jwks_uri,
    };
    discoveryCache.set(key, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return value;
}

/** Test seam: the cache is module state, so it has to be clearable. */
export function clearDiscoveryCache(): void {
    discoveryCache.clear();
}

/**
 * Self-contained state: a random nonce (checked inside the ID token) plus the page to return to.
 * Signed with the access-token secret so no server-side session store is needed.
 */
export function signState(nonce: string, returnTo = '/'): string {
    return jwt.sign({ nonce, returnTo }, env.JWT_ACCESS_SECRET, {
        expiresIn: 600,
        issuer: 'zorqen-api',
        audience: 'zorqen-oidc-state',
    });
}

export function readState(token: string): { nonce: string; returnTo: string } {
    try {
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'zorqen-api', audience: 'zorqen-oidc-state' });
        if (typeof decoded === 'string' || typeof decoded.nonce !== 'string') throw new Error('malformed');
        // Only same-site paths: an attacker-controlled `returnTo` would turn SSO into an open redirect.
        const returnTo = decoded.returnTo.startsWith('/') && !decoded.returnTo.startsWith('//') ? decoded.returnTo : '/';
        return { nonce: decoded.nonce, returnTo };
    } catch {
        throw new Unauthorized('Sign-in attempt expired, please try again');
    }
}

export async function authorizeUrl(state: string, fetchImpl?: typeof fetch): Promise<string> {
    const { clientId } = requireConfigured();
    const document = await discover(fetchImpl);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri(),
        scope: 'openid email profile',
        state,
        nonce: state.slice(-24),
    });
    return `${document.authorization_endpoint}?${params.toString()}`;
}

/** Kick-off helper the route uses: fresh nonce/state pair plus the URL to send the browser to. */
export async function beginLogin(returnTo: string, fetchImpl?: typeof fetch): Promise<{ url: string; state: string }> {
    const nonce = crypto.randomBytes(16).toString('base64url');
    const state = signState(nonce, returnTo);
    return { url: await authorizeUrl(state, fetchImpl), state };
}

/** A JWK entry, typed as a real `JsonWebKey` so `createPublicKey({ format: 'jwk' })` accepts it. */
type JwksKey = crypto.JsonWebKey & { kid?: string; use?: string; alg?: string };

const jwksCache = new Map<string, { keys: JwksKey[]; expiresAt: number }>();

async function jwks(uri: string, fetchImpl: typeof fetch): Promise<JwksKey[]> {
    const hit = jwksCache.get(uri);
    if (hit && hit.expiresAt > Date.now()) return hit.keys;
    const response = await fetchImpl(uri, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new BadRequest('Identity provider key set is unavailable');
    const document = (await response.json()) as { keys?: JwksKey[] };
    const keys = document.keys ?? [];
    jwksCache.set(uri, { keys, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return keys;
}

const decodeSegment = (segment: string) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;

/**
 * Verify the compact JWS and its claims.
 *
 * Signature first, then the assertions: everything after a failed check is attacker-chosen text, so
 * it must never be read. `RS256` is the one algorithm every conforming OIDC provider must support,
 * and `none` is rejected by name rather than by omission.
 */
export async function verifyIdToken(
    idToken: string,
    expectedNonce: string,
    fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OidcClaims> {
    const { clientId, issuer } = requireConfigured();
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Unauthorized('Malformed identity token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    const header = decodeSegment(encodedHeader);
    if (header.alg !== 'RS256') throw new Unauthorized(`Identity token algorithm ${String(header.alg)} is not accepted`);

    const document = await discover(fetchImpl);
    const keys = await jwks(document.jwks_uri, fetchImpl);
    const candidates = keys.filter((key) => !header.kid || key.kid === header.kid);
    if (candidates.length === 0) throw new Unauthorized('Identity token key is not in the provider key set');

    const signingKey = crypto.createPublicKey({ key: candidates[0], format: 'jwk' });
    const signatureValid = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        signingKey,
        Buffer.from(encodedSignature, 'base64url'),
    );
    if (!signatureValid) throw new Unauthorized('Identity token signature does not verify');

    const claims = decodeSegment(encodedPayload) as unknown as OidcClaims;
    const now = Math.floor(Date.now() / 1000);
    const expectedIssuer = document.issuer ?? issuer.replace(/\/+$/, '');
    if (claims.iss !== expectedIssuer) throw new Unauthorized('Token was not issued by the configured provider');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const accepted = [clientId, env.OIDC_AUDIENCE].filter((value): value is string => Boolean(value));
    if (!audiences.some((audience) => accepted.includes(audience))) throw new Unauthorized('Token audience mismatch');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) throw new Unauthorized('Identity token has expired');
    if (claims.nonce !== expectedNonce) throw new Unauthorized('Nonce mismatch, please sign in again');
    if (!claims.sub || !claims.email) throw new BadRequest('The identity provider did not provide an email address');

    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (claims.email_verified !== undefined && !verified) {
        throw new BadRequest('The email address on that account is not verified');
    }
    return claims;
}

/** Code exchange. The IdP's own `error_description` is passed through when it sends one: that string is the operator's clue. */
async function exchangeCode(code: string, fetchImpl: typeof fetch): Promise<string> {
    const { clientId, clientSecret } = requireConfigured();
    const document = await discover(fetchImpl);
    const response = await fetchImpl(document.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri(),
        }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!response.ok || !payload.id_token) {
        logger.warn({ status: response.status, error: payload.error }, 'OIDC token exchange failed');
        throw new Unauthorized(payload.error_description ?? 'Could not complete the sign-in with that provider');
    }
    return payload.id_token;
}

/** Split a `name` claim when the provider does not give first/last separately. */
function splitNames(claims: OidcClaims) {
    const fallback = claims.email.split('@')[0] || 'User';
    const firstName = claims.given_name || claims.name?.split(' ')[0] || fallback;
    const lastName = claims.family_name || (claims.name ? claims.name.split(' ').slice(1).join(' ') : '');
    return { firstName, lastName };
}

/**
 * Link by e-mail, or create the account and give it a workspace — the shared decision in
 * `oauth/provision.ts`. The provider subject is not stored: there is no column for a second
 * provider, and a returning IdP assertion for a known address is enough to recognise the person.
 */
export async function loginWithOidc(
    code: string,
    state: string,
    meta: SessionMeta,
    fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ProvisionResult> {
    const { nonce } = readState(state);
    const claims = await verifyIdToken(await exchangeCode(code, fetchImpl), nonce, fetchImpl);
    const { firstName, lastName } = splitNames(claims);

    return provisionFromIdentity(
        { email: claims.email, firstName, lastName, avatarUrl: claims.picture ?? null },
        meta,
    );
}

