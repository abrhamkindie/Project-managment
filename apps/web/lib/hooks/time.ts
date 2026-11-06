'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchTaskTime, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { CreateTimeEntryBody, TimeEntryDto } from '../types';
import { invalidateBoard, messageOf } from './core';

/**
 * Time tracking for one task.
 *
 * The timer is server state — a `TimeLog` row whose `durationMins` is frozen when it stops — so the
 * widget refetches after every write instead of guessing an elapsed time locally: a guessed number
 * would drift from the one the burndown adds up. Card totals come from the task reads, so those
 * caches are invalidated together with the entry list.
 */

export function useTaskTime(taskId: string | undefined) {
    return useQuery({
        queryKey: keys.time(taskId ?? ''),
        queryFn: () => fetchTaskTime(taskId as string),
        enabled: Boolean(taskId),
    });
}

function useTimeMutations(taskId: string, projectId?: string) {
    const client = useQueryClient();
    const refresh = () => {
        void client.invalidateQueries({ queryKey: keys.time(taskId) });
        void client.invalidateQueries({ queryKey: keys.task(taskId) });
        if (projectId) invalidateBoard(client, projectId);
    };
    return { refresh };
}

export function useStartTimer(taskId: string, projectId?: string) {
    const { refresh } = useTimeMutations(taskId, projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (description?: string) =>
            api.post<TimeEntryDto>(`/tasks/${taskId}/time/start`, { description }),
        onSuccess: refresh,
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useStopTimer(taskId: string, projectId?: string) {
    const { refresh } = useTimeMutations(taskId, projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: () => api.post<TimeEntryDto>(`/tasks/${taskId}/time/stop`),
        onSuccess: (entry) => {
            refresh();
            toast.success(`Logged ${entry.durationMins ?? 0} min`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Backfill a sitting that happened away from the timer. */
export function useAddTimeEntry(taskId: string, projectId?: string) {
    const { refresh } = useTimeMutations(taskId, projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateTimeEntryBody) => api.post<TimeEntryDto>(`/tasks/${taskId}/time/entries`, body),
        onSuccess: refresh,
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteTimeEntry(taskId: string, projectId?: string) {
    const { refresh } = useTimeMutations(taskId, projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (entryId: string) => api.del<{ id: string }>(`/tasks/${taskId}/time/entries/${entryId}`),
        onSuccess: refresh,
        onError: (error) => toast.error(messageOf(error)),
    });
}
