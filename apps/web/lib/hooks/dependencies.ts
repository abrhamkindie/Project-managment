'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { keys } from '../queries';
import { useToast } from '~/components/toast';
import type { CreateDependencyBody, DependencyEdgeDto } from '../types';
import { messageOf } from './core';

/**
 * Task dependencies (finish-to-start). The drawer reads the graph straight from the task
 * detail payload (`TaskDetailDto.dependencies`), so these hooks only own the writes: add or
 * remove an edge, then refresh that task's detail cache.
 */

/** Adding/removing an edge is scoped to one task's detail cache; the other endpoint refreshes on next open. */
export function useAddDependency(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateDependencyBody) =>
            api.post<DependencyEdgeDto>(`/tasks/${taskId}/dependencies`, body),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.task(taskId) }),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useRemoveDependency(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (dependencyId: string) => api.del<{ id: string }>(`/tasks/${taskId}/dependencies/${dependencyId}`),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.task(taskId) }),
        onError: (error) => toast.error(messageOf(error)),
    });
}
