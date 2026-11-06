'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchMfaStatus, fetchSsoProviders, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { MfaEnableResult, MfaRecoveryResult, MfaSetupDto } from '../types';
import { messageOf } from './core';

/**
 * Two-factor enrollment and the provider list the sign-in screen renders.
 *
 * Setup is deliberately two calls: `POST /auth/mfa/setup` persists a secret so a page refresh does
 * not invalidate the QR code already on screen, and nothing is enforced until `enable` proves the
 * authenticator can actually produce a code. Recovery codes come back once and are the user's to
 * keep — regenerating them throws away the old set.
 */

export function useMfaStatus() {
    return useQuery({ queryKey: keys.mfaStatus, queryFn: fetchMfaStatus });
}

/** `GET /auth/providers` is public, so the login page can call it before it has a session. */
export function useSsoProviders() {
    return useQuery({ queryKey: keys.ssoProviders, queryFn: fetchSsoProviders, staleTime: Infinity });
}

export function useBeginMfaSetup() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api.post<MfaSetupDto>('/auth/mfa/setup'),
        // A pending setup is a state the status query has to describe.
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.mfaStatus }),
    });
}

export function useEnableMfa() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (code: string) => api.post<MfaEnableResult>('/auth/mfa/enable', { code }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.mfaStatus });
            toast.success('Two-factor enabled');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDisableMfa() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        // The password is re-checked server-side: turning off a factor is not a click to make by habit.
        mutationFn: (password: string) => api.post<{ enabled: false }>('/auth/mfa/disable', { password }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.mfaStatus });
            toast.success('Two-factor turned off');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** New backup codes; the previous set stops working, which is the point of losing them. */
export function useRegenerateRecoveryCodes() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: () => api.post<MfaRecoveryResult>('/auth/mfa/recovery-codes'),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.mfaStatus });
            toast.success('New recovery codes issued');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}
