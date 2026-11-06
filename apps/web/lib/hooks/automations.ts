'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchAutomationRules, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { AutomationRuleDto, CreateAutomationBody, UpdateAutomationBody } from '../types';
import { messageOf } from './core';

/**
 * Automation rules, scoped to one project.
 *
 * The engine runs server-side on the activity write path, so a rule change needs no optimistic
 * update: nothing on the board moves until the next event fires, and the only cache to keep honest
 * is this list. Toggling `active` is a PATCH like any other edit — pausing a rule is not deleting it.
 */

export function useAutomationRules(projectId: string | undefined) {
    return useQuery({
        queryKey: keys.automations(projectId ?? ''),
        queryFn: () => fetchAutomationRules(projectId as string),
        enabled: Boolean(projectId),
    });
}

export function useCreateAutomation(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateAutomationBody) => api.post<AutomationRuleDto>(`/projects/${projectId}/automations`, body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.automations(projectId) });
            toast.success('Rule saved');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** The route is addressed by rule id, but the cache to refresh is still this project's list. */
export function useUpdateAutomation(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, ...body }: { id: string } & UpdateAutomationBody) =>
            api.patch<AutomationRuleDto>(`/automations/${id}`, body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.automations(projectId) });
            toast.success('Rule updated');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteAutomation(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string }>(`/automations/${id}`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.automations(projectId) });
            toast.success('Rule deleted');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}
