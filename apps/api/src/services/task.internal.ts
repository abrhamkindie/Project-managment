import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Forbidden } from '../domain/errors.js';
import { DONE_STATUSES, type TaskStatus } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import { notify } from './activity.js';
import { mails } from './mailer.js';
import { TASK_INCLUDE } from './presenters.js';

/**
 * Shared building blocks for the task services (query / mutation / members).
 *
 * Everything here is storage- or announcement-level plumbing that more than one of the
 * split task modules needs. Keeping it in one leaf module is what breaks the circular
 * imports that made the earlier service split fail: this file never imports a sibling
 * task module.
 */

/** The canonical `include` for any task row that will be presented to a client. */
export const taskSelectIncludes = TASK_INCLUDE;

/** Projects the user may read inside an organization. */
export async function visibleProjectIds(user: AuthUser, orgId: string): Promise<string[] | 'all'> {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');
    if (membership.role === 'admin' || membership.role === 'manager') return 'all';

    const projects = await prisma.project.findMany({
        where: {
            orgId,
            OR: [{ visibility: 'organization' }, { members: { some: { userId: user.id } } }, { createdById: user.id }],
        },
        select: { id: true },
    });
    return projects.map((p) => p.id);
}

/**
 * Ordinals inside a project (`#42`), keyed by task id.
 *
 * A real identifier column would mean a migration plus a counter per project; this is the
 * cheap version of the same UX: one id-only read over the projects already on screen,
 * ordered by creation. It is a label, not a key — deleting a task renumbers the tail — so
 * nothing may depend on it staying stable, and URLs keep using ids.
 */
export async function taskNumbers(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await prisma.task.findMany({
        where: { projectId: { in: projectIds }, deletedAt: null },
        select: { id: true, projectId: true },
        orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const seen = new Map<string, number>();
    const out = new Map<string, number>();
    for (const row of rows) {
        const next = (seen.get(row.projectId) ?? 0) + 1;
        seen.set(row.projectId, next);
        out.set(row.id, next);
    }
    return out;
}

/** Millisecond comparison that treats `null` and `undefined` as the same "no date". */
export const timeOf = (value?: Date | null): number | null => (value ? value.getTime() : null);

/**
 * Logged minutes per task, stopped timers only.
 *
 * Cards show "logged vs estimate", so the board and list need the figure for every visible card at
 * once: one `groupBy` over the ids on screen, never one query per card. Running timers are excluded
 * because an open sitting has no duration yet — the drawer shows it separately.
 */
export async function loggedMins(taskIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (taskIds.length === 0) return out;
    const rows = await prisma.timeLog.groupBy({
        by: ['taskId'],
        where: { taskId: { in: taskIds }, stoppedAt: { not: null } },
        _sum: { durationMins: true },
    });
    for (const row of rows) out.set(row.taskId, row._sum.durationMins ?? 0);
    return out;
}

/**
 * Epic rollup for a batch of parent tasks: how many direct children are done.
 *
 * One `groupBy` over `[parentTaskId, status]` instead of a query per epic — the board
 * and list views call this with every visible id at once. Only ids present in the
 * result have children; callers fall back to no bar otherwise.
 */
export async function epicProgress(parentIds: string[]): Promise<Map<string, { done: number; total: number }>> {
    const out = new Map<string, { done: number; total: number }>();
    if (parentIds.length === 0) return out;
    const rows = await prisma.task.groupBy({
        by: ['parentTaskId', 'status'],
        where: { parentTaskId: { in: parentIds }, deletedAt: null },
        _count: { _all: true },
    });
    for (const row of rows) {
        const parentId = row.parentTaskId;
        if (!parentId) continue;
        const current = out.get(parentId) ?? { done: 0, total: 0 };
        current.total += row._count._all;
        if (DONE_STATUSES.includes(row.status as TaskStatus)) current.done += row._count._all;
        out.set(parentId, current);
    }
    return out;
}

/** Section for a status: explicit (validated) or the first matching column of the project. */
export async function resolveSectionForStatus(
    projectId: string,
    status: TaskStatus,
    sectionId?: string | null,
): Promise<string | null> {
    if (sectionId) {
        const section = await prisma.section.findFirst({ where: { id: sectionId, projectId } });
        if (!section) throw new BadRequest('Section does not belong to this project');
        return section.id;
    }
    const section = await prisma.section.findFirst({
        where: { projectId, isDone: DONE_STATUSES.includes(status) },
        orderBy: { position: 'asc' },
    });
    return section?.id ?? null;
}

/** All descendants of a task, breadth-first — used for cycle detection in the subtask tree. */
export async function collectDescendants(taskId: string): Promise<string[]> {
    const out: string[] = [];
    let frontier = [taskId];
    while (frontier.length > 0) {
        const children = await prisma.task.findMany({ where: { parentTaskId: { in: frontier } }, select: { id: true } });
        frontier = children.map((c) => c.id).filter((id) => !out.includes(id));
        out.push(...frontier);
    }
    return out;
}

/** In-app + email announcement shared by creation-time and later assignments. */
export async function announceAssignment(args: {
    orgId: string;
    project: { id: string; name: string };
    task: { id: string; title: string; dueDate: Date | null };
    assigneeIds: string[];
    actor: AuthUser;
    isNew: boolean;
}) {
    const due = args.task.dueDate ? args.task.dueDate.toDateString() : null;
    await notify({
        orgId: args.orgId,
        userIds: args.assigneeIds.filter((id) => id !== args.actor.id),
        type: 'task.assigned',
        title: args.isNew ? `New task: ${args.task.title}` : `You were added to ${args.task.title}`,
        body: `${args.actor.firstName} ${args.actor.lastName} assigned you in ${args.project.name}${due ? ` · due ${due}` : ''}`,
        link: `/projects/${args.project.id}/tasks/${args.task.id}`,
        emailPreference: 'emailOnAssign',
        email: ({ email, firstName }) =>
            mails.taskAssigned({
                to: email,
                assigneeName: firstName,
                actorName: `${args.actor.firstName} ${args.actor.lastName}`,
                taskTitle: args.task.title,
                projectName: args.project.name,
                due,
                link: `${env.WEB_URL}/projects/${args.project.id}/tasks/${args.task.id}`,
            }),
    });
}
