import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io as client, type Socket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { initRealtime } from "../src/realtime/socket.js";
import { resetPresence } from "../src/realtime/presence.js";
import { detachSocketServer } from "../src/realtime/bus.js";
import {
  createProject,
  createTask,
  addMember,
  cookieValue,
  PASSWORD,
  signUp,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

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
      path: "/realtime",
      auth: token ? { token } : {},
      transports: ["websocket"],
      timeout: 4000,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}

function once(socket: Socket, event: string, timeout = 4000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no "${event}" event within ${timeout}ms`)),
      timeout,
    );
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

interface PresenceEvent {
  orgId: string;
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

/**
 * Resolve the next `presence:updated` for one person. The watcher's own socket receives
 * announcements about *them* too (every join is broadcast to the whole org room), so an
 * unfiltered `once` would resolve on the wrong payload.
 */
function arrivalFor(
  socket: Socket,
  userId: string,
  timeout = 4000,
): Promise<PresenceEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`no presence event for ${userId} within ${timeout}ms`),
        ),
      timeout,
    );
    const handler = (payload: PresenceEvent) => {
      if (payload.userId !== userId) return;
      clearTimeout(timer);
      socket.off("presence:updated", handler);
      resolve(payload);
    };
    socket.on("presence:updated", handler);
  });
}

async function presenceRow(
  email: string,
  orgId: string,
  userId: string,
): Promise<PresenceEvent | undefined> {
  const res = await request(httpServer)
    .get(`/api/organizations/${orgId}/presence`)
    .set("Cookie", await cookieFor(email))
    .expect(200);
  return (res.body.items as PresenceEvent[]).find(
    (row) => row.userId === userId,
  );
}

/**
 * Wait until the gateway has finished admitting a socket.
 *
 * Socket.IO discards a `close` sent during the first instants of the handshake: no
 * `disconnect` reaches the server, so a test that connects and immediately closes would be
 * pulling the trigger on a connection the gateway has not registered yet. Storing the
 * presence stamp is the last act of the connection handler, so a written stamp is the honest
 * signal that the handler — and with it the `disconnect` listener — is in place.
 */
async function joined(userId: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });
    if (row?.lastSeenAt) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the socket for ${userId} never finished joining`);
}

describe("socket gateway", () => {
  it("refuses a handshake without a token", async () => {
    await expect(connect()).rejects.toThrow(/unauthenticated/);
  });

  it("refuses a handshake with a bogus token", async () => {
    await expect(connect("not-a-jwt")).rejects.toThrow(/unauthenticated/);
  });

  it("pushes board events to the watchers and notifications to the person", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner);
    const board = await createProject(owner);

    // Rooms are joined at handshake, exactly like a freshly opened browser tab.
    const watcher = await connect(await tokenFor(teammate.email));
    const activity = once(watcher, "activity:created");
    const notification = once(watcher, "notification:new");

    const task = await createTask(owner, board.projectId, {
      title: "Broadcast me",
      assigneeIds: [teammate.userId],
    });

    await expect(activity).resolves.toMatchObject({
      type: "task.created",
      taskId: task.id,
    });
    const pushed = (await notification) as {
      type: string;
      title: string;
      link: string;
    };
    expect(pushed).toMatchObject({
      type: "task.assigned",
      title: "New task: Broadcast me",
    });
    expect(pushed.link).toMatch(
      new RegExp(`^/projects/${board.projectId}/tasks/${task.id}$`),
    );

    await closeAll([watcher]);
  });

  it("fans an update out to everybody watching the project", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner);
    const board = await createProject(owner, { memberIds: [teammate.userId] });
    const task = await createTask(owner, board.projectId);

    const ownerSocket = await connect(await tokenFor(owner.email));
    const teammateSocket = await connect(await tokenFor(teammate.email));

    const updates = Promise.all([
      once(ownerSocket, "task:updated"),
      once(teammateSocket, "task:updated"),
    ]);
    await request(httpServer)
      .patch(`/api/tasks/${task.id}`)
      .set("Cookie", await cookieFor(owner.email))
      .send({ priority: "high" })
      .expect(200);

    const received = (await updates) as { id: string; priority: string }[];
    expect(
      received.every(
        (payload) => payload.id === task.id && payload.priority === "high",
      ),
    ).toBe(true);

    await closeAll([ownerSocket, teammateSocket]);
  });
});

