import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { OPEN_STATUSES, priorityWeight } from '../domain/enums.js';
import { paginate } from '../lib/http.js';
import { contains } from '../lib/search.js';
import { daysAgoStart } from '../lib/time.js';
import type { AuthUser } from '../types/express.js';
import { loadProjectAccess, loadTaskAccess } from './access.js';
import { presentActivity, presentComment, presentTask, type TaskWithRelations } from './presenters.js';
import { dependencyGraph } from './dependency.service.js';
import { definitionsById, fieldFilterClauses } from './custom-field.service.js';
import type { TaskListQuery } from '../domain/schemas.js';
import { taskNumbers, taskSelectIncludes, epicProgress, loggedMins, visibleProjectIds } from './task.internal.js';

/**
 * Task reads: list queries, the Kanban board, the drawer timeline, single task detail
 * and the "My tasks" grouping. Mutations live in `task.mutation.ts`, assignment/labels
 * in `task.members.ts`; `task.service.ts` re-exports all three as the public surface.
 */

function buildWhere(query: TaskListQuery, projectIds: string[] | 'all', orgId: string, fieldClauses: Prisma.TaskWhereInput[] = []): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {
        deletedAt: null,
        project: { orgId },
    };
    if (projectIds !== 'all') where.projectId = { in: projectIds };
    if (query.projectId) where.projectId = query.projectId;
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.kind) where.kind = query.kind;
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
        const term = contains(query.search);
        where.OR = [{ title: term }, { description: term }];
    }
    // Custom-field filters (Phase 6) AND together, one clause per field: a `(taskId, fieldId)` value
    // row is unique, so no single row could ever satisfy two different fields.
    if (fieldClauses.length) where.AND = fieldClauses;
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
    // Resolve the field filters first: an id the organization does not have is a client bug and must
    // answer 400 here rather than as a quietly empty result set two queries later.
    const fieldClauses = query.fieldFilters?.length ? fieldFilterClauses(query.fieldFilters, await definitionsById(orgId)) : [];
    const where = buildWhere(query, typeof projectIds === 'string' ? 'all' : projectIds, orgId, fieldClauses);

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

    const numbers = await taskNumbers([...new Set(rows.map((row) => row.projectId))]);
    const ids = rows.map((row) => row.id);
    const [progress, time] = await Promise.all([epicProgress(rows.filter((row) => row.kind === 'epic').map((row) => row.id)), loggedMins(ids)]);
    const items = rows.map((row) =>
        presentTask(
            row,
            new Date(),
            numbers.get(row.id) ?? null,
            row.kind === 'epic' ? progress.get(row.id) ?? null : null,
            time.get(row.id) ?? 0,
        ),
    );
    if (usePrioritySort) {
        const factor = direction === 'desc' ? -1 : 1;
        // NB: weights are applied to the current page; a fully correct global priority sort
        // would need a database-side CASE expression, which is not portable to SQLite.
        items.sort((a, b) => factor * (priorityWeight(a.priority) - priorityWeight(b.priority)));
    }
    return paginate(items, total, query.page, query.pageSize);
}

/** Board view: sections with their cards, in one query. */
export async function getBoard(user: AuthUser, projectId: string, limit = env.BOARD_SECTION_TASK_LIMIT) {
    const { project } = await loadProjectAccess(user, projectId);
    const sections = await prisma.section.findMany({ where: { projectId }, orderBy: { position: 'asc' } });

    const boardOrder = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];
    // Each column is read separately with its own cap instead of loading every card a
    // project has ever had: one column of a 10k-task project stays one indexed query for
    // `limit + 1` rows. The extra row is the "there is more" signal, never displayed.
    const [columns, unassignedRows, totals] = await Promise.all([
        Promise.all(
            sections.map((section) =>
                prisma.task.findMany({
                    where: { projectId, sectionId: section.id, deletedAt: null },
                    include: taskSelectIncludes,
                    orderBy: boardOrder,
                    take: limit + 1,
                }),
            ),
        ),
        prisma.task.findMany({ where: { projectId, sectionId: null, deletedAt: null }, include: taskSelectIncludes, orderBy: boardOrder, take: limit + 1 }),
        prisma.task.groupBy({ by: ['sectionId'], where: { projectId, deletedAt: null }, _count: { _all: true } }),
    ]);
    const totalBySection = new Map(totals.map((row) => [row.sectionId, row._count._all]));
    const numbers = await taskNumbers([project.id]);
    const flatRows = [...columns.flat(), ...unassignedRows];
    // One rollup for every epic card, one for every card's logged time.
    const [progress, time] = await Promise.all([
        epicProgress(flatRows.filter((row) => row.kind === 'epic').map((row) => row.id)),
        loggedMins(flatRows.map((row) => row.id)),
    ]);
    const present = (row: (typeof unassignedRows)[number]) =>
        presentTask(
            row,
            new Date(),
            numbers.get(row.id) ?? null,
            row.kind === 'epic' ? progress.get(row.id) ?? null : null,
            time.get(row.id) ?? 0,
        );

    return {
        project: { id: project.id, name: project.name, color: project.color, visibility: project.visibility, status: project.status },
        /** Cards kept per column; ask `/organizations/:orgId/tasks?sectionId=` for the rest. */
        limit,
        sections: sections.map((section, index) => {
            const rows = columns[index];
            return {
                id: section.id,
                name: section.name,
                position: section.position,
                isDone: section.isDone,
                total: totalBySection.get(section.id) ?? rows.length,
                truncated: rows.length > limit,
                tasks: rows.slice(0, limit).map(present),
            };
        }),
        unassigned: unassignedRows.slice(0, limit).map(present),
    };
}

