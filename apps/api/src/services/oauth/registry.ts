import { env } from '../../config/env.js';
import * as google from './google.service.js';
import * as oidc from './oidc.service.js';

/**
 * Provider registry.
 *
 * Two shapes of SSO exist in this app and they are deliberately not forced into one interface:
 *  - `token`   — the browser gets a provider token itself (Google Identity Services) and posts it
 *                to `/auth/google`; the server never holds a redirect.
 *  - `redirect` — the standard server-side code flow (`/auth/oidc/start` → IdP → `/auth/oidc/callback`),
 *                which is what self-hosted identity providers speak.
 *
 * What they do share is the account decision (`oauth/provision.ts`) and this list, so the login page
 * and the health endpoint describe the same set of providers the routes actually accept.
 */

export type ProviderName = 'google' | 'oidc';
export type ProviderKind = 'token' | 'redirect';

export interface PublicProvider {
    name: ProviderName;
    kind: ProviderKind;
    /** Rendered on the sign-in button. */
    label: string;
    /** Client id is public by design (it appears in the browser's redirect), so it can be exposed. */
    clientId: string | null;
}

const REGISTRY: Record<ProviderName, { kind: ProviderKind; label: string; isConfigured: () => boolean; clientId: () => string | null }> = {
    google: { kind: 'token', label: 'Google', isConfigured: google.isConfigured, clientId: () => env.GOOGLE_CLIENT_ID ?? null },
    oidc: { kind: 'redirect', label: 'Single sign-on', isConfigured: oidc.isConfigured, clientId: () => env.OIDC_CLIENT_ID ?? null },
};

export function enabledProviders(): PublicProvider[] {
    return (Object.keys(REGISTRY) as ProviderName[])
        .filter((name) => REGISTRY[name].isConfigured())
        .map((name) => ({ name, kind: REGISTRY[name].kind, label: REGISTRY[name].label, clientId: REGISTRY[name].clientId() }));
}

export function isProviderConfigured(name: ProviderName): boolean {
    return REGISTRY[name].isConfigured();
}

export { google, oidc };
