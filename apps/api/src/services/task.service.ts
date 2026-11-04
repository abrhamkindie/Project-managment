import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { DONE_STATUSES, OPEN_STATUSES, isDoneStatus, priorityWeight, type TaskStatus } from '../domain/enums.js';
import { can } from '../domain/permissions.js';
import { rankBetween } from '../lib/crypto.js';
import { paginate } from '../lib/http.js';
import { daysAgoStart } from '../lib/time.js';
import type { AuthUser } from '../types/express.js';
import { assertAssignable, loadProjectAccess, loadTaskAccess, taskWatchers } from './access.js';
import { notify, recordActivity } from './activity.js';
import { mails } from './mailer.js';
import { presentActivity, presentComment, presentTask, TASK_INCLUDE, type TaskWithRelations } from './presenters.js';
import { emitToProject } from '../realtime/bus.js';
import type { AssignInput, CreateTaskInput, MoveTaskInput, TaskListQuery, UpdateTaskInput } from '../domain/schemas.js';

/**
 * Task lifecycle: creation, editing, assignment, Kanban moves, completion, deletion.
 *
 * Invariants enforced here (not in the routes):
 *  - a task always belongs to a project the actor can write to;
 *  - `completedAt` is a denormalised mirror of "status is done/canceled", kept in sync so
 *    analytics never has to recompute history;
 *  - assignees must be members of the organization;
 *  - every change writes an Activity row and notifies the people who care.
 */

const taskSelectIncludes = TASK_INCLUDE;

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

function buildWhere(query: TaskListQuery, projectIds: string[] | 'all', orgId: string): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {
        deletedAt: null,
        project: { orgId },
    };
    if (projectIds !== 'all') where.projectId = { in: projectIds };
    if (query.projectId) where.projectId = query.projectId;
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.status?.length) where.status = { in: query.status };
    if (query.priority?.length) where.priority = { in: query.priority };
    if (query.assigneeId) where.assignees = { some: { userId: query.assigneeId } };
    if (query.labelId) where.labels = { some: { labelId: query.labelId } };
    if (query.dueAfter || query.dueBefore) {
        where.dueDate = {
            ...(query.dueAfter ? { gte: query.dueAfter } : {}),
            ...(query.dueBefore ? { lte: query.dueBefore } : {}),
        };
    }
    if (query.overdue) {
        // Day-granular, matching `isOverdue`: work due today is not late yet.
        where.dueDate = { lt: daysAgoStart(0) };
        where.status = { in: OPEN_STATUSES };
    }
    if (!query.includeSubtasks) where.parentTaskId = null;
    if (query.search) {
        where.OR = [
            { title: { contains: query.search } },
            { description: { contains: query.search } },
        ];
    }
    return where;
}

const ORDERINGS: Record<TaskListQuery['orderBy'], Prisma.TaskOrderByWithRelationInput> = {
    position: { position: 'asc' },
    dueDate: { dueDate: 'asc' },
    priority: { priority: 'desc' },
    createdAt: { createdAt: 'desc' },
    updatedAt: { updatedAt: 'desc' },
};

/** `order=desc` only flips the primary sort key; ties keep a stable secondary order. */
function withDirection(order: Prisma.TaskOrderByWithRelationInput, direction: Prisma.SortOrder): Prisma.TaskOrderByWithRelationInput {
    const entry = { ...order } as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
        if (entry[key] === 'asc' || entry[key] === 'desc') entry[key] = direction;
    }
    return entry as Prisma.TaskOrderByWithRelationInput;
}

