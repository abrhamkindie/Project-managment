import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError, BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { isDoneStatus, type TaskPriority, type TaskStatus } from '../domain/enums.js';
import { can } from '../domain/permissions.js';
import { rankBetween } from '../lib/crypto.js';
import type { AuthUser } from '../types/express.js';
import { assertAssignable, loadProjectAccess, loadTaskAccess, taskWatchers } from './access.js';
import { notify, recordActivity } from './activity.js';
import { presentTask } from './presenters.js';
import { emitToProject } from '../realtime/bus.js';
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from '../domain/schemas.js';
import {
    announceAssignment,
    collectDescendants,
    resolveSectionForStatus,
    taskSelectIncludes,
    timeOf,
    visibleProjectIds,
} from './task.internal.js';
// setAssignees lives in task.members.ts; the bulk loop calls it so assignments keep the
// same org-membership validation as the single-task path.
import { setAssignees } from './task.members.js';

/**
 * Task lifecycle writes: creation, editing, Kanban moves, completion, deletion, bulk.
 *
 * Invariants enforced here (not in the routes):
 *  - a task always belongs to a project the actor can write to;
 *  - `completedAt` is a denormalised mirror of "status is done/canceled", kept in sync so
 *    analytics never has to recompute history;
 *  - every change writes an Activity row and notifies the people who care.
 */

