import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { emitToOrg } from './bus.js';

/**
 * Who is around right now.
 *
 * Two sources, deliberately: an in-process registry of live sockets answers "are they here"
 * instantly and lets the server push a transition the second it happens, while
 * `User.lastSeenAt` in the database answers "when were they last here" and is the only thing
 * that survives a restart or a second replica (whose sockets this map cannot see). A reader
 * therefore gets the registry when it knows the person, and falls back to the stored stamp
 * otherwise, so presence is never *wrong* because the process happens to be a different one.
 *
 * Freshness comes from a heartbeat the web client sends while its tab is visible. Without it,
 * a laptop lid closed eight hours ago would still hold an open socket and look busy.
 *
 * One record per person who has connected since the process started, each holding a set of
 * socket ids: small, bounded by the user table, and cleared by a restart.
 */

interface Tracked {
    /** Socket ids currently connected for this user, so two tabs count as one person. */
    sockets: Set<string>;
    /** Last instant the person was known to be looking at the app (ms since epoch). */
    lastSeenAt: number;
    /** When `lastSeenAt` was last written, to keep heartbeats from becoming a write per minute per user. */
    writtenAt: number;
}

const registry = new Map<string, Tracked>();

/** Window in which a heartbeat still counts as "online". */
const STALE_MS = env.PRESENCE_STALE_SECONDS * 1000;
/** While somebody is online, how often their stamp is pushed to the database. */
const PERSIST_EVERY_MS = 60_000;

export interface Presence {
    userId: string;
    online: boolean;
    /** ISO instant of the last heartbeat, or null if this account has never been seen here. */
    lastSeenAt: string | null;
}

const isFresh = (lastSeenAt: number) => Date.now() - lastSeenAt < STALE_MS;

function entryFor(userId: string): Tracked {
    const existing = registry.get(userId);
    if (existing) return existing;
    const created: Tracked = { sockets: new Set(), lastSeenAt: 0, writtenAt: 0 };
    registry.set(userId, created);
    return created;
}

/**
 * Store the stamp. `force` is used at the moments that matter (arriving, leaving) because a
 * throttled write there would leave a person who just closed the tab looking online.
 */
async function persist(userId: string, at: number, force: boolean): Promise<void> {
    const entry = registry.get(userId);
    if (!entry) return;
    if (!force && at - entry.writtenAt < PERSIST_EVERY_MS) return;
    entry.writtenAt = at;
    try {
        // updateMany rather than update: the account can be deleted between a heartbeat and
        // this write, and a presence stamp is not worth an unhandled rejection over.
        await prisma.user.updateMany({ where: { id: userId }, data: { lastSeenAt: new Date(at) } });
    } catch (error) {
        logger.warn({ err: error, userId }, 'could not store presence stamp');
    }
}

/** Push a change to everybody in the workspaces this person belongs to. */
async function announce(userId: string, presence: Presence): Promise<void> {
    try {
        const memberships = await prisma.organizationMember.findMany({ where: { userId }, select: { orgId: true } });
        for (const { orgId } of memberships) emitToOrg(orgId, 'presence:updated', { orgId, ...presence });
    } catch (error) {
        logger.warn({ err: error, userId }, 'could not announce presence');
    }
}

function snapshot(userId: string, entry: Tracked): Presence {
    return {
        userId,
        online: entry.sockets.size > 0 && isFresh(entry.lastSeenAt),
        lastSeenAt: entry.lastSeenAt > 0 ? new Date(entry.lastSeenAt).toISOString() : null,
    };
}

/**
 * Record that this person is looking at the app. Called on handshake and on every heartbeat;
 * only a real online/offline flip is broadcast, so a minute of beats is one database write and
 * no events at all.
 */
export async function markSeen(userId: string): Promise<void> {
    const entry = entryFor(userId);
    const wasOnline = entry.sockets.size > 0 && isFresh(entry.lastSeenAt);
    entry.lastSeenAt = Date.now();
    const isOnline = entry.sockets.size > 0 && isFresh(entry.lastSeenAt);

    if (isOnline !== wasOnline) void announce(userId, snapshot(userId, entry));
    await persist(userId, entry.lastSeenAt, !wasOnline);
}

/** A socket arrived. The first one for a user is what makes them online. */
export async function joinSocket(userId: string, socketId: string): Promise<void> {
    const entry = entryFor(userId);
    const wasOnline = entry.sockets.size > 0 && isFresh(entry.lastSeenAt);
    entry.sockets.add(socketId);
    entry.lastSeenAt = Date.now();
    if (!wasOnline) void announce(userId, snapshot(userId, entry));
    await persist(userId, entry.lastSeenAt, true);
}

/**
 * A socket went away. Only the last one counts as leaving, and leaving is stored immediately:
 * "seen 2 minutes ago" has to be measured from the moment they actually went.
 *
 * The record is kept with an empty socket set rather than deleted, because this process now
 * knows something the stored stamp does not: they are gone. Dropping the record would make the
 * database fallback answer "online" for the rest of the stale window.
 */
export async function leaveSocket(userId: string, socketId: string): Promise<void> {
    const entry = registry.get(userId);
    if (!entry) return;
    entry.sockets.delete(socketId);
    if (entry.sockets.size > 0) return;
    const lastSeenAt = Date.now();
    entry.lastSeenAt = lastSeenAt;
    entry.writtenAt = lastSeenAt;
    void announce(userId, { userId, online: false, lastSeenAt: new Date(lastSeenAt).toISOString() });
    try {
        await prisma.user.updateMany({ where: { id: userId }, data: { lastSeenAt: new Date(lastSeenAt) } });
    } catch (error) {
        logger.warn({ err: error, userId }, 'could not store presence stamp');
    }
}

/**
 * Presence for a set of people, in the order asked.
 *
 * Only the ids this process has never seen hit the database, and they are fetched in one query,
 * so a workspace roster of 200 people costs one read rather than 200.
 */
export async function presenceFor(userIds: string[]): Promise<Presence[]> {
    const missing = userIds.filter((id) => !registry.has(id));
    const stored = missing.length
        ? await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, lastSeenAt: true } })
        : [];
    const fallback = new Map(stored.map((row) => [row.id, row.lastSeenAt]));

    return userIds.map((userId) => {
        const entry = registry.get(userId);
        if (entry) return snapshot(userId, entry);
        const seen = fallback.get(userId);
        return {
            userId,
            // A stamp from another replica is honest as long as it is inside the window: that
            // process is beating for them, this one simply cannot see the socket.
            online: !!seen && Date.now() - seen.getTime() < STALE_MS,
            lastSeenAt: seen ? seen.toISOString() : null,
        };
    });
}

/** Drop every trace of who is here. Used by tests, which share one process. */
export function resetPresence(): void {
    registry.clear();
}

/** Number of people this process currently holds a live socket for. */
export function onlineCount(): number {
    let count = 0;
    for (const [userId] of registry) {
        if (snapshot(userId, registry.get(userId)!).online) count += 1;
    }
    return count;
}
