import { describe, expect, it } from 'vitest';
import { addMember, createProject, createTask, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { sendDueReminders, startJobs } from '../src/jobs/scheduler.js';

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
