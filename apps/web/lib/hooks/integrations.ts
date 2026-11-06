'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
    fetchApiTokens,
    fetchShares,
    fetchWebhookDeliveries,
    fetchWebhooks,
    keys,
} from '../queries';
import { useToast } from '~/components/toast';
import type {
    CreateApiTokenBody,
    CreateShareBody,
    CreateWebhookBody,
    CreatedApiTokenDto,
    CreatedShareDto,
    CreatedWebhookDto,
    UpdateWebhookBody,
    WebhookDto,
} from '../types';
import { messageOf } from './core';

/**
 * Integration surfaces: personal access tokens, outbound webhooks and public share links.
 *
 * All three leak a secret exactly once — at creation — so each create hook hands the plaintext
 * straight to the screen that asked for it and never re-reads it from cache. Everything else is
 * an ordinary list, invalidated by the single key that list is stored under.
 */

// -------------------------------------------------------------------- access tokens

export function useApiTokens() {
    return useQuery({ queryKey: keys.apiTokens, queryFn: fetchApiTokens });
}

/** `data.token` is the only place the plaintext exists; show it once and store nothing. */
export function useCreateApiToken() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateApiTokenBody) => api.post<CreatedApiTokenDto>('/auth/tokens', body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.apiTokens });
            toast.success('Token created');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useRevokeApiToken() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string; revoked: boolean }>(`/auth/tokens/${id}`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.apiTokens });
            toast.success('Token revoked');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

// ------------------------------------------------------------------------- webhooks

export function useWebhooks(orgId: string | undefined) {
    return useQuery({
        queryKey: keys.webhooks(orgId ?? ''),
        queryFn: () => fetchWebhooks(orgId as string),
        enabled: Boolean(orgId),
    });
}

/** `data.secret` signs every delivery; it is returned by this call only. */
export function useCreateWebhook(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateWebhookBody) => api.post<CreatedWebhookDto>(`/organizations/${orgId}/webhooks`, body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.webhooks(orgId) });
            toast.success('Webhook added');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateWebhook(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, ...body }: { id: string } & UpdateWebhookBody) =>
            api.patch<WebhookDto>(`/organizations/${orgId}/webhooks/${id}`, body),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteWebhook(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string }>(`/organizations/${orgId}/webhooks/${id}`),
        onSuccess: () => {
            // One invalidation covers both: every delivery-log key starts with this webhook's list key.
            void client.invalidateQueries({ queryKey: keys.webhooks(orgId) });
            toast.success('Webhook removed');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Rotating invalidates the old signature immediately, so the receiver must be reconfigured. */
export function useRotateWebhookSecret(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (id: string) => api.post<{ id: string; secret: string }>(`/organizations/${orgId}/webhooks/${id}/rotate-secret`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.webhooks(orgId) });
            toast.success('Secret rotated — update your receiver');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Sends one signed `test` event and reports the receiver's answer inline, not as a toast. */
export function useTestWebhook(orgId: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            api.post<{ delivered: boolean; responseCode: number | null; error: string | null }>(
                `/organizations/${orgId}/webhooks/${id}/test`,
            ),
        // The attempt is already in the log, so refresh it behind the result line.
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.webhooks(orgId) }),
    });
}

/** Delivery log for one hook. `pageNumber` is part of the cache identity, not a refetch trick. */
export function useWebhookDeliveries(orgId: string | undefined, webhookId: string | undefined, pageNumber = 1) {
    return useQuery({
        queryKey: keys.webhookDeliveries(orgId ?? '', webhookId ?? '', pageNumber),
        queryFn: () => fetchWebhookDeliveries(orgId as string, webhookId as string, pageNumber),
        enabled: Boolean(orgId && webhookId),
    });
}

// -------------------------------------------------------------------- share links

export function useShares(orgId: string | undefined) {
    return useQuery({
        queryKey: keys.shares(orgId ?? ''),
        queryFn: () => fetchShares(orgId as string),
        enabled: Boolean(orgId),
    });
}

/** `data.url` is the link to paste; the token inside it is never returned again. */
export function useCreateShare(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateShareBody) => api.post<CreatedShareDto>(`/organizations/${orgId}/shares`, body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.shares(orgId) });
            toast.success('Share link created');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Revoking is instant and permanent: the URL starts answering 404 on the next request. */
export function useRevokeShare(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string; revoked: boolean }>(`/organizations/${orgId}/shares/${id}`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.shares(orgId) });
            toast.success('Link revoked');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}
