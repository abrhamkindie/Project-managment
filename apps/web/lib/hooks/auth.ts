'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '../api';
import {
    fetchActiveSessions,
    fetchPasswordResetState,
    fetchSession,
    keys,
    requestPasswordReset,
} from '../queries';
import { useToast } from '~/components/toast';
import { homeFor } from '../paths';
import type { LoginResult, Session } from '../types';
import { isMfaChallenge } from '../types';
import { messageOf } from './core';

/** Sign-in / sign-up / profile / invitation-accept flows. */

/**
 * Both login steps end the same way: the cookie jar is already loaded, the session envelope is
 * already in the cache, and the only question is where to land. Kept in one place so a second
 * factor cannot accidentally skip the redirect or leave a stale session behind.
 */
function completeSignIn(client: QueryClient, router: ReturnType<typeof useRouter>, session: Session, redirectTo?: string) {
    client.setQueryData(keys.session, session);
    // A `redirectTo` arrives from the query string (an invitation link, a deep link), and
    // `safeNext` has already proven it is an internal path.
    router.replace(redirectTo ?? homeFor(session));
}

/** Active refresh tokens, so an unfamiliar device can be seen before it is revoked. */
export function useSessions() {
    return useQuery({ queryKey: keys.activeSessions, queryFn: fetchActiveSessions });
}

export function useProfile() {
    const client = useQueryClient();
    const toast = useToast();
    const router = useRouter();
    return {
        update: useMutation({
            mutationFn: (body: { firstName?: string; lastName?: string; timezone?: string; avatarUrl?: string | null }) =>
                api.patch<Session>('/auth/profile', body),
            onSuccess: (session) => {
                client.setQueryData(keys.session, session);
                toast.success('Profile updated');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        changePassword: useMutation({
            mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<{ ok: boolean }>('/auth/password', body),
            onSuccess: () => {
                client.clear();
                toast.success('Password changed — sign in again');
                router.replace('/login');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        revokeAllSessions: useMutation({
            mutationFn: () => api.del<{ ok: boolean }>('/auth/sessions'),
            onSuccess: () => {
                client.clear();
                router.replace('/login');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

export function useLogin(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { email: string; password: string }) =>
            api.post<LoginResult>('/auth/login', body, { retryOn401: false }),
        onSuccess: (result) => {
            // Two-factor is on: the password passed, but no cookie was set, and the challenge is
            // worth nothing until the code screen spends it at `/auth/mfa/verify`.
            if (isMfaChallenge(result)) return;
            completeSignIn(client, router, result, redirectTo);
        },
    });
}

/**
 * Second login step: exchange the challenge for a session.
 *
 * The API answers with the ordinary session envelope and sets the cookies itself, so this is the
 * same landing as a password-only sign-in — one code field away.
 */
export function useMfaVerify(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { challenge: string; code: string }) =>
            api.post<Session>('/auth/mfa/verify', body, { retryOn401: false }),
        onSuccess: (session) => completeSignIn(client, router, session, redirectTo),
    });
}

export function useRegister(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { email: string; password: string; firstName: string; lastName: string; organizationName?: string }) =>
            api.post<Session>('/auth/register', body, { retryOn401: false }),
        onSuccess: (session) => {
            client.setQueryData(keys.session, session);
            router.replace(redirectTo ?? homeFor(session));
        },
    });
}

export function useGoogleLogin(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        // A provider sign-in can hit the same second-factor gate as a password one.
        mutationFn: (idToken: string) => api.post<LoginResult>('/auth/google', { idToken }, { retryOn401: false }),
        onSuccess: (result) => {
            if (isMfaChallenge(result)) return;
            completeSignIn(client, router, result, redirectTo);
        },
    });
}

/**
 * Silent session restore for the signed-out screens.
 *
 * A page can be reached with an expired 15-minute access token and a valid refresh token, and
 * only the browser may rotate it — the `Set-Cookie` has to land in the visitor's jar. Success
 * means the app can skip the login form entirely; the endpoint answers with the same session
 * envelope as `GET /auth/me`, so one call is enough.
 *
 * The in-flight promise is shared on purpose: React StrictMode runs effects twice in development,
 * and a second replay of a single-use refresh token would look like token theft and revoke every
 * session for that user.
 */
let restoreInFlight: Promise<Session | null> | null = null;

export function restoreSession(): Promise<Session | null> {
    restoreInFlight ??= api
        .post<Session>('/auth/refresh', undefined, { retryOn401: false })
        .catch(() => null)
        .finally(() => {
            restoreInFlight = null;
        });
    return restoreInFlight;
}

/**
 * "Forgot password", step 1.
 *
 * Nothing is done with the response except showing it: the API answers the same way for an
 * unknown address, a deactivated one and a Google-only one, so the screen must not learn
 * anything from it.
 */
export function useForgotPassword() {
    return useMutation({
        mutationFn: (email: string) => requestPasswordReset(email),
    });
}

/**
 * Is the link in `/reset-password?token=…` still good?
 *
 * `retry: false` because a dead link stays dead: retrying an expired or already-used token
 * only spends the shared IP budget of the endpoint again.
 */
export function usePasswordResetState(token: string | undefined) {
    return useQuery({
        queryKey: ['auth', 'password-reset', token],
        queryFn: () => fetchPasswordResetState(token ?? ''),
        enabled: !!token,
        retry: false,
    });
}

/** Step 2: set the new password, then start from a clean slate at the sign-in screen. */
export function useResetPassword() {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { token: string; password: string }) =>
            api.post<{ ok: boolean; message: string }>('/auth/reset-password', body),
        onSuccess: () => {
            // The reset revoked every session, so no cached query is trustworthy any more.
            client.clear();
            router.replace('/login');
        },
    });
}

export function useAcceptInvitation() {
    const client = useQueryClient();
    const router = useRouter();
    const toast = useToast();
    return useMutation({
        mutationFn: (token: string) => api.post<{ orgId: string; name: string; role: string }>('/organizations/invitations/accept', { token }),
        onSuccess: async (result) => {
            const session = await fetchSession();
            client.setQueryData(keys.session, session);
            // Land in the workspace that was joined, not in whichever one happens to be first.
            const joined = session?.organizations.find((org) => org.id === result.orgId);
            toast.success(`You joined ${result.name}`);
            router.replace(joined ? `/w/${joined.slug}/dashboard` : homeFor(session ?? { organizations: [] }));
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}