/**
 * Chronological feed for the task drawer: activity rows and comments interleaved,
 * oldest first (the UI pins the composer to the bottom).
 *
 * Bounded on purpose — an old task can carry thousands of rows, and a drawer that loaded
 * all of them would be a memory leak with a scroll bar. The newest `limit` of each stream
 * is returned along with how much older history exists, so the UI can say "show more".
 */
export async function taskTimeline(taskId: string, limit = env.TIMELINE_ITEM_LIMIT) {
    const [activities, commentRows, activityTotal, commentTotal] = await Promise.all([
        prisma.activity.findMany({ where: { taskId }, include: { actor: true }, orderBy: { createdAt: 'desc' }, take: limit }),
        prisma.comment.findMany({ where: { taskId, deletedAt: null }, include: { author: true }, orderBy: { createdAt: 'desc' }, take: limit }),
        prisma.activity.count({ where: { taskId } }),
        prisma.comment.count({ where: { taskId, deletedAt: null } }),
    ]);
    // Fetched newest-first for the cap, handed back oldest-first for the feed.
    const items = [
        ...activities.reverse().map((a) => ({ kind: 'activity' as const, ...presentActivity(a) })),
        ...commentRows.reverse().map((c) => ({ kind: 'comment' as const, type: 'comment.added', ...presentComment(c) })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { items, hiddenOlder: Math.max(0, activityTotal - limit) + Math.max(0, commentTotal - limit), limit };
}

export async function getTask(user: AuthUser, taskId: string) {
    const { project } = await loadTaskAccess(user, taskId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    const [feed, subtasks, parent, numbers, dependencies] = await Promise.all([
        taskTimeline(taskId),
        prisma.task.findMany({
            where: { parentTaskId: taskId, deletedAt: null },
            include: taskSelectIncludes,
            orderBy: { position: 'asc' },
        }),
        task.parentTaskId
            ? prisma.task.findUnique({ where: { id: task.parentTaskId }, include: taskSelectIncludes })
            : null,
        taskNumbers([task.projectId]),
        dependencyGraph(taskId),
    ]);
    // Logged time needs the subtask ids, so it runs after the batch above.
    const time = await loggedMins([taskId, ...subtasks.map((row) => row.id)]);
    const ordinal = (row: { id: string }) => numbers.get(row.id) ?? null;
    // A task detail is a task card plus its context, so mutation responses (which return
    // the card) merge cleanly into it on the client.
    return {
        ...presentTask(task, new Date(), ordinal(task), null, time.get(taskId) ?? 0),
        project: {
            id: project.id,
            orgId: project.orgId,
            name: project.name,
            color: project.color,
            visibility: project.visibility,
        },
        subtasks: subtasks.map((t) => presentTask(t, new Date(), ordinal(t), null, time.get(t.id) ?? 0)),
        parent: parent ? presentTask(parent, new Date(), ordinal(parent)) : null,
        dependencies,
        timeline: feed.items,
        /** Rows older than the cap that were left out of `timeline`. */
        olderHidden: feed.hiddenOlder,
    };
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
    const time = await loggedMins(rows.map((row) => row.task.id));

    const groups = new Map<string, { project: { id: string; name: string; color: string }; tasks: ReturnType<typeof presentTask>[] }>();
    for (const row of rows) {
        const presentable = presentTask(row.task as TaskWithRelations, new Date(), null, null, time.get(row.task.id) ?? 0);
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
