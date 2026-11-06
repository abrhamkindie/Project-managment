'use client';

import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';
import { keys } from '../queries';
import { mergeTaskIntoBoard } from '../board-cache';
import type { BoardDto, TaskCardDto, TaskDetailDto } from '../types';

/**
 * Shared plumbing for the data hooks: cache-identity defaults, error formatting and
 * the board/detail cache patching every task mutation goes through. Keeping it here
 * means a card edit behaves identically wherever it happens.
 */

const DEFAULT_STALE_TIME = 30_000;

/** How often the presence roster is re-read; matches the heartbeat the socket sends. */
export const PRESENCE_POLL_MS = 60_000;

/** Boards and inboxes change while a tab is open, so they are never considered fresh for long. */
export const queryDefaults = {
    queries: { staleTime: DEFAULT_STALE_TIME, refetchOnWindowFocus: true, retry: (failureCount: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && failureCount < 2 },
};

/** Errors are always `ApiError`s from the API envelope; anything else is a network failure. */
export function messageOf(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    if (error instanceof Error) return error.message;
    return 'Something went wrong';
}

export function keepPrevious<T>(previous: T | undefined) {
    return previous;
}

/**
 * Debounced value, used for search boxes: every keystroke would otherwise be a new query key
 * and a new request.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}

export function invalidateBoard(client: QueryClient, projectId: string) {
    void client.invalidateQueries({ queryKey: keys.board(projectId) });
    void client.invalidateQueries({ queryKey: keys.project(projectId) });
}

/**
 * Applies a task mutation response to every cache that holds the card.
 *
 * The board cache is patched in place — a refetch would flash the column the user is looking
 * at — the detail cache is merged so an open drawer updates instantly, and the aggregate
 * project counters are marked stale because status or position probably moved. When the task
 * is a subtask we also upsert it into the parent's cached `subtasks` array so the drawer's
 * Subtasks tab reflects the change without a round-trip.
 */
export function applyTaskToCaches(client: QueryClient, task: TaskCardDto) {
    client.setQueryData(keys.board(task.projectId), (board: BoardDto | undefined) => (board ? mergeTaskIntoBoard(board, task) : board));
    client.setQueryData(keys.task(task.id), (detail: TaskDetailDto | undefined) => (detail ? { ...detail, ...task, number: task.number ?? detail.number } : detail));
    if (task.parentTaskId) {
        upsertSubtaskInParent(client, task.parentTaskId, task);
        void client.invalidateQueries({ queryKey: keys.task(task.parentTaskId) });
    }
    void client.invalidateQueries({ queryKey: keys.project(task.projectId) });
}

/**
 * Inserts or replaces `sub` inside the cached parent's `subtasks` array, keeping the array
 * sorted by `position` so the drawer's order matches the server's. Safe to call when the
 * parent is not currently cached — it becomes a no-op and the follow-up invalidation will
 * refetch it.
 */
export function upsertSubtaskInParent(client: QueryClient, parentTaskId: string, sub: TaskCardDto) {
    client.setQueryData(keys.task(parentTaskId), (parent: TaskDetailDto | undefined) => {
        if (!parent) return parent;
        const next = parent.subtasks.filter((s) => s.id !== sub.id);
        next.push(sub);
        next.sort((a, b) => a.position - b.position);
        const subtaskCount = next.length;
        return { ...parent, subtasks: next, subtaskCount };
    });
}

/** Removes `subTaskId` from the cached parent's `subtasks` array and adjusts the count. */
export function removeSubtaskFromParent(client: QueryClient, parentTaskId: string, subTaskId: string) {
    client.setQueryData(keys.task(parentTaskId), (parent: TaskDetailDto | undefined) => {
        if (!parent) return parent;
        const next = parent.subtasks.filter((s) => s.id !== subTaskId);
        return { ...parent, subtasks: next, subtaskCount: next.length };
    });
}
