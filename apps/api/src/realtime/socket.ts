import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { ACCESS_COOKIE } from '../services/session.js';
import { attachSocketServer, rooms } from './bus.js';

/**
 * Socket.IO gateway.
 *
 * Authentication reuses the access-token cookie (or `handshake.auth.token` for native
 * clients). Each socket joins its user room plus one room per organization and per
 * project it belongs to, so services can fan out without tracking connections.
 */

function parseCookies(header?: string): Record<string, string> {
    if (!header) return {};
    return Object.fromEntries(
        header.split(';').map((part) => {
            const index = part.indexOf('=');
            if (index < 0) return [part.trim(), ''];
            return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
        }),
    );
}

export function initRealtime(httpServer: HttpServer): Server {
    const io = new Server(httpServer, {
        path: '/realtime',
        cors: { origin: env.corsOrigins, credentials: true },
        serveClient: false,
        pingInterval: 25_000,
        pingTimeout: 20_000,
    });

    io.use(async (socket, next) => {
        try {
            const cookies = parseCookies(socket.handshake.headers.cookie);
            const token = cookies[ACCESS_COOKIE] ?? (socket.handshake.auth?.token as string | undefined);
            if (!token) return next(new Error('unauthenticated'));
            const claims = verifyAccessToken(token);
            socket.data.userId = claims.sub;
            return next();
        } catch {
            return next(new Error('unauthenticated'));
        }
    });

    io.on('connection', async (socket: Socket) => {
        const userId = socket.data.userId as string;
        await socket.join(rooms.user(userId));

        const memberships = await prisma.organizationMember.findMany({
            where: { userId },
            select: { orgId: true },
        });
        const projectCount = await prisma.projectMember.groupBy({ by: ['projectId'], where: { userId } });
        await Promise.all([
            ...memberships.map((m) => socket.join(rooms.org(m.orgId))),
            ...projectCount.map((p) => socket.join(rooms.project(p.projectId))),
        ]);

        socket.on('disconnect', () => logger.debug({ userId }, 'socket disconnected'));
    });

    attachSocketServer(io);
    logger.info({ path: '/realtime', origins: env.corsOrigins }, 'Socket.IO ready');
    return io;
}