export async function listTasks(user: AuthUser, orgId: string, query: TaskListQuery) {
    const projectIds = query.projectId ? (await loadProjectAccess(user, query.projectId)).project.id : await visibleProjectIds(user, orgId);
    const where = buildWhere(query, typeof projectIds === 'string' ? 'all' : projectIds, orgId);

    const direction: Prisma.SortOrder = query.order === 'desc' ? 'desc' : 'asc';
    // Priority is a string column, so ordering it by weight cannot be pushed down portably;
    // those rows are re-sorted in memory (see below). Everything else hits an index.
    const usePrioritySort = query.orderBy === 'priority';
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = usePrioritySort
        ? [{ createdAt: 'desc' }]
        : [withDirection(ORDERINGS[query.orderBy], direction), { createdAt: 'asc' }];
    if (query.orderBy === 'dueDate') {
        // Real NULLS LAST on PostgreSQL; SQLite ignores the modifier.
        orderBy[0] = { dueDate: { sort: direction, nulls: 'last' } } as unknown as Prisma.TaskOrderByWithRelationInput;
    }

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
        prisma.task.findMany({ where, include: taskSelectIncludes, orderBy, skip, take: query.pageSize }),
        prisma.task.count({ where }),
    ]);

    const items = rows.map((row) => presentTask(row));
    if (usePrioritySort) {
        const factor = direction === 'desc' ? -1 : 1;
        // NB: weights are applied to the current page; a fully correct global priority sort
        // would need a database-side CASE expression, which is not portable to SQLite.
        items.sort((a, b) => factor * (priorityWeight(a.priority) - priorityWeight(b.priority)));
    }
    return paginate(items, total, query.page, query.pageSize);
}

