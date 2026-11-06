'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchMyTasks, fetchTask, fetchTasks, keys } from '../queries';
import { useToast } from '~/components/toast';
import { removeTaskFromBoard } from '../board-cache';
import type {
    AssignBody,
    BoardDto,
    BulkResultDto,
    BulkTaskBody,
    CreateTaskBody,
    MoveTaskBody,
    TaskCardDto,
    TaskDetailDto,
    TaskListQuery,
    UpdateTaskBody,
} from '../types';
import { applyTaskToCaches, keepPrevious, messageOf, removeSubtaskFromParent } from './core';

/** Tasks: reads, lifecycle mutations, discussion and attachments. */

export function useTasks(orgId: string, query?: TaskListQuery) {
    return useQuery({ queryKey: keys.tasks(orgId, query), queryFn: () => fetchTasks(orgId, query), placeholderData: keepPrevious });
}

export function useMyTasks(orgId: string) {
    return useQuery({ queryKey: keys.myTasks(orgId), queryFn: () => fetchMyTasks(orgId) });
}

export function useTask(taskId: string | undefined) {
    return useQuery({ queryKey: keys.task(taskId ?? ''), queryFn: () => fetchTask(taskId as string), enabled: Boolean(taskId) });
}

/** Board-aware task mutations: a card edit must land in the column cache too. */
export function useCreateTask(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateTaskBody) => api.post<TaskCardDto>(`/organizations/${orgId}/tasks`, body),
        onSuccess: (task) => {
            applyTaskToCaches(client, task);
            void client.invalidateQueries({ queryKey: keys.activity(orgId) });
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateTask() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, patch }: { taskId: string; patch: UpdateTaskBody }) => api.patch<TaskCardDto>(`/tasks/${taskId}`, patch),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useMoveTask() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, move }: { taskId: string; move: MoveTaskBody }) => api.post<TaskCardDto>(`/tasks/${taskId}/move`, move),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useSetAssignees() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, body }: { taskId: string; body: AssignBody }) => api.put<TaskCardDto>(`/tasks/${taskId}/assignees`, body),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useSetLabels() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, labelIds }: { taskId: string; labelIds: string[] }) => api.put<TaskCardDto>(`/tasks/${taskId}/labels`, { labelIds }),
        onSuccess: (task) => applyTaskToCaches(client, task),
    });
}

/**
 * Bulk bar: one action over up to 100 selected cards.
 *
 * The whole `['project']` prefix is invalidated rather than the touched ids only, because a
 * batch can span projects and the per-card realtime events are not relied on here; a stale
 * column would be worse than one extra refetch. Partial failures are reported, not swallowed:
 * the cards that moved must not be hidden behind the ones that did not.
 */
export function useBulkTasks(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: BulkTaskBody) => api.post<BulkResultDto>(`/organizations/${orgId}/tasks/bulk`, body),
        onSuccess: (result, body) => {
            void client.invalidateQueries({ queryKey: ['project'] });
            void client.invalidateQueries({ queryKey: keys.tasks(orgId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
            void client.invalidateQueries({ queryKey: keys.activity(orgId) });
            for (const id of result.updated) client.removeQueries({ queryKey: keys.task(id) });
            if (result.failed.length > 0) {
                toast.error(`${result.failed.length} of ${body.ids.length} ${result.failed.length === 1 ? 'task' : 'tasks'} could not be ${body.action === 'delete' ? 'deleted' : 'updated'}`);
            } else {
                toast.success(`${result.updated.length} ${result.updated.length === 1 ? 'task' : 'tasks'} ${body.action === 'delete' ? 'deleted' : 'updated'}`);
            }
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteTask(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (taskId: string) => api.del<{ id: string }>(`/tasks/${taskId}`),
        onSuccess: (_result, taskId) => {
            // The delete acknowledgement carries no project, so the column it was in comes from
            // whichever cache still holds the card; without it we just wait for the board refetch.
            const cached = client.getQueryData<TaskDetailDto>(keys.task(taskId));
            const projectId = cached?.projectId;
            if (projectId) {
                client.setQueryData(keys.board(projectId), (board: BoardDto | undefined) => (board ? removeTaskFromBoard(board, taskId) : board));
                void client.invalidateQueries({ queryKey: keys.project(projectId) });
            }
            // If this was a subtask, drop it from the parent's cached list so an open drawer
            // updates immediately; the invalidation reconciles counts and timeline.
            const parentTaskId = cached?.parentTaskId;
            if (parentTaskId) {
                removeSubtaskFromParent(client, parentTaskId, taskId);
                void client.invalidateQueries({ queryKey: keys.task(parentTaskId) });
            }
            client.removeQueries({ queryKey: keys.task(taskId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
            toast.success('Task deleted');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

// ------------------------------------------------------------------- task detail bits

export function useComments(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    const refresh = () => client.invalidateQueries({ queryKey: keys.task(taskId) });
    return {
        add: useMutation({
            mutationFn: (body: string) => api.post<unknown>(`/tasks/${taskId}/comments`, { body }),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        edit: useMutation({
            mutationFn: ({ commentId, body }: { commentId: string; body: string }) => api.patch<unknown>(`/comments/${commentId}`, { body }),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (commentId: string) => api.del<{ id: string }>(`/comments/${commentId}`),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

export function useAttachments(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    const refresh = () => client.invalidateQueries({ queryKey: keys.task(taskId) });
    return {
        upload: useMutation({
            mutationFn: (file: File) => {
                const form = new FormData();
                form.append('file', file);
                return api.upload<unknown>(`/tasks/${taskId}/attachments`, form);
            },
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (attachmentId: string) => api.del<{ id: string }>(`/tasks/${taskId}/attachments/${attachmentId}`),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}
