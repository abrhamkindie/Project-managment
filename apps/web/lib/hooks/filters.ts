'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchSavedFilters, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { CreateSavedFilterBody, SavedFilterDto } from '../types';
import { messageOf } from './core';

/**
 * Saved task-list filters. Read-only convenience rows scoped to the current user, so writes only
 * need to refresh the single `filters` list — they never touch board or task caches.
 */

export function useSavedFilters(orgId: string | undefined) {
    return useQuery({
        queryKey: keys.filters(orgId ?? ''),
        queryFn: () => fetchSavedFilters(orgId as string),
        enabled: Boolean(orgId),
    });
}

export function useCreateSavedFilter(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateSavedFilterBody) =>
            api.post<SavedFilterDto>(`/organizations/${orgId}/filters`, body),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.filters(orgId) }),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteSavedFilter(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (filterId: string) => api.del<{ id: string }>(`/organizations/${orgId}/filters/${filterId}`),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.filters(orgId) }),
        onError: (error) => toast.error(messageOf(error)),
    });
}
