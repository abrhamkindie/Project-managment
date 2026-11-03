import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as client, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { initRealtime } from '../src/realtime/socket.js';
import { detachSocketServer } from '../src/realtime/bus.js';
import { createProject, createTask, addMember, cookieValue, PASSWORD, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Real-time fan-out.
 *
 * The socket gateway is a hint layer on top of the database, so these tests assert the
 * two things the UI depends on: an unauthenticated handshake never joins a room, and a
 * mutation inside a project reaches the people watching that project.
 */

let httpServer: HttpServer;
let origin: string;

beforeAll(async () => {
    httpServer = createServer(createApp());
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
    initRealtime(httpServer);
});

afterAll(async () => {
    detachSocketServer();
    await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
    });
});

function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = client(origin, {
            path: '/realtime',
            auth: token ? { token } : {},
            transports: ['websocket'],
            timeout: 4000,
        });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', (error) => reject(error));
    });
}

function once(socket: Socket, event: string, timeout = 4000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "${event}" event within ${timeout}ms`)), timeout);
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

const closeAll = (sockets: Socket[]) =>
    Promise.all(
        sockets.map(
            (socket) =>
                new Promise<void>((resolve) => {
                    socket.close();
                    resolve();
                }),
        ),
    );

describe('socket gateway', () => {
    it('refuses a handshake without a token', async () => {
        await expect(connect()).rejects.toThrow(/unauthenticated/);
    });

    it('refuses a handshake with a bogus token', async () => {
        await expect(connect('not-a-jwt')).rejects.toThrow(/unauthenticated/);
    });

    it('pushes board events to the watchers and notifications to the person', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const board = await createProject(owner);

        // Rooms are joined at handshake, exactly like a freshly opened browser tab.
        const watcher = await connect(await tokenFor(teammate.email));
        const activity = once(watcher, 'activity:created');
        const notification = once(watcher, 'notification:new');

        const task = await createTask(owner, board.projectId, { title: 'Broadcast me', assigneeIds: [teammate.userId] });

        await expect(activity).resolves.toMatchObject({ type: 'task.created', taskId: task.id });
        const pushed = (await notification) as { type: string; title: string; link: string };
        expect(pushed).toMatchObject({ type: 'task.assigned', title: 'New task: Broadcast me' });
        expect(pushed.link).toMatch(new RegExp(`^/projects/${board.projectId}/tasks/${task.id}$`));

        await closeAll([watcher]);
    });

    it('fans an update out to everybody watching the project', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const board = await createProject(owner, { memberIds: [teammate.userId] });
        const task = await createTask(owner, board.projectId);

        const ownerSocket = await connect(await tokenFor(owner.email));
        const teammateSocket = await connect(await tokenFor(teammate.email));

        const updates = Promise.all([once(ownerSocket, 'task:updated'), once(teammateSocket, 'task:updated')]);
        await request(httpServer)
            .patch(`/api/tasks/${task.id}`)
            .set('Cookie', await cookieFor(owner.email))
            .send({ priority: 'high' })
            .expect(200);

        const received = (await updates) as { id: string; priority: string }[];
        expect(received.every((payload) => payload.id === task.id && payload.priority === 'high')).toBe(true);

        await closeAll([ownerSocket, teammateSocket]);
    });
});

/** A fresh login per socket keeps the token handling identical to the browser path. */
async function tokenFor(email: string): Promise<string> {
    const login = await request(httpServer)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
    return cookieValue(login, 'atlas_at');
}

async function cookieFor(email: string): Promise<string> {
    const login = await request(httpServer).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return `atlas_at=${cookieValue(login, 'atlas_at')}`;
}

afterAll(() => prisma.$disconnect());
