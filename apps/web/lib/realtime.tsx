'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useToast } from '~/components/toast';
import { mergeTaskIntoBoard, removeTaskFromBoard } from './board-cache';
import { keys } from './queries';
import type { BoardDto, NotificationDto, PresenceDto, TaskCardDto } from './types';

/**
 * Realtime layer.
 *
 * Socket events are a *hint*, never the data source: each one invalidates the cache entry it
 * affects and lets React Query refetch from the API. That means the websocket can drop, and
 * the UI is merely stale instead of wrong — the same code path serves a live collaborator and
 * a background tab that missed events.
 *
 * Authentication rides on the `atlas_at` session cookie (`withCredentials`), so no token is
 * ever exposed to JavaScript.
 */

type Status = 'connecting' | 'live' | 'offline';

interface RealtimeApi {
    status: Status;
}

const RealtimeContext = createContext<RealtimeApi>({ status: 'offline' });

export const useRealtime = () => useContext(RealtimeContext);

/** `/realtime` on the web origin is proxied to the API; see next.config.mjs. */
const REALTIME_PATH = '/realtime';

/**
 * How often a visible tab tells the server it is still being looked at. The API considers a
 * person stale after 150 seconds of silence, so this tolerates two lost beats before a dot greys.
 */
const HEARTBEAT_MS = 60_000;

export function RealtimeProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
    const client = useQueryClient();
    const toast = useToast();
    const router = useRouter();
    const [status, setStatus] = useState<Status>('connecting');

    useEffect(() => {
        // An absolute NEXT_PUBLIC_REALTIME_URL is only needed when the socket cannot be proxied
        // on the web origin; cookies still ride along because it is the same site.
        const socket: Socket = io(process.env.NEXT_PUBLIC_REALTIME_URL || window.location.origin, {
            path: REALTIME_PATH,
            withCredentials: true,
            transports: ['websocket', 'polling'],
        });

        // Connecting is not enough: the server joined the rooms the roster knew at that
        // moment, so a reconnect (and a membership change) asks it to reconcile them again.
        const refreshRooms = () => socket.emit('rooms:sync');

        // Presence: the server cannot tell a closed lid from an idle laptop, so a tab that is
        // genuinely on screen says so. A hidden tab goes silent on purpose, which is what turns
        // the last beat into an honest "seen 4 minutes ago".
        const beat = () => {
            if (document.visibilityState === 'visible') socket.emit('presence:heartbeat');
        };
        const onVisibility = () => beat();
        document.addEventListener('visibilitychange', onVisibility);
        const heartbeat = window.setInterval(beat, HEARTBEAT_MS);

        socket.on('connect', () => {
            setStatus('live');
            refreshRooms();
            beat();
        });
        socket.on('disconnect', () => setStatus('offline'));
        socket.io.on('reconnect_error', () => setStatus('offline'));

        socket.on('rooms:refresh', () => {
            refreshRooms();
            // Project lists and boards may now contain work that was invisible a second ago.
            void client.invalidateQueries({ queryKey: ['org', orgId, 'projects'] });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
        });

        // A card changed somewhere in this project: refresh the board and any open detail.
        socket.on('task:created', (task: TaskCardDto) => {
            void client.invalidateQueries({ queryKey: keys.board(task.projectId) });
            void client.invalidateQueries({ queryKey: keys.project(task.projectId) });
            void client.invalidateQueries({ queryKey: keys.tasks(orgId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
        });

        socket.on('task:updated', (task: TaskCardDto) => {
            // Patching the cached card keeps a drag smooth for everybody else too.
            client.setQueryData<BoardDto | undefined>(keys.board(task.projectId), (board) => (board ? mergeTaskIntoBoard(board, task) : board));
            void client.invalidateQueries({ queryKey: keys.task(task.id) });
            void client.invalidateQueries({ queryKey: keys.project(task.projectId) });
            void client.invalidateQueries({ queryKey: keys.tasks(orgId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
        });

        socket.on('task:deleted', (payload: { id: string; projectId: string }) => {
            client.setQueryData<BoardDto | undefined>(keys.board(payload.projectId), (board) =>
                board ? removeTaskFromBoard(board, payload.id) : board,
            );
            void client.invalidateQueries({ queryKey: keys.tasks(orgId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
        });

        socket.on('activity:created', (payload: { taskId?: string | null; projectId?: string | null }) => {
            void client.invalidateQueries({ queryKey: keys.activity(orgId) });
            if (payload.taskId) void client.invalidateQueries({ queryKey: keys.task(payload.taskId) });
            if (payload.projectId) void client.invalidateQueries({ queryKey: keys.project(payload.projectId) });
        });

        socket.on('project:updated', (payload: { projectId?: string; deleted?: boolean }) => {
            if (payload.projectId) void client.invalidateQueries({ queryKey: keys.project(payload.projectId) });
            void client.invalidateQueries({ queryKey: ['org', orgId, 'projects'] });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
        });

        socket.on('members:changed', () => {
            void client.invalidateQueries({ queryKey: keys.members(orgId) });
            void client.invalidateQueries({ queryKey: keys.presence(orgId) });
            void client.invalidateQueries({ queryKey: keys.teams(orgId) });
            void client.invalidateQueries({ queryKey: keys.session });
            void client.invalidateQueries({ queryKey: keys.organization(orgId) });
        });

        // A flip is patched straight into the roster cache rather than refetched: it is one row,
        // and the payload carries exactly what the row needs.
        socket.on('presence:updated', (payload: PresenceDto & { orgId: string }) => {
            if (payload.orgId !== orgId) return;
            const { userId, online, lastSeenAt }: PresenceDto = { userId: payload.userId, online: payload.online, lastSeenAt: payload.lastSeenAt };
            client.setQueryData<PresenceDto[]>(keys.presence(orgId), (rows) => {
                // No roster loaded on this screen yet — nothing to patch, and fetching one here
                // would put presence on the critical path of a page that never asked for it.
                if (!rows) return rows;
                const index = rows.findIndex((row) => row.userId === userId);
                if (index < 0) return [...rows, { userId, online, lastSeenAt }];
                const next = [...rows];
                next[index] = { userId, online, lastSeenAt };
                return next;
            });
        });

        socket.on('notification:new', (notification: NotificationDto) => {
            void client.invalidateQueries({ queryKey: ['notifications'] });
            toast.info(notification.title, {
                label: 'Open',
                onClick: () => notification.link && router.push(notification.link),
            });
        });

        return () => {
            window.clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', onVisibility);
            socket.removeAllListeners();
            socket.close();
        };
    }, [client, orgId, toast, router]);

    const value = useMemo(() => ({ status }), [status]);
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
