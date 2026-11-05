import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { ACCESS_COOKIE } from "../services/session.js";
import { attachSocketServer, rooms } from "./bus.js";
import { joinSocket, leaveSocket, markSeen } from "./presence.js";

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
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [part.trim(), ""];
      return [
        part.slice(0, index).trim(),
        decodeURIComponent(part.slice(index + 1).trim()),
      ];
    }),
  );
}

/** Rooms this user should be in right now. */
async function expectedRooms(userId: string): Promise<Set<string>> {
  const [memberships, projectRows] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { userId },
      select: { orgId: true },
    }),
    prisma.projectMember.groupBy({ by: ["projectId"], where: { userId } }),
  ]);
  return new Set([
    rooms.user(userId),
    ...memberships.map((m) => rooms.org(m.orgId)),
    ...projectRows.map((p) => rooms.project(p.projectId)),
  ]);
}

/**
 * Reconcile a socket's room list with the roster.
 *
 * Joining alone would leave a socket subscribed to a project it was removed from, which
 * keeps pushing updates the user no longer has rights to see — so rooms that are ours
 * (prefixed) and no longer expected are left as well.
 */
async function syncRooms(socket: Socket, userId: string): Promise<void> {
  const expected = await expectedRooms(userId);
  const current = [...socket.rooms].filter((name) => name !== socket.id);
  await Promise.all([
    ...[...expected]
      .filter((name) => !current.includes(name))
      .map((name) => socket.join(name)),
    ...current
      .filter((name) => !expected.has(name))
      .map((name) => socket.leave(name)),
  ]);
}

export function initRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/realtime",
    cors: { origin: env.corsOrigins, credentials: true },
    serveClient: false,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  logger.info("Redis adapter disabled, using in-memory Socket.IO adapter");

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token =
        cookies[ACCESS_COOKIE] ??
        (socket.handshake.auth?.token as string | undefined);
      if (!token) return next(new Error("unauthenticated"));
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      return next();
    } catch {
      return next(new Error("unauthenticated"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    await syncRooms(socket, userId);
    // Having a socket is not yet being here: the stamp is set now so a reload does not show
    // the person as "last seen yesterday" for a minute, but staying online needs heartbeats.
    await joinSocket(userId, socket.id).catch((error) =>
      logger.warn({ err: error, userId }, "presence join failed"),
    );

    // Membership changes cannot add a room to a socket from the outside, so services
    // nudge the client with `rooms:refresh` and the client asks for this reconciliation.
    socket.on("rooms:sync", async () => {
      try {
        await syncRooms(socket, userId);
      } catch (error) {
        logger.warn({ err: error, userId }, "room sync failed");
      }
    });

    // Sent by a tab that is visible to its user. The server stores it at most once a minute
    // and only broadcasts when it actually changes somebody's state.
    socket.on("presence:heartbeat", () => {
      markSeen(userId).catch((error) =>
        logger.warn({ err: error, userId }, "presence beat failed"),
      );
    });

    socket.on("disconnect", () => {
      logger.debug({ userId }, "socket disconnected");
      void leaveSocket(userId, socket.id).catch((error) =>
        logger.warn({ err: error, userId }, "presence leave failed"),
      );
    });
  });

  attachSocketServer(io);
  logger.info(
    { path: "/realtime", origins: env.corsOrigins },
    "Socket.IO ready",
  );
  return io;
}
