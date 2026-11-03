import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isOpenStatus } from '../domain/enums.js';
import { isOverdue } from '../domain/permissions.js';
import { notify } from '../services/activity.js';
import { mails } from '../services/mailer.js';

/**
 * Scheduled work.
 *
 * Only the due-date digest needs a clock: everything else in Atlas is event-driven from
 * the API. `CRON_ENABLED=false` disables it on replicas that should not run jobs, which
 * is the standard way to scale an app with a single-instance cron.
 */

export interface JobRunner {
    stop(): void;
}

/** One digest per user per day: overdue tasks plus anything due in the next 3 days. */
export async function sendDueReminders(now = new Date()): Promise<{ usersNotified: number }> {
    const horizon = new Date(now.getTime() + 3 * 86_400_000);
    const assignments = await prisma.taskAssignee.findMany({
        where: {
            user: { isActive: true },
            task: {
                deletedAt: null,
                status: { in: ['todo', 'in_progress', 'in_review'] },
                dueDate: { lte: horizon },
            },
        },
        include: {
            user: { select: { id: true, firstName: true, email: true } },
            task: { include: { project: { select: { id: true, name: true, orgId: true } } } },
        },
    });

    const byUser = new Map<string, { user: (typeof assignments)[number]['user']; orgId: string; tasks: typeof assignments }>();
    for (const row of assignments) {
        if (isOpenStatus(row.task.status)) {
            const entry = byUser.get(row.userId) ?? { user: row.user, orgId: row.task.project.orgId, tasks: [] };
            entry.tasks.push(row);
            byUser.set(row.userId, entry);
        }
    }

    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    let usersNotified = 0;
    for (const [userId, entry] of byUser) {
        const alreadySent = await prisma.notification.findFirst({
            where: { userId, type: 'task.due', createdAt: { gte: dayStart } },
            select: { id: true },
        });
        if (alreadySent) continue;

        const items = entry.tasks
            .map((a) => ({
                title: a.task.title,
                project: a.task.project.name,
                due: a.task.dueDate!.toDateString(),
                overdue: isOverdue(a.task.dueDate, a.task.status, now),
            }))
            .sort((a, b) => Number(b.overdue) - Number(a.overdue))
            .slice(0, 15);

        await notify({
            orgId: entry.orgId,
            userIds: [userId],
            type: 'task.due',
            title: `${items.length} task${items.length === 1 ? '' : 's'} due or overdue`,
            body: items.map((i) => `${i.overdue ? '[overdue] ' : ''}${i.title} (${i.project})`).join(' · ').slice(0, 400),
            link: '/my-tasks',
            emailPreference: 'emailDigest',
            email: ({ email }) =>
                mails.dueSoon({
                    to: email,
                    firstName: entry.user.firstName,
                    tasks: items,
                    link: `${env.WEB_URL}/my-tasks`,
                }),
        });
        usersNotified += 1;
    }

    logger.info({ usersNotified }, 'due reminder job finished');
    return { usersNotified };
}

export function startJobs(): JobRunner {
    if (!env.CRON_ENABLED) {
        logger.info('Cron disabled (CRON_ENABLED=false)');
        return { stop() { } };
    }
    if (!cron.validate(env.DUE_REMINDER_CRON)) {
        logger.error({ expression: env.DUE_REMINDER_CRON }, 'Invalid DUE_REMINDER_CRON, due reminders disabled');
        return { stop() { } };
    }

    const task = cron.schedule(env.DUE_REMINDER_CRON, () => {
        sendDueReminders().catch((error) => logger.error({ err: error }, 'Due reminder job failed'));
    });
    logger.info({ expression: env.DUE_REMINDER_CRON }, 'Scheduled due reminders');

    return {
        stop() {
            task.stop();
        },
    };
}