/** Board view: sections with their cards, in one query. */
export async function getBoard(user: AuthUser, projectId: string) {
    const { project } = await loadProjectAccess(user, projectId);
    const [sections, tasks] = await Promise.all([
        prisma.section.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
        prisma.task.findMany({
            where: { projectId, deletedAt: null },
            include: taskSelectIncludes,
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
    ]);
    const bySection = new Map<string, ReturnType<typeof presentTask>[]>();
    const orphans: ReturnType<typeof presentTask>[] = [];
    for (const task of tasks.map((t) => presentTask(t))) {
        if (!task.sectionId) orphans.push(task);
        else bySection.set(task.sectionId, [...(bySection.get(task.sectionId) ?? []), task]);
    }
    return {
        project: { id: project.id, name: project.name, color: project.color, visibility: project.visibility, status: project.status },
        sections: sections.map((section) => ({
            id: section.id,
            name: section.name,
            position: section.position,
            isDone: section.isDone,
            tasks: bySection.get(section.id) ?? [],
        })),
        unassigned: orphans,
    };
}

/**
 * Chronological feed for the task drawer: activity rows and comments interleaved,
 * oldest first (the UI pins the composer to the bottom).
 */
export async function taskTimeline(taskId: string) {
    const [activities, commentRows] = await Promise.all([
        prisma.activity.findMany({ where: { taskId }, include: { actor: true }, orderBy: { createdAt: 'asc' }, take: 200 }),
        prisma.comment.findMany({ where: { taskId, deletedAt: null }, include: { author: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    return [
        ...activities.map((a) => ({ kind: 'activity' as const, ...presentActivity(a) })),
        ...commentRows.map((c) => ({ kind: 'comment' as const, type: 'comment.added', ...presentComment(c) })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getTask(user: AuthUser, taskId: string) {
    const { project } = await loadTaskAccess(user, taskId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    const [timeline, subtasks, parent] = await Promise.all([
        taskTimeline(taskId),
        prisma.task.findMany({
            where: { parentTaskId: taskId, deletedAt: null },
            include: taskSelectIncludes,
            orderBy: { position: 'asc' },
        }),
        task.parentTaskId
            ? prisma.task.findUnique({ where: { id: task.parentTaskId }, include: taskSelectIncludes })
            : null,
    ]);
    // A task detail is a task card plus its context, so mutation responses (which return
    // the card) merge cleanly into it on the client.
    return {
        ...presentTask(task),
        project: {
            id: project.id,
            orgId: project.orgId,
            name: project.name,
            color: project.color,
            visibility: project.visibility,
        },
        subtasks: subtasks.map((t) => presentTask(t)),
        parent: parent ? presentTask(parent) : null,
        timeline,
    };
}

async function resolveSectionForStatus(
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

export async function createTask(user: AuthUser, orgId: string, input: CreateTaskInput) {
    const { project, access } = await loadProjectAccess(user, input.projectId);
    if (project.orgId !== orgId) throw new BadRequest('Project does not belong to this organization');
    if (!can.createTask(access)) throw new Forbidden('You cannot create tasks in this project');

    const assigneeIds = await assertAssignable(orgId, input.assigneeIds ?? []);
    const sectionId = await resolveSectionForStatus(project.id, input.status, input.sectionId);

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

async function announceAssignment(args: {
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

/** Millisecond comparison that treats `null` and `undefined` as the same "no date". */
const timeOf = (value?: Date | null): number | null => (value ? value.getTime() : null);

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

async function collectDescendants(taskId: string): Promise<string[]> {
    const out: string[] = [];
    let frontier = [taskId];
    while (frontier.length > 0) {
        const children = await prisma.task.findMany({ where: { parentTaskId: { in: frontier } }, select: { id: true } });
        frontier = children.map((c) => c.id).filter((id) => !out.includes(id));
        out.push(...frontier);
    }
    return out;
}

export async function setAssignees(user: AuthUser, taskId: string, input: AssignInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot change assignment on this task');
    const requested = await assertAssignable(project.orgId, input.userIds);

    const current = await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } });
    const currentIds = current.map((c) => c.userId);

    let nextIds: string[];
    if (input.mode === 'replace') nextIds = requested;
    else if (input.mode === 'add') nextIds = [...new Set([...currentIds, ...requested])];
    else nextIds = currentIds.filter((id) => !requested.includes(id));

    const toAdd = nextIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !nextIds.includes(id));

    await prisma.$transaction([
        ...(toRemove.length ? [prisma.taskAssignee.deleteMany({ where: { taskId, userId: { in: toRemove } } })] : []),
        ...toAdd.map((userId) =>
            prisma.taskAssignee.create({ data: { taskId, userId, isPrimary: toAdd.length === 1 && currentIds.length === 0 } }),
        ),
    ]);

    if (toAdd.length) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: 'task.assigned',
            meta: { userIds: toAdd, title: task.title },
        });
        await announceAssignment({ orgId: project.orgId, project, task, assigneeIds: toAdd, actor: user, isNew: false });
    }
    if (toRemove.length) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: 'task.unassigned',
            meta: { userIds: toRemove, title: task.title },
        });
    }

    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    emitToProject(project.id, 'task:updated', presentTask(fresh));
    return presentTask(fresh);
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

export async function setLabels(user: AuthUser, taskId: string, labelIds: string[]) {
    const { project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    const labels = labelIds.length
        ? await prisma.label.findMany({ where: { id: { in: labelIds }, OR: [{ orgId: project.orgId }, { project: { orgId: project.orgId } }] } })
        : [];
    if (labels.length !== new Set(labelIds).size) throw new BadRequest('One or more labels are not available in this organization');

    await prisma.$transaction([
        prisma.taskLabel.deleteMany({ where: { taskId } }),
        prisma.taskLabel.createMany({ data: labels.map((label) => ({ taskId, labelId: label.id })) }),
    ]);
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'label.attached',
        meta: { labelIds: labels.map((l) => l.id) },
    });
    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    return presentTask(fresh);
}

/**
 * "My tasks" grouping used by the personal dashboard.
 *
 * The assignee query is one hit; project metadata used to be a `findUniqueOrThrow` per distinct
 * project inside the loop (an N+1 that scaled with the number of projects a person touches).
 * Now we collect the distinct ids first and fetch them in one batch.
 */
export async function myTasks(user: AuthUser, orgId: string) {
    const rows = await prisma.taskAssignee.findMany({
        where: { userId: user.id, task: { deletedAt: null, status: { in: OPEN_STATUSES }, project: { orgId, status: 'active' } } },
        include: { task: { include: taskSelectIncludes } },
        orderBy: { createdAt: 'desc' },
    });

    const distinctProjectIds = [...new Set(rows.map((row) => row.task.projectId))];
    const projectRows = distinctProjectIds.length
        ? await prisma.project.findMany({
            where: { id: { in: distinctProjectIds } },
            select: { id: true, name: true, color: true },
        })
        : [];
    const projectById = new Map(projectRows.map((p) => [p.id, p]));

    const groups = new Map<string, { project: { id: string; name: string; color: string }; tasks: ReturnType<typeof presentTask>[] }>();
    for (const row of rows) {
        const presentable = presentTask(row.task as TaskWithRelations);
        const key = presentable.projectId;
        const existing = groups.get(key);
        if (existing) existing.tasks.push(presentable);
        else {
            const project = projectById.get(key);
            if (!project) continue; // Should never happen (assignee rows carry an active project), but skip safely rather than throwing.
            groups.set(key, { project, tasks: [presentable] });
        }
    }
    return [...groups.values()];
}
