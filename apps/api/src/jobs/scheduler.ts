import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isOpenStatus } from '../domain/enums.js';
import { isOverdue } from '../domain/permissions.js';
import { notify } from '../services/activity.js';
import { mails } from '../services/mailer.js';
import { materializeRecurrences } from '../services/recurrence.service.js';
import { pruneDeliveries, runWebhookRetries } from '../services/webhook.service.js';

/**
 * Scheduled work.
 *
 * Three kinds of work run here: the due-date digest (the only one that has to be on a human clock),
 * housekeeping, which retires the rows that exist purely to expire, and the webhook retry sweep —
 * queueing deliveries in the database rather than a Redis list is what keeps outbound integrations
 * working on a single-box install. `CRON_ENABLED=false` disables all of them on replicas that
 * should not run jobs, which is the standard way to scale an app with a single-instance cron.
 */

export interface JobRunner {
    stop(): void;
}

/**
 * How long a dead credential row is kept after it stops working.
 *
 * Deleting an expired/revoked refresh token the moment it expires would erase the evidence
 * reuse detection needs to notice a stolen token being replayed, so the grace period keeps
 * the row (and the alarm) alive for a month before it is pruned.
 */
const DEAD_CREDENTIAL_GRACE_DAYS = 30;

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

/**
 * Retire rows that can never be used again, so a long-lived deployment does not accumulate
 * dead tokens and a full inbox does not slow every notification query down.
 *
 * The audit trail (`Activity`) is deliberately never touched — it is the product's history,
 * not scratch data — and unread notifications are kept however old they are, because pruning
 * them would silently discard something the user has not seen.
 */
export async function runHousekeeping(now = new Date()): Promise<Record<string, number>> {
    const credentialCutoff = new Date(now.getTime() - DEAD_CREDENTIAL_GRACE_DAYS * 86_400_000);
    const notificationCutoff = new Date(now.getTime() - env.NOTIFICATION_RETENTION_DAYS * 86_400_000);

    const [refreshTokens, resetTokens, buckets, invitations, notifications, apiTokens, deliveries] = await Promise.all([
        // Expired, or revoked long enough ago that a replay would already have been caught.
        prisma.refreshToken.deleteMany({
            where: { OR: [{ expiresAt: { lt: credentialCutoff } }, { revokedAt: { not: null, lt: credentialCutoff } }] },
        }),
        prisma.passwordResetToken.deleteMany({
            where: { OR: [{ expiresAt: { lt: credentialCutoff } }, { usedAt: { not: null, lt: credentialCutoff } }] },
        }),
        prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.invitation.deleteMany({ where: { expiresAt: { lt: credentialCutoff }, acceptedAt: null } }),
        prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: notificationCutoff } } }),
        // A revoked or expired token cannot authenticate again, and the settings list is the only
        // reader — it does not need history, the Activity rows do.
        prisma.apiToken.deleteMany({
            where: { OR: [{ expiresAt: { not: null, lt: now } }, { revokedAt: { lt: credentialCutoff } }] },
        }),
        pruneDeliveries(now),
    ]);

    const counts = {
        refreshTokens: refreshTokens.count,
        resetTokens: resetTokens.count,
        rateLimitBuckets: buckets.count,
        invitations: invitations.count,
        notifications: notifications.count,
        apiTokens: apiTokens.count,
        webhookDeliveries: deliveries,
    };
    if (Object.values(counts).some((value) => value > 0)) {
        logger.info(counts, 'housekeeping finished');
    }
    return counts;
}

/** Schedule one job, tolerating a bad cron expression without taking the other one down. */
function schedule(expression: string, name: string, run: () => Promise<unknown>): cron.ScheduledTask | null {
    if (!cron.validate(expression)) {
        logger.error({ expression, job: name }, `Invalid cron expression, ${name} disabled`);
        return null;
    }
    logger.info({ expression, job: name }, 'Scheduled job');
    return cron.schedule(expression, () => {
        run().catch((error) => logger.error({ err: error, job: name }, 'Job failed'));
    });
}

export function startJobs(): JobRunner {
    if (!env.CRON_ENABLED) {
        logger.info('Cron disabled (CRON_ENABLED=false)');
        return { stop() { } };
    }

    const tasks = [
        schedule(env.DUE_REMINDER_CRON, 'due reminders', sendDueReminders),
        schedule(env.HOUSEKEEPING_CRON, 'housekeeping', runHousekeeping),
        schedule(env.RECURRENCE_CRON, 'recurrence materialisation', materializeRecurrences),
        schedule(env.WEBHOOK_RETRY_CRON, 'webhook retries', runWebhookRetries),
    ].filter((task): task is cron.ScheduledTask => task !== null);

    return {
        stop() {
            for (const task of tasks) task.stop();
        },
    };
}
