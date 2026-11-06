'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
    fetchNotifications,
    fetchPreferences,
    keys,
} from '../queries';
import { useToast } from '~/components/toast';
import type { NotificationPrefs } from '../types';
import { messageOf } from './core';

/** Inbox and notification preferences only — auth-shaped reads live in `auth.ts`. */

export function useNotifications(unreadOnly = false, page = 1) {
    return useQuery({ queryKey: keys.notifications(unreadOnly, page), queryFn: () => fetchNotifications(unreadOnly, page) });
}

export function useMarkNotificationsRead() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (ids?: string[]) => api.post<{ updated: number }>('/notifications/read', { ids }),
        onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    });
}

export function useDeleteNotification() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string }>(`/notifications/${id}`),
        onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    });
}

export function usePreferences() {
    return useQuery({ queryKey: keys.preferences, queryFn: fetchPreferences });
}

export function useUpdatePreferences() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (prefs: Partial<NotificationPrefs>) => api.put<NotificationPrefs>('/notifications/preferences', { prefs }),
        onSuccess: (merged) => {
            // The API returns the full merged object, so no refetch is needed.
            client.setQueryData(keys.preferences, merged);
            void client.invalidateQueries({ queryKey: keys.session });
            toast.success('Notification preferences saved');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}
