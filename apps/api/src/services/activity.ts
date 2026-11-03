import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { emitToOrg, emitToProject, emitToUser } from '../realtime/bus.js';
import type { ActivityType, NotificationType } from '../domain/enums.js';
import type { Mail } from './mailer.js';
import { sendMail } from './mailer.js';

/**
 * Activity stream + notifications.
 *
 * Every mutation writes an append-only `Activity` row. That table is both the audit
 * trail shown in the task/project feeds and the source for trend analytics, which is
 * why recording is mandatory rather than best-effort.
 */

export interface ActivityInput {
    orgId: string;
    actorId: string;
    type: ActivityType;
    meta?: Record<string, unknown>;
    projectId?: string | null;
    taskId?: string | null;
}

export async function recordActivity(input: ActivityInput) {
    const activity = await prisma.activity.create({
        data: {
            orgId: input.orgId,
            actorId: input.actorId,
            type: input.type,
            projectId: input.projectId ?? null,
            taskId: input.taskId ?? null,
            meta: JSON.stringify(input.meta ?? {}),
        },
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });

    const payload = {
        id: activity.id,
        type: activity.type,
        meta: input.meta ?? {},
        projectId: activity.projectId,
        taskId: activity.taskId,
        actor: activity.actor,
        createdAt: activity.createdAt.toISOString(),
    };
    if (activity.projectId) emitToProject(activity.projectId, 'activity:created', payload);
    emitToOrg(input.orgId, 'activity:created', payload);
    return activity;
}

export interface NotifyInput {
    orgId: string;
    userIds: string[];
    type: NotificationType;
    title: string;
    body: string;
    /** Web route, e.g. `/projects/<id>/tasks/<taskId>`. */
    link?: string;
    /** Optional e-mail; suppressed when the recipient disabled that preference. */
    email?: (user: { email: string; firstName: string }) => Mail;
    emailPreference?: 'emailOnAssign' | 'emailOnComment' | 'emailDigest';
}

const DEFAULT_PREFS = { emailOnAssign: true, emailOnComment: true, emailDigest: true };

export function parsePrefs(raw: string): typeof DEFAULT_PREFS {
    try {
        return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as object) } as typeof DEFAULT_PREFS;
    } catch {
        return DEFAULT_PREFS;
    }
}

export async function notify(input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) return;

    const users = await prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true, email: true, firstName: true, prefs: true },
    });
    if (users.length === 0) return;

    // Individual creates (a handful of recipients per event) so each row can be pushed
    // over the socket immediately with its own id.
    const rows = await prisma.$transaction(
        users.map((user) =>
            prisma.notification.create({
                data: {
                    userId: user.id,
                    orgId: input.orgId,
                    type: input.type,
                    title: input.title,
                    body: input.body.slice(0, 400),
                    link: input.link ?? null,
                },
            }),
        ),
    );

    const byUser = new Map(rows.map((row) => [row.userId, row]));

    await Promise.all(
        users.map(async (user) => {
            const notification = byUser.get(user.id);
            if (notification) {
                emitToUser(user.id, 'notification:new', {
                    id: notification.id,
                    type: notification.type,
                    title: notification.title,
                    body: notification.body,
                    link: notification.link,
                    createdAt: notification.createdAt.toISOString(),
                });
            }
            if (!input.email) return;
            const prefs = parsePrefs(user.prefs);
            const enabled = input.emailPreference ? prefs[input.emailPreference] : true;
            if (!enabled) return;
            await sendMail(input.email({ email: user.email, firstName: user.firstName }));
        }),
    );

    logger.debug({ type: input.type, recipients: users.length }, 'notification fan-out');
}

/** Mark notifications as read (all, or an explicit id list). */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
    const result = ids?.length
        ? await prisma.notification.updateMany({
            where: { userId, id: { in: ids }, readAt: null },
            data: { readAt: new Date() },
        })
        : await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return result.count;
}
