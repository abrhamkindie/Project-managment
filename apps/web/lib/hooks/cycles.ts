'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchCycles, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { CycleDto, CreateCycleBody, UpdateCycleBody } from '../types';
import { invalidateBoard, messageOf } from './core';

/**
 * Cycles (Linear-style sprints) scoped to a project.
 *
 * A cycle change can move many cards (close carries open work back to the backlog), so every
 * write invalidates both the cycle list and the board + project counters it feeds.
 */

export function useCycles(projectId: string | undefined, status?: string) {
    return useQuery({
        queryKey: keys.cycles(projectId ?? '', status),
        queryFn: () => fetchCycles(projectId as string, status),
        enabled: Boolean(projectId),
    });
}

function useCycleMutations(projectId: string) {
    const client = useQueryClient();
    const refresh = () => {
        void client.invalidateQueries({ queryKey: keys.cycles(projectId) });
        invalidateBoard(client, projectId);
    };
    return { client, refresh };
}

export function useCreateCycle(projectId: string) {
    const { refresh } = useCycleMutations(projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateCycleBody) => api.post<CycleDto>(`/projects/${projectId}/cycles`, body),
        onSuccess: (cycle) => {
            refresh();
            toast.success(`Cycle “${cycle.name}” created`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateCycle(projectId: string) {
    const { refresh } = useCycleMutations(projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: ({ cycleId, patch }: { cycleId: string; patch: UpdateCycleBody }) =>
            api.patch<CycleDto>(`/cycles/${cycleId}`, patch),
        onSuccess: refresh,
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useCloseCycle(projectId: string) {
    const { refresh } = useCycleMutations(projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (cycleId: string) => api.post<CycleDto & { carried: number }>(`/cycles/${cycleId}/close`),
        onSuccess: (result) => {
            refresh();
            toast.success(result.carried > 0 ? `Cycle closed · ${result.carried} carried to backlog` : 'Cycle closed');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteCycle(projectId: string) {
    const { refresh } = useCycleMutations(projectId);
    const toast = useToast();
    return useMutation({
        mutationFn: (cycleId: string) => api.del<{ id: string }>(`/cycles/${cycleId}`),
        onSuccess: refresh,
        onError: (error) => toast.error(messageOf(error)),
    });
}