export async function createTask(user: AuthUser, orgId: string, input: CreateTaskInput) {
    const { project, access } = await loadProjectAccess(user, input.projectId);
    if (project.orgId !== orgId) throw new BadRequest('Project does not belong to this organization');
    if (!can.createTask(access)) throw new Forbidden('You cannot create tasks in this project');

    const assigneeIds = await assertAssignable(orgId, input.assigneeIds ?? []);
    const sectionId = await resolveSectionForStatus(project.id, input.status, input.sectionId);

    // A cycle is project-scoped; refuse to attach one from another project.
    if (input.cycleId) {
        const cycle = await prisma.cycle.findFirst({ where: { id: input.cycleId, projectId: project.id } });
        if (!cycle) throw new BadRequest('Cycle does not belong to this project');
    }

    if (input.parentTaskId) {
        const parent = await prisma.task.findFirst({ where: { id: input.parentTaskId, deletedAt: null } });
        if (!parent) throw new NotFound('Parent task not found');
        if (parent.projectId !== project.id) throw new BadRequest('Subtasks must live in the same project');
    }

    // New cards go to the bottom of their column.
    const last = await prisma.task.findFirst({
        where: { projectId: project.id, sectionId, deletedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
    });

    const created = await prisma.task.create({
        data: {
            projectId: project.id,
            sectionId,
            parentTaskId: input.parentTaskId ?? null,
            title: input.title,
            description: input.description ?? null,
            status: input.status,
            priority: input.priority,
            dueDate: input.dueDate ?? null,
            startDate: input.startDate ?? null,
            estimateMins: input.estimateMins ?? null,
            isMilestone: input.isMilestone,
            kind: input.kind,
            cycleId: input.cycleId ?? null,
            recurrence: input.recurrence ? JSON.stringify(input.recurrence) : null,
            position: (last?.position ?? 0) + 1000,
            createdById: user.id,
            completedAt: isDoneStatus(input.status) ? new Date() : null,
            assignees: { create: assigneeIds.map((userId) => ({ userId, isPrimary: userId === user.id })) },
            labels: input.labelIds?.length ? { create: input.labelIds.map((labelId) => ({ labelId })) } : undefined,
        },
        include: taskSelectIncludes,
    });

    await recordActivity({
        orgId,
        actorId: user.id,
        projectId: project.id,
        taskId: created.id,
        type: input.parentTaskId ? 'subtask.created' : 'task.created',
        meta: { title: created.title, status: created.status, assigneeIds },
    });

    if (assigneeIds.length > 0) {
        // Assignment gets its own row even on creation, so "who got work and when" is one query.
        await recordActivity({
            orgId,
            actorId: user.id,
            projectId: project.id,
            taskId: created.id,
            type: 'task.assigned',
            meta: { userIds: assigneeIds, title: created.title },
        });
        await announceAssignment({ orgId, project, task: created, assigneeIds, actor: user, isNew: true });
    }

    emitToProject(project.id, 'task:created', presentTask(created));
    return presentTask(created);
}

export async function updateTask(user: AuthUser, taskId: string, patch: UpdateTaskInput) {
    // Assignments are not part of `patch`: they change through setAssignees, which owns the
    // notification and activity semantics of handing work to somebody.
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changed: string[] = [];

    if (patch.title !== undefined && patch.title !== task.title) {
        data.title = patch.title;
        changed.push('title');
    }
    if (patch.description !== undefined && patch.description !== task.description) {
        data.description = patch.description;
        changed.push('description');
    }
    if (patch.priority !== undefined && patch.priority !== task.priority) {
        data.priority = patch.priority;
        changed.push('priority');
    }
    if (patch.isMilestone !== undefined && patch.isMilestone !== task.isMilestone) {
        data.isMilestone = patch.isMilestone;
        changed.push('isMilestone');
    }
    if (patch.estimateMins !== undefined && patch.estimateMins !== task.estimateMins) {
        data.estimateMins = patch.estimateMins;
        changed.push('estimateMins');
    }
    if (patch.startDate !== undefined && timeOf(patch.startDate) !== timeOf(task.startDate)) {
        data.startDate = patch.startDate;
        changed.push('startDate');
    }
    if (patch.dueDate !== undefined && timeOf(patch.dueDate) !== timeOf(task.dueDate)) {
        data.dueDate = patch.dueDate;
        changed.push('dueDate');
    }
    if (patch.parentTaskId !== undefined && patch.parentTaskId !== task.parentTaskId) {
        if (patch.parentTaskId) {
            if (patch.parentTaskId === task.id) throw new BadRequest('A task cannot be its own subtask');
            const parent = await prisma.task.findFirst({ where: { id: patch.parentTaskId, deletedAt: null } });
            if (!parent) throw new NotFound('Parent task not found');
            if (parent.projectId !== task.projectId) throw new BadRequest('Subtasks must live in the same project');
            // Refuse cycles (task -> child -> ... -> task).
            const descendants = await collectDescendants(task.id);
            if (descendants.includes(patch.parentTaskId)) throw new Conflict('That would create a circular subtask tree');
        }
        data.parentTaskId = patch.parentTaskId;
        changed.push('parentTaskId');
    }

    let statusChanged = false;
    if (patch.status !== undefined && patch.status !== task.status) {
        data.status = patch.status;
        statusChanged = true;
        changed.push('status');
        // Mirror completion time so reporting never has to reconstruct it.
        data.completedAt = isDoneStatus(patch.status) ? new Date() : null;
    }

    if (patch.sectionId !== undefined) {
        const sectionId = await resolveSectionForStatus(task.projectId, (patch.status ?? task.status) as TaskStatus, patch.sectionId);
        if (sectionId !== task.sectionId) {
            data.sectionId = sectionId;
            changed.push('sectionId');
        }
    }

    if (patch.kind !== undefined && patch.kind !== task.kind) {
        data.kind = patch.kind;
        changed.push('kind');
    }
    if (patch.cycleId !== undefined && patch.cycleId !== task.cycleId) {
        if (patch.cycleId) {
            const cycle = await prisma.cycle.findFirst({ where: { id: patch.cycleId, projectId: task.projectId } });
            if (!cycle) throw new BadRequest('Cycle does not belong to this project');
        }
        data.cycleId = patch.cycleId;
        changed.push('cycleId');
    }

    if (patch.recurrence !== undefined) {
        const next = patch.recurrence ? JSON.stringify(patch.recurrence) : null;
        if (next !== (task.recurrence ?? null)) {
            data.recurrence = next;
            changed.push('recurrence');
        }
    }

    if (changed.length === 0) return presentTask(await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes }));

    data.lastEditedById = user.id;
    const updated = await prisma.task.update({ where: { id: taskId }, data, include: taskSelectIncludes });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: statusChanged ? 'task.status_changed' : 'task.updated',
        meta: { changed, from: task.status, to: updated.status, title: updated.title },
    });

    if (statusChanged) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: isDoneStatus(updated.status) ? 'task.completed' : 'task.reopened',
            meta: { title: updated.title, status: updated.status },
        });

        // Everyone who owns or follows the task hears about it, except the actor.
        const audience = await taskWatchers(taskId, user.id);
        if (audience.length > 0) {
            await notify({
                orgId: project.orgId,
                userIds: audience,
                type: 'task.status_changed',
                title: `${updated.title} → ${updated.status.replace('_', ' ')}`,
                body: `${user.firstName} ${user.lastName} updated ${updated.title} in ${project.name}`,
                link: `/projects/${project.id}/tasks/${taskId}`,
            });
        }
    }

    emitToProject(project.id, 'task:updated', presentTask(updated));
    return presentTask(updated);
}