describe("presence", () => {
  // Every test starts from a clean registry: sockets left over from an earlier test in this
  // shared process would otherwise still count the person as online.
  afterEach(() => resetPresence());

  it("announces a teammate arriving and shows them online in the roster", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner);

    const watcher = await connect(await tokenFor(owner.email));
    const arrival = arrivalFor(watcher, teammate.userId);
    const teammateSocket = await connect(await tokenFor(teammate.email));

    await expect(arrival).resolves.toMatchObject({
      orgId: owner.orgId,
      userId: teammate.userId,
      online: true,
    });
    expect(
      (await presenceRow(owner.email, owner.orgId, teammate.userId))?.online,
    ).toBe(true);

    await closeAll([teammateSocket, watcher]);
  });

  it("marks them gone the moment their last socket closes", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner);

    const watcher = await connect(await tokenFor(owner.email));
    // Consume the online flip first so the next promise cannot resolve on a stale payload.
    const online = arrivalFor(watcher, teammate.userId);
    const teammateSocket = await connect(await tokenFor(teammate.email));
    await Promise.all([online, joined(teammate.userId)]);

    const departure = arrivalFor(watcher, teammate.userId);
    await closeAll([teammateSocket]);
    const left = await departure;
    expect(left.online).toBe(false);
    // "seen X ago" is measured from the disconnect, not from an older heartbeat.
    expect(left.lastSeenAt).not.toBeNull();
    expect(Date.parse(left.lastSeenAt!)).toBeLessThanOrEqual(Date.now());

    expect(
      (await presenceRow(owner.email, owner.orgId, teammate.userId))?.online,
    ).toBe(false);

    await closeAll([watcher]);
  });

  it("answers only for members of that workspace", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner);
    const stranger = await signUp();

    const strangerSocket = await connect(await tokenFor(stranger.email));
    const teammateSocket = await connect(await tokenFor(teammate.email));

    // The stranger shares no org with anybody here, so the roster is unreadable for them.
    await request(httpServer)
      .get(`/api/organizations/${owner.orgId}/presence`)
      .set("Cookie", await cookieFor(stranger.email))
      .expect(403);

    // Their own workspace reports only their own roster: the connected teammate stays out of it.
    const items = (
      await request(httpServer)
        .get(`/api/organizations/${stranger.orgId}/presence`)
        .set("Cookie", await cookieFor(stranger.email))
        .expect(200)
    ).body.items as PresenceEvent[];
    expect(items.map((row) => row.userId)).toEqual([stranger.userId]);

    // And in the workspace they do belong to, exactly the two members are reported.
    const roster = (
      await request(httpServer)
        .get(`/api/organizations/${owner.orgId}/presence`)
        .set("Cookie", await cookieFor(owner.email))
        .expect(200)
    ).body.items as PresenceEvent[];
    expect(roster.map((row) => row.userId).sort()).toEqual(
      [owner.userId, teammate.userId].sort(),
    );
    expect(roster.find((row) => row.userId === teammate.userId)?.online).toBe(
      true,
    );

    await closeAll([strangerSocket, teammateSocket]);
  });
});

/** A fresh login per socket keeps the token handling identical to the browser path. */
async function tokenFor(email: string): Promise<string> {
  const login = await request(httpServer)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);
  return cookieValue(login, "zorqen_at");
}

async function cookieFor(email: string): Promise<string> {
  const login = await request(httpServer)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);
  return `zorqen_at=${cookieValue(login, "zorqen_at")}`;
}

afterAll(() => prisma.$disconnect());
