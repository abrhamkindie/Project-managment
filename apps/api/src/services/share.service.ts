import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { BadRequest, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import { hashSecret, randomToken } from '../lib/crypto.js';
import { loadProjectAccess, loadTaskAccess } from './access.js';
import { priorityWeight } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import type { CreateShareLinkInput } from '../domain/schemas.js';

/**
 * Read-only public share links.
 *
 * A share is a hashed, expiring token that exposes one project board or one task to people outside
 * the organization — clients, contractors, a manager's phone. Because the token is the only
 * credential, three rules hold it in check: only the digest is stored (a database leak is not a
 * list of live links), every link expires by default, and the projection below is written by hand
 * instead of reusing the member payloads, so a share can never grow a field somebody did not decide
 * to publish (e-mail addresses, activity history, attachments).
 */

const DAY_MS = 86_400_000;
/** Upper bound for a board snapshot; a share is for looking, not for exporting the database. */
const SNAPSHOT_TASK_LIMIT = 200;

export const shareUrl = (token: string) => `${env.WEB_URL}/share/${token}`;

export async function createShare(user: AuthUser, input: CreateShareLinkInput) {
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);

    if (input.taskId) {
        // `loadTaskAccess` already refused a task the caller cannot read, so sharing needs no
        // second rule: you can only publish what you can see.
        const { task, project } = await loadTaskAccess(user, input.taskId);
        const row = await prisma.shareLink.create({
            data: { orgId: project.orgId, taskId: task.id, tokenHash: hashSecret(token), scope: 'read', expiresAt, createdBy: user.id },
        });
        return present(row, token, { taskId: row.taskId, projectId: null });
    }

    if (!input.projectId) throw new BadRequest('Nothing to share');
    const { project, access } = await loadProjectAccess(user, input.projectId);
    if (!can.viewProject(access)) throw new BadRequest('You cannot share this project');
    const row = await prisma.shareLink.create({
        data: { orgId: project.orgId, projectId: project.id, tokenHash: hashSecret(token), scope: 'read', expiresAt, createdBy: user.id },
    });
    return present(row, token, { taskId: null, projectId: row.projectId });
}

function present(
    row: { id: string; scope: string; expiresAt: Date; createdAt: Date; orgId: string },
    token: string,
    target: { taskId: string | null; projectId: string | null },
) {
    return {
        id: row.id,
        orgId: row.orgId,
        scope: row.scope,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        url: shareUrl(token),
        /** Shown once, like an API token: the digest cannot be reversed. */
        token,
        ...target,
    };
}

export async function listShares(user: AuthUser, orgId: string) {
    const rows = await prisma.shareLink.findMany({
        where: { orgId, createdBy: user.id },
        orderBy: { createdAt: 'desc' },
        include: {
            project: { select: { id: true, name: true } },
            task: { select: { id: true, title: true } },
        },
    });
    const now = Date.now();
    return rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        projectId: row.projectId,
        taskId: row.taskId,
        projectName: row.project?.name ?? null,
        taskTitle: row.task?.title ?? null,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        /** Same three-state answer as API tokens, so one badge component covers both lists. */
        status: row.revokedAt ? ('revoked' as const) : row.expiresAt.getTime() < now ? ('expired' as const) : ('active' as const),
    }));
}

/** Anyone can revoke their own link at any time; that is the whole point of "revocable". */
export async function revokeShare(user: AuthUser, id: string) {
    const row = await prisma.shareLink.findFirst({ where: { id, createdBy: user.id }, select: { id: true } });
    if (!row) throw new NotFound('No such share');
    await prisma.shareLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return { id: row.id, revoked: true };
}

async function resolve(token: string) {
    const row = await prisma.shareLink.findUnique({
        where: { tokenHash: hashSecret(token) },
        include: {
            project: { select: { id: true, name: true, color: true, status: true, description: true, orgId: true } },
            task: {
                select: {
                    id: true,
                    projectId: true,
                    title: true,
                    description: true,
                    status: true,
                    priority: true,
                    dueDate: true,
                    startDate: true,
                    estimateMins: true,
                    isMilestone: true,
                    kind: true,
                    completedAt: true,
                    project: { select: { id: true, name: true, color: true, orgId: true } },
                    // Display names only: `lightUser` carries e-mail addresses, which a public
                    // page must never publish.
                    assignees: { select: { isPrimary: true, user: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } },
                    labels: { select: { label: { select: { id: true, name: true, color: true } } } },
                    _count: { select: { children: true } },
                },
            },
        },
    });
    if (!row || row.revokedAt) throw new NotFound('This link is no longer available');
    if (row.expiresAt.getTime() < Date.now()) throw new NotFound('This link has expired');
    return row;
}

/**
 * Public snapshot for a token. Exactly what a stranger may see, written out field by field:
 * names of people working on it appear as display names only, and no contact details, activity,
 * comments or files are reachable through a share.
 */
export async function snapshot(token: string) {
    const link = await resolve(token);
    if (link.task) {
        const task = link.task;
        return {
            scope: link.scope,
            kind: 'task' as const,
            project: task.project,
            task: {
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                dueDate: task.dueDate,
                startDate: task.startDate,
                estimateMins: task.estimateMins,
                isMilestone: task.isMilestone,
                kind: task.kind,
                completedAt: task.completedAt,
                assignees: task.assignees.map((row) => ({ name: `${row.user.firstName} ${row.user.lastName}`.trim(), primary: row.isPrimary })),
                labels: task.labels.map((row) => ({ id: row.label.id, name: row.label.name, color: row.label.color })),
                subtaskCount: task._count.children,
            },
        };
    }

    if (!link.project) throw new NotFound('This link points at nothing');
    const project = link.project;
    const [sections, tasks] = await Promise.all([
        prisma.section.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } }),
        prisma.task.findMany({
            where: { projectId: project.id, deletedAt: null },
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
            take: SNAPSHOT_TASK_LIMIT,
            select: {
                id: true,
                title: true,
                status: true,
                sectionId: true,
                priority: true,
                dueDate: true,
                startDate: true,
                isMilestone: true,
                kind: true,
                parentTaskId: true,
                assignees: { select: { user: { select: { firstName: true, lastName: true } } } },
                labels: { select: { label: { select: { id: true, name: true, color: true } } } },
            },
        }),
    ]);

    return {
        scope: link.scope,
        kind: 'project' as const,
        project: { ...project, taskCount: tasks.length, truncated: tasks.length >= SNAPSHOT_TASK_LIMIT },
        sections: sections.map((section) => ({ id: section.id, name: section.name, isDone: section.isDone, position: section.position })),
        tasks: tasks
            .map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                sectionId: task.sectionId,
                priority: task.priority,
                dueDate: task.dueDate,
                startDate: task.startDate,
                isMilestone: task.isMilestone,
                kind: task.kind,
                isSubtask: Boolean(task.parentTaskId),
                assignees: task.assignees.map((row) => `${row.user.firstName} ${row.user.lastName}`.trim()),
                labels: task.labels.map((row) => ({ id: row.label.id, name: row.label.name, color: row.label.color })),
            }))
            // The board groups by section, but the order within a column should still read like
            // the product does: riskiest work first.
            .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority)),
    };
}
