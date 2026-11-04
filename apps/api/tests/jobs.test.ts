import { describe, expect, it } from 'vitest';
import { addMember, createProject, createTask, signUp, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { runHousekeeping, sendDueReminders, startJobs } from '../src/jobs/scheduler.js';
import { hashSecret, randomToken } from '../src/lib/crypto.js';

/**
 * The only scheduled job: a daily digest of overdue and soon-due work.
 *
 * The suite shares one database and several of its files create due dates, so these
 * assertions are always about a specific user rather than a global counter.
 */

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('due reminders', () => {
    it('collects open work due within the horizon into one notification per person', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);

        const late = await createTask(owner, board.projectId, { title: 'Renew the certificate', dueDate: daysFromNow(-2), assigneeIds: [teammate.userId] });
        await createTask(owner, board.projectId, { title: 'Far future', dueDate: daysFromNow(30), assigneeIds: [teammate.userId] });
        await createTask(owner, board.projectId, {
            title: 'Already finished',
            status: 'done',
            dueDate: daysFromNow(-5),
            assigneeIds: [teammate.userId],
        });

        await sendDueReminders();

        const digest = await prisma.notification.findFirst({ where: { userId: teammate.userId, type: 'task.due' } });
        expect(digest).not.toBeNull();
        expect(digest!.title).toBe('1 task due or overdue');
        expect(digest!.body).toContain('Renew the certificate');
        expect(digest!.body).toContain('[overdue]');
        expect(digest!.link).toBe('/my-tasks');
        expect(digest!.body).not.toContain('Far future');
        expect(digest!.body).not.toContain('Already finished');
        expect(late.title).toBe('Renew the certificate');

        // A second run on the same day must not wake anybody up twice.
        const before = await prisma.notification.count({ where: { userId: teammate.userId, type: 'task.due' } });
        await sendDueReminders();
        expect(await prisma.notification.count({ where: { userId: teammate.userId, type: 'task.due' } })).toBe(before);
    });

    it('skips deactivated accounts and tasks without a due date', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);

        await createTask(owner, board.projectId, { title: 'No date', assigneeIds: [teammate.userId] });

        await sendDueReminders();
        expect(await prisma.notification.count({ where: { userId: teammate.userId, type: 'task.due' } })).toBe(0);

        const inactive = await addMember(owner, 'member');
        const late = await createTask(owner, board.projectId, { title: 'Handed over', dueDate: daysFromNow(-1), assigneeIds: [inactive.userId] });
        await owner.agent.delete(`/api/organizations/${owner.orgId}/members/${inactive.userId}`).expect(200);
        // Removing the member clears the assignment, so there is nothing left to remind about.
        expect(await prisma.taskAssignee.count({ where: { taskId: late.id, userId: inactive.userId } })).toBe(0);

        await sendDueReminders();
        expect(await prisma.notification.count({ where: { userId: inactive.userId, type: 'task.due' } })).toBe(0);
    });

    it('is a no-op runner when cron is switched off', () => {
        // Tests run with CRON_ENABLED=false so a suite never waits on a real schedule.
        const runner = startJobs();
        expect(typeof runner.stop).toBe('function');
        expect(() => runner.stop()).not.toThrow();
    });
});

