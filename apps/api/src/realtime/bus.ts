import type { Server as SocketServer } from 'socket.io';

/**
 * Real-time fan-out.
 *
 * Services call `emitToUser` / `emitToOrg`; if Socket.IO is not attached (unit tests,
 * single-process boots) the events are dropped silently — the database remains the
 * source of truth and the UI refetches on top of these hints.
 */
let io: SocketServer | null = null;

export function attachSocketServer(server: SocketServer): void {
    io = server;
}

export function detachSocketServer(): void {
    io = null;
}

export const rooms = {
    user: (userId: string) => `user:${userId}`,
    org: (orgId: string) => `org:${orgId}`,
    project: (projectId: string) => `project:${projectId}`,
};

export type RealtimeEvent =
    | 'notification:new'
    | 'activity:created'
    | 'task:created'
    | 'task:updated'
    | 'task:deleted'
    | 'project:updated'
    | 'members:changed';

export function emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
    if (!io) return;
    io.to(rooms.user(userId)).emit(event, payload);
}

export function emitToOrg(orgId: string, event: RealtimeEvent, payload: unknown): void {
    if (!io) return;
    io.to(rooms.org(orgId)).emit(event, payload);
}

export function emitToProject(projectId: string, event: RealtimeEvent, payload: unknown): void {
    if (!io) return;
    io.to(rooms.project(projectId)).emit(event, payload);
}

export function socketHealth(): string {
    if (!io) return 'detached';
    return `${io.engine.clientsCount} clients`;
}
