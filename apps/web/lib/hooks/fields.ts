'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchCustomFields, fetchTaskFields, keys } from '../queries';
import { setTaskFieldsInBoard } from '../board-cache';
import { useToast } from '~/components/toast';
import type {
    BoardDto,
    CreateCustomFieldBody,
    CustomFieldDto,
    TaskDetailDto,
    TaskFieldValuesBody,
    TaskFieldsDto,
    UpdateCustomFieldBody,
} from '../types';
import { invalidateBoard, messageOf } from './core';

/**
 * Custom fields (Phase 6): the definitions a workspace offers, and the values one task carries.
 *
 * Two caches matter here. The definition list is read by the settings panel, the drawer and every
 * card that draws a chip, so it is cached per scope and shared by all of them. A task's values ride
 * inside the card payloads themselves (`task.fields`), which is why a value save patches the board
 * and the open detail in place instead of waiting for a refetch to repaint the card the user just
 * edited.
 *
 * Changing a definition is the expensive case: it can make a chip on some card anywhere in the
 * workspace meaningless, so those caches are invalidated rather than patched.
 */

export function useCustomFields(orgId: string | undefined, projectId?: string | null) {
    return useQuery({
        queryKey: keys.fields(orgId ?? '', projectId),
        queryFn: () => fetchCustomFields(orgId as string, projectId),
        enabled: Boolean(orgId),
    });
}

/** Definitions this task may carry plus the values it holds. */
export function useTaskFields(taskId: string | undefined) {
    return useQuery({
        queryKey: keys.taskFields(taskId ?? ''),
        queryFn: () => fetchTaskFields(taskId as string),
        enabled: Boolean(taskId),
    });
}

/**
 * One invalidation for every shape of the definition list, plus the caches that render chips.
 * `projectId` is optional because a workspace-wide field has no board of its own — it still has to
 * disappear from the project boards that were showing it.
 */
function useFieldDefinitionMutations(orgId: string, projectId?: string | null) {
    const client = useQueryClient();
    const toast = useToast();
    const refresh = () => {
        void client.invalidateQueries({ queryKey: ['org', orgId, 'fields'] });
        void client.invalidateQueries({ queryKey: ['task'] });
        if (projectId) invalidateBoard(client, projectId);
    };
    return { client, refresh, toast };
}

export function useCreateCustomField(orgId: string, projectId?: string | null) {
    const { refresh, toast } = useFieldDefinitionMutations(orgId, projectId);
    return useMutation({
        mutationFn: (body: CreateCustomFieldBody) =>
            api.post<CustomFieldDto>(`/organizations/${orgId}/fields`, body),
        onSuccess: (field) => {
            refresh();
            toast.success(`“${field.name}” added`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateCustomField(orgId: string, projectId?: string | null) {
    const { refresh, toast } = useFieldDefinitionMutations(orgId, projectId);
    return useMutation({
        mutationFn: ({ fieldId, patch }: { fieldId: string; patch: UpdateCustomFieldBody }) =>
            api.patch<CustomFieldDto>(`/organizations/${orgId}/fields/${fieldId}`, patch),
        onSuccess: (field) => {
            refresh();
            toast.success(`“${field.name}” updated`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/**
 * Deleting a field deletes every value it holds (the API does it in one cascade), so the caches
 * have to drop those chips too — hence the full refresh rather than a targeted patch.
 */
export function useDeleteCustomField(orgId: string, projectId?: string | null) {
    const { refresh, toast } = useFieldDefinitionMutations(orgId, projectId);
    return useMutation({
        mutationFn: (fieldId: string) => api.del<{ id: string; valuesRemoved: number }>(`/organizations/${orgId}/fields/${fieldId}`),
        onSuccess: (result) => {
            refresh();
            toast.success(result.valuesRemoved > 0 ? `Field deleted · ${result.valuesRemoved} values removed` : 'Field deleted');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/**
 * Saves part of a task's field values.
 *
 * The API answers with the task's whole value set, so both the open detail and the card on the
 * board are written from that answer — a save repaints the chip it changed and asks for nothing
 * else. The paged task lists are only marked stale, since a list page is a different shape again.
 */
export function useSetTaskFieldValues(taskId: string, projectId: string, orgId?: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (values: TaskFieldValuesBody) =>
            api.patch<{ id: string; fields: TaskFieldsDto['values'] }>(`/tasks/${taskId}/fields`, { values }),
        onSuccess: (result) => {
            client.setQueryData(keys.task(taskId), (detail: TaskDetailDto | undefined) => (detail ? { ...detail, fields: result.fields } : detail));
            client.setQueryData<BoardDto>(keys.board(projectId), (board) => (board ? setTaskFieldsInBoard(board, taskId, result.fields) : board));
            if (orgId) void client.invalidateQueries({ queryKey: ['org', orgId, 'tasks'] });
        },
        // Silent on success: the value lands in the input the user is still looking at, which is
        // feedback enough. A refusal has to be loud, because a half-typed date is easy to miss.
        onError: (error) => toast.error(messageOf(error)),
    });
}