describe('housekeeping', () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
    /** Hash a fresh secret the way the services do, so the seeded rows look like real ones. */
    const hash = () => hashSecret(randomToken(32));

    it('retires dead credentials, expired buckets and read notifications', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);
        // Past both the 30-day grace on dead credentials and the notification retention window.
        const ancient = 400;

        const deadToken = await prisma.refreshToken.create({ data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(ancient) } });
        const revokedToken = await prisma.refreshToken.create({ data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(ancient - 5), revokedAt: daysAgo(ancient - 10) } });
        const consumedReset = await prisma.passwordResetToken.create({ data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(ancient), usedAt: daysAgo(ancient) } });
        const staleBucket = await prisma.rateLimitBucket.create({ data: { bucketKey: `test:${unique('bucket')}`, count: 4, expiresAt: daysAgo(1) } });
        const deadInvite = await prisma.invitation.create({
            data: { orgId: owner.orgId, email: `${unique('gone')}@atlas.test`, tokenHash: hash(), invitedById: owner.userId, expiresAt: daysAgo(ancient) },
        });
        const readNotice = await prisma.notification.create({
            data: { userId: owner.userId, orgId: owner.orgId, type: 'task.due', title: 'Old news', body: 'x', readAt: daysAgo(ancient), createdAt: daysAgo(ancient) },
        });

        // Each of these has to survive: the guardrails are the whole point of the grace period.
        const freshSession = await prisma.refreshToken.create({ data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(2), revokedAt: daysAgo(1) } });
        const liveReset = await prisma.passwordResetToken.create({ data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(10) } });
        const openInvite = await prisma.invitation.create({
            data: { orgId: owner.orgId, email: `${unique('still')}@atlas.test`, tokenHash: hash(), invitedById: owner.userId, expiresAt: daysAgo(ancient), acceptedAt: daysAgo(ancient - 1) },
        });
        const unreadNotice = await prisma.notification.create({
            data: { userId: owner.userId, orgId: owner.orgId, type: 'task.due', title: 'Never seen', body: 'x', createdAt: daysAgo(ancient) },
        });
        const history = await prisma.activity.create({ data: { orgId: owner.orgId, actorId: owner.userId, taskId: task.id, type: 'task.created', meta: '{}', createdAt: daysAgo(ancient) } });

        const counts = await runHousekeeping();
        expect(Object.keys(counts).sort()).toEqual(['invitations', 'notifications', 'rateLimitBuckets', 'refreshTokens', 'resetTokens']);
        expect(counts.refreshTokens).toBeGreaterThanOrEqual(2);
        expect(counts.resetTokens).toBeGreaterThanOrEqual(1);
        expect(counts.rateLimitBuckets).toBeGreaterThanOrEqual(1);
        expect(counts.invitations).toBeGreaterThanOrEqual(1);
        expect(counts.notifications).toBeGreaterThanOrEqual(1);

        expect(await prisma.refreshToken.findUnique({ where: { id: deadToken.id } })).toBeNull();
        expect(await prisma.refreshToken.findUnique({ where: { id: revokedToken.id } })).toBeNull();
        expect(await prisma.passwordResetToken.findUnique({ where: { id: consumedReset.id } })).toBeNull();
        expect(await prisma.rateLimitBucket.findUnique({ where: { id: staleBucket.id } })).toBeNull();
        expect(await prisma.invitation.findUnique({ where: { id: deadInvite.id } })).toBeNull();
        expect(await prisma.notification.findUnique({ where: { id: readNotice.id } })).toBeNull();

        expect(await prisma.refreshToken.findUnique({ where: { id: freshSession.id } })).not.toBeNull();
        expect(await prisma.passwordResetToken.findUnique({ where: { id: liveReset.id } })).not.toBeNull();
        expect(await prisma.invitation.findUnique({ where: { id: openInvite.id } })).not.toBeNull();
        expect(await prisma.notification.findUnique({ where: { id: unreadNotice.id } })).not.toBeNull();
        // The audit trail is history, not scratch data: nothing here is ever pruned.
        expect(await prisma.activity.findUnique({ where: { id: history.id } })).not.toBeNull();
    });

    it('keeps a just-revoked session so reuse detection still has something to compare', async () => {
        const owner = await signUp();
        const revoked = await prisma.refreshToken.create({
            data: { userId: owner.userId, tokenHash: hash(), expiresAt: daysAgo(1), revokedAt: new Date() },
        });

        await runHousekeeping();
        expect(await prisma.refreshToken.findUnique({ where: { id: revoked.id } })).not.toBeNull();
    });
});