/** Kanban drag & drop. One row update per drag thanks to fractional ranking. */
export async function moveTask(user: AuthUser, taskId: string, input: MoveTaskInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot move this task');

    const section = await prisma.section.findFirst({ where: { id: input.sectionId, projectId: project.id } });
    if (!section) throw new BadRequest('Section does not belong to this project');

    const after = input.afterTaskId
        ? await prisma.task.findFirst({ where: { id: input.afterTaskId, sectionId: section.id }, select: { position: true } })
        : null;
    const before = input.beforeTaskId
        ? await prisma.task.findFirst({ where: { id: input.beforeTaskId, sectionId: section.id }, select: { position: true } })
        : null;
    const position = rankBetween(after?.position ?? null, before?.position ?? null);

    const data: Prisma.TaskUncheckedUpdateInput = { sectionId: section.id, position };
    let statusChanged = false;
    if (input.inheritSectionStatus && section.isDone && !isDoneStatus(task.status)) {
        data.status = 'done';
        data.completedAt = new Date();
        statusChanged = true;
    } else if (input.inheritSectionStatus && !section.isDone && isDoneStatus(task.status)) {
        data.status = 'in_progress';
        data.completedAt = null;
        statusChanged = true;
    }

    const updated = await prisma.task.update({ where: { id: taskId }, data, include: taskSelectIncludes });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'task.moved',
        meta: { section: section.name, status: updated.status, fromStatus: task.status },
    });

    if (statusChanged) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: isDoneStatus(updated.status) ? 'task.completed' : 'task.reopened',
            meta: { title: updated.title, status: updated.status },
        });
    }

    emitToProject(project.id, 'task:updated', presentTask(updated));
    return presentTask(updated);
}

export async function deleteTask(user: AuthUser, taskId: string) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.deleteTask(access)) throw new Forbidden('You cannot delete this task');
    await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'task.deleted',
        meta: { title: task.title },
    });
    emitToProject(project.id, 'task:deleted', { id: taskId, projectId: project.id });
    return { id: taskId };
}

/** Bulk completion from the board/list ("mark done" quick action). */
export async function completeTask(user: AuthUser, taskId: string) {
    return updateTask(user, taskId, { status: 'done' });
}

// -------------------------------------------------------------------- bulk actions

export interface BulkInput {
    ids: string[];
    action: 'status' | 'priority' | 'delete' | 'move' | 'assign';
    status?: TaskStatus;
    priority?: TaskPriority;
    sectionId?: string;
    inheritSectionStatus?: boolean;
    assigneeIds?: string[];
    assignMode?: 'add' | 'replace' | 'remove';
}

export interface BulkResult {
    updated: string[];
    failed: { id: string; reason: string }[];
}

/**
 * Apply one action to many tasks in a single round trip.
 *
 * This deliberately loops the single-task services instead of one bulk `updateMany`:
 * every card then goes through the same permission check, activity row, notification and
 * realtime event as if it had been edited one at a time — the alternative is a fast path
 * whose audit trail quietly differs from the slow one. Partial success is reported
 * per id rather than rolled back, which is what a checkbox bulk bar needs: one card the
 * user cannot edit must not discard the ninety they can.
 */
export async function bulkUpdate(user: AuthUser, orgId: string, input: BulkInput): Promise<BulkResult> {
    const updated: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    // The caller names the organization, so the organization has to be real for them: this both
    // rejects a stranger and stops an audit row from being filed under an org the actor left.
    await visibleProjectIds(user, orgId);

    // A batch is scoped to this organization. Without the check, somebody in two workspaces could
    // edit workspace B tasks while claiming workspace A, and the history row would land in A.
    const wanted = [...new Set(input.ids)];
    const scoped = await prisma.task.findMany({
        where: { id: { in: wanted } },
        select: { id: true, project: { select: { orgId: true } } },
    });
    const inThisOrg = new Set(scoped.filter((row) => row.project.orgId === orgId).map((row) => row.id));
    for (const id of wanted) {
        if (!inThisOrg.has(id)) failed.push({ id, reason: 'No task with that id in this organization' });
    }

    for (const id of wanted) {
        if (!inThisOrg.has(id)) continue;
        try {
            switch (input.action) {
                case 'status':
                    if (!input.status) throw new BadRequest('`status` is required');
                    await updateTask(user, id, { status: input.status });
                    break;
                case 'priority':
                    if (!input.priority) throw new BadRequest('`priority` is required');
                    await updateTask(user, id, { priority: input.priority });
                    break;
                case 'delete':
                    await deleteTask(user, id);
                    break;
                case 'move':
                    if (!input.sectionId) throw new BadRequest('`sectionId` is required');
                    await moveTask(user, id, { sectionId: input.sectionId, inheritSectionStatus: input.inheritSectionStatus ?? false });
                    break;
                case 'assign':
                    await setAssignees(user, id, { userIds: input.assigneeIds ?? [], mode: input.assignMode ?? 'add' });
                    break;
            }
            updated.push(id);
        } catch (error) {
            failed.push({ id, reason: error instanceof AppError ? error.message : 'Could not update this task' });
        }
    }

    if (updated.length > 0) {
        await recordActivity({
            orgId,
            actorId: user.id,
            type: 'task.bulk_updated',
            meta: { action: input.action, count: updated.length, failed: failed.length },
        });
    }
    return { updated, failed };
}
