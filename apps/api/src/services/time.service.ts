import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import { lightUser } from './presenters.js';
import { recordActivity } from './activity.js';
import { loadTaskAccess } from './access.js';
import type { AuthUser } from '../types/express.js';
import type { ManualTimeLogInput, StartTimeLogInput } from '../domain/schemas.js';

/**
 * Time tracking.
 *
 * A `TimeLog` row is one sitting: `startedAt` with no `stoppedAt` is a live timer, and stopping it
 * freezes `durationMins` so every later read (cards, burndown, member totals) is a plain sum instead
 * of a "now minus start" special case. One running timer per person per task — the widget can only
 * be in one state, and a stray second row would silently double the reported time.
 *
 * Anyone who can see the task may log time on it, including on an archived project: recording the
 * hours you already worked is exactly what a closed project still needs. Deleting someone else's
 * entry is a manager call.
 */

const MINUTE_MS = 60_000;
/** Guards a mistyped manual entry: no honest sitting is longer than a month of work. */
const MAX_MINUTES = 60 * 24 * 30;

const entryInclude = { user: true } as const;
type EntryRow = Prisma.TimeLogGetPayload<{ include: typeof entryInclude }>;

function presentEntry(entry: EntryRow) {
    return {
        id: entry.id,
        taskId: entry.taskId,
        userId: entry.userId,
        user: lightUser(entry.user),
        startedAt: entry.startedAt.toISOString(),
        stoppedAt: entry.stoppedAt?.toISOString() ?? null,
        durationMins: entry.durationMins,
        description: entry.description,
        running: entry.stoppedAt === null,
    };
}

/** The live timer for this person on this task, if any. */
export async function runningEntry(userId: string, taskId: string) {
    const row = await prisma.timeLog.findFirst({
        where: { userId, taskId, stoppedAt: null },
        include: entryInclude,
    });
    return row ? presentEntry(row) : null;
}

/**
 * Everything the drawer timer widget needs: the person's own entries plus totals for the task,
 * so one request paints the list, the running state and the logged-vs-estimate figure.
 */
export async function taskTime(user: AuthUser, taskId: string) {
    const { access } = await loadTaskAccess(user, taskId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');

    const [rows, task] = await Promise.all([
        prisma.timeLog.findMany({ where: { taskId }, include: entryInclude, orderBy: { startedAt: 'desc' } }),
        prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { estimateMins: true } }),
    ]);

    const entries = rows.map(presentEntry);
    const byUser = new Map<string, number>();
    let totalMins = 0;
    for (const row of rows) {
        if (!row.durationMins) continue;
        totalMins += row.durationMins;
        byUser.set(row.userId, (byUser.get(row.userId) ?? 0) + row.durationMins);
    }
    const people = await prisma.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, firstName: true, lastName: true, avatarUrl: true } });

    return {
        entries,
        running: entries.find((entry) => entry.userId === user.id && entry.running) ?? null,
        summary: {
            totalMins,
            estimateMins: task.estimateMins,
            // Positive means the work has outgrown its estimate.
            overEstimateMins: task.estimateMins === null ? null : totalMins - task.estimateMins,
            byUser: people.map((person) => ({ user: person, mins: byUser.get(person.id) ?? 0 })).sort((a, b) => b.mins - a.mins),
        },
    };
}

export async function startTimer(user: AuthUser, taskId: string, input: StartTimeLogInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');

    const existing = await prisma.timeLog.findFirst({ where: { taskId, userId: user.id, stoppedAt: null }, include: entryInclude });
    if (existing) throw new Conflict('A timer is already running for you on this task');

    const created = await prisma.timeLog.create({
        data: { taskId, userId: user.id, startedAt: new Date(), description: input.description ?? null },
        include: entryInclude,
    });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'time.started',
        meta: { title: task.title, timeLogId: created.id },
    });
    return presentEntry(created);
}

export async function stopTimer(user: AuthUser, taskId: string) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');

    const running = await prisma.timeLog.findFirst({ where: { taskId, userId: user.id, stoppedAt: null } });
    if (!running) throw new NotFound('No timer is running for you on this task');

    const stoppedAt = new Date();
    const mins = Math.max(1, Math.round((stoppedAt.getTime() - running.startedAt.getTime()) / MINUTE_MS));
    const saved = await prisma.timeLog.update({
        where: { id: running.id },
        data: { stoppedAt, durationMins: mins },
        include: entryInclude,
    });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'time.logged',
        meta: { title: task.title, mins, timeLogId: saved.id },
    });
    return presentEntry(saved);
}

/** Backfill an hours-worked row for something that happened away from the timer. */
export async function addEntry(user: AuthUser, taskId: string, input: ManualTimeLogInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');

    const startedAt = input.startedAt;
    const stoppedAt = input.stoppedAt ?? null;
    if (stoppedAt && stoppedAt <= startedAt) throw new BadRequest('stoppedAt must be after startedAt');
    if (startedAt.getTime() > Date.now() + MINUTE_MS) throw new BadRequest('A time entry cannot start in the future');

    // Either the caller names the minutes or we read them off the start/stop pair.
    const durationMins = Math.round(input.durationMins ?? ((stoppedAt as Date).getTime() - startedAt.getTime()) / MINUTE_MS);
    if (!Number.isFinite(durationMins) || durationMins < 1) throw new BadRequest('Time entries must be at least a minute');
    if (durationMins > MAX_MINUTES) throw new BadRequest(`Time entries cannot exceed ${MAX_MINUTES} minutes`);

    const created = await prisma.timeLog.create({
        data: {
            taskId,
            userId: user.id,
            startedAt,
            stoppedAt: stoppedAt ?? new Date(startedAt.getTime() + durationMins * MINUTE_MS),
            durationMins,
            description: input.description ?? null,
        },
        include: entryInclude,
    });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'time.logged',
        meta: { title: task.title, mins: durationMins, timeLogId: created.id, manual: true },
    });
    return presentEntry(created);
}

export async function deleteEntry(user: AuthUser, taskId: string, entryId: string) {
    const { project, access } = await loadTaskAccess(user, taskId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');

    const entry = await prisma.timeLog.findFirst({ where: { id: entryId, taskId }, include: entryInclude });
    if (!entry) throw new NotFound('Time entry not found');
    // Own entries are always removable; someone else's needs a manager.
    if (entry.userId !== user.id && !can.moderateComment(access)) throw new Forbidden('Only a manager can remove someone else’s time entry');

    await prisma.timeLog.delete({ where: { id: entryId } });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'time.deleted',
        meta: { timeLogId: entryId, mins: entry.durationMins },
    });
    return { id: entryId };
}
