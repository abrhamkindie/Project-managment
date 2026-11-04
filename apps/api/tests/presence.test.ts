import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { joinSocket, leaveSocket, markSeen, onlineCount, presenceFor, resetPresence } from '../src/realtime/presence.js';
import { addMember, signUp } from './helpers.js';

/**
 * What "online" means, tested against the clock rather than real sockets: it is a window over
 * heartbeats, and the window is the part that is easy to get subtly wrong. The socket wiring and
 * the HTTP shape are covered in `realtime.test.ts`, where a server actually exists.
 *
 * Only `Date` is faked, so Prisma keeps running against the real event loop.
 */

const STALE_MS = env.PRESENCE_STALE_SECONDS * 1000;
const baseTime = new Date('2026-11-04T09:00:00.000Z');

const rowOf = async (userId: string) => (await presenceFor([userId]))[0];
const stampOf = (userId: string) =>
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastSeenAt: true } }).then((user) => user.lastSeenAt);

describe('presence registry', () => {
    afterEach(() => {
        // The registry is process-wide state, and the suite shares one process.
        resetPresence();
        vi.useRealTimers();
    });

    it('counts a live socket with a recent heartbeat as online, and two tabs as one person', async () => {
        const owner = await signUp();

        await joinSocket(owner.userId, 'tab-1');
        expect(await rowOf(owner.userId)).toEqual({ userId: owner.userId, online: true, lastSeenAt: expect.any(String) });

        await joinSocket(owner.userId, 'tab-2');
        expect(onlineCount()).toBe(1);
        expect((await rowOf(owner.userId)).online).toBe(true);

        // Closing one of two tabs is not the person leaving.
        await leaveSocket(owner.userId, 'tab-1');
        expect((await rowOf(owner.userId)).online).toBe(true);

        await leaveSocket(owner.userId, 'tab-2');
        expect((await rowOf(owner.userId)).online).toBe(false);
        expect(onlineCount()).toBe(0);
    });

    it('stores the stamp, so a restart does not erase when somebody was last here', async () => {
        const owner = await signUp();
        expect(await stampOf(owner.userId)).toBeNull();

        await joinSocket(owner.userId, 'tab-1');
        expect(await stampOf(owner.userId)).toBeInstanceOf(Date);

        // Leaving is stored too, which is exactly the moment "seen a minute ago" measures from.
        await leaveSocket(owner.userId, 'tab-1');
        const stored = await stampOf(owner.userId);
        expect(stored).toBeInstanceOf(Date);
        expect((await rowOf(owner.userId)).lastSeenAt).toBe(stored!.toISOString());
    });

    it('keeps a silent tab online only until the window runs out', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(baseTime);
        const owner = await signUp();

        await joinSocket(owner.userId, 'tab-1');
        expect((await rowOf(owner.userId)).online).toBe(true);

        // A beat most of the way through the window resets the clock.
        vi.advanceTimersByTime(STALE_MS - 10_000);
        await markSeen(owner.userId);
        expect((await rowOf(owner.userId)).online).toBe(true);

        // Then silence. The socket is still open, which is the point: an open connection is not
        // an interested person, and only the heartbeat says otherwise.
        vi.advanceTimersByTime(STALE_MS);
        expect((await rowOf(owner.userId)).online).toBe(false);

        // Coming back to the tab brings them online again, without a new connection.
        await markSeen(owner.userId);
        expect((await rowOf(owner.userId)).online).toBe(true);
    });

    it('throttles the stored stamp while a person stays online', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(baseTime);
        const owner = await signUp();

        await joinSocket(owner.userId, 'tab-1');
        const written = await stampOf(owner.userId);

        vi.advanceTimersByTime(5_000);
        await markSeen(owner.userId);

        // The answer a reader gets moved on; the database did not have to take a write for it.
        expect(await stampOf(owner.userId)).toEqual(written);
        expect((await rowOf(owner.userId)).lastSeenAt).not.toBe(written!.toISOString());
    });

    it('trusts an explicit leave over a stamp that is still inside the window', async () => {
        const owner = await signUp();
        await joinSocket(owner.userId, 'tab-1');
        await leaveSocket(owner.userId, 'tab-1');

        // A second replica would call them online from the fresh stamp; this process knows better.
        expect((await rowOf(owner.userId)).online).toBe(false);
    });

    it('falls back to the stored stamp for people this process never saw', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');

        // Another replica holds their socket, so all this process can read is the stamp.
        await prisma.user.update({ where: { id: teammate.userId }, data: { lastSeenAt: new Date(Date.now() - 30_000) } });
        expect(await rowOf(teammate.userId)).toMatchObject({ online: true });

        await prisma.user.update({
            where: { id: teammate.userId },
            data: { lastSeenAt: new Date(Date.now() - STALE_MS - 60_000) },
        });
        expect(await rowOf(teammate.userId)).toMatchObject({ online: false, lastSeenAt: expect.any(String) });
    });

    it('answers a person nobody has ever seen with no claim at all', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');

        expect(await rowOf(teammate.userId)).toEqual({ userId: teammate.userId, online: false, lastSeenAt: null });
        // One call for a whole roster keeps it to a single read, in the order it was asked.
        const rows = await presenceFor([owner.userId, teammate.userId]);
        expect(rows.map((row) => row.userId)).toEqual([owner.userId, teammate.userId]);
    });
});
