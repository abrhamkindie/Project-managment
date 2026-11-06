import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import type { AuthUser } from '../types/express.js';
import type { CreateDependencyInput } from '../domain/schemas.js';
import { loadTaskAccess } from './access.js';
import { recordActivity } from './activity.js';
import type { TaskStatus, TaskPriority } from '../domain/enums.js';

/**
 * Task dependencies (finish-to-start only, for now).
 *
 * A row `{ taskId: A, dependsOnTaskId: B }` means "A waits on B": B is a blocker of A and
 * A is blocked by B. The graph is advisory — completing A while B is unfinished only
 * warns in the UI — so we guard the one thing that would make the model incoherent: a
 * cycle. Cross-project edges are allowed (as long as both tasks live in one org the actor
 * can edit).
 */

const shapeTask = (task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    kind: string;
    projectId: string;
    project: { id: string; name: string; color: string };
}) => ({
    id: task.id,
    title: task.title,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    kind: task.kind,
    projectId: task.projectId,
    project: task.project,
});

const DEP_TASK_INCLUDE = {
    select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        kind: true,
        projectId: true,
        deletedAt: true,
        project: { select: { id: true, name: true, color: true } },
    },
} as const;

/**
 * Can we reach `target` from `start` by walking "depends on" edges forward? If so, adding
 * `start dependsOn target`'s predecessor would close a loop. Bounded by the visited set so
 * a pre-existing cycle can never spin us forever.
 */
async function reaches(startId: string, targetId: string): Promise<boolean> {
    const visited = new Set<string>();
    let frontier = [startId];
    while (frontier.length > 0) {
        const rows = await prisma.taskDependency.findMany({
            where: { taskId: { in: frontier } },
            select: { dependsOnTaskId: true },
        });
        const next: string[] = [];
        for (const row of rows) {
            if (row.dependsOnTaskId === targetId) return true;
            if (!visited.has(row.dependsOnTaskId)) {
                visited.add(row.dependsOnTaskId);
                next.push(row.dependsOnTaskId);
            }
        }
        frontier = next;
    }
    return false;
}

/**
 * Every dependency touching a task, split into the two directions the drawer needs.
 * Access-free: `getTask` calls this after it has already gated the task, and the route
 * wrapper below re-checks access for the standalone endpoint.
 */
export async function dependencyGraph(taskId: string) {
    const [blockedByRows, blockingRows] = await Promise.all([
        prisma.taskDependency.findMany({
            where: { taskId, task: { deletedAt: null } },
            include: { dependsOnTask: DEP_TASK_INCLUDE },
        }),
        prisma.taskDependency.findMany({
            where: { dependsOnTaskId: taskId, dependsOnTask: { deletedAt: null } },
            include: { task: DEP_TASK_INCLUDE },
        }),
    ]);
    return {
        // Tasks this one waits on (their `dependsOnTask` side).
        blockedBy: blockedByRows.map((row) => ({
            dependencyId: row.id,
            type: row.type,
            createdAt: row.createdAt.toISOString(),
            task: shapeTask(row.dependsOnTask),
        })),
        // Tasks waiting on this one (their `task` side).
        blocking: blockingRows.map((row) => ({
            dependencyId: row.id,
            type: row.type,
            createdAt: row.createdAt.toISOString(),
            task: shapeTask(row.task),
        })),
    };
}

/** Route-facing wrapper: authorises the read, then returns the graph. */
export async function listDependencies(user: AuthUser, taskId: string) {
    await loadTaskAccess(user, taskId);
    return dependencyGraph(taskId);
}

/**
 * Attach `taskId` as a follower of `dependsOnTaskId` (this task cannot start until the
 * other finishes). Rejects self-links, cross-org links and anything that would form a cycle.
 */
export async function addDependency(user: AuthUser, taskId: string, input: CreateDependencyInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    if (input.dependsOnTaskId === taskId) throw new BadRequest('A task cannot depend on itself');

    const predecessor = await prisma.task.findFirst({
        where: { id: input.dependsOnTaskId, deletedAt: null },
        select: { id: true, projectId: true, project: { select: { orgId: true } } },
    });
    if (!predecessor) throw new NotFound('Depends-on task not found');
    if (predecessor.project.orgId !== project.orgId) throw new BadRequest('Tasks must belong to the same organization');

    // Direction matters: A dependsOn B is a cycle only if B already (transitively) waits on A.
    if (await reaches(input.dependsOnTaskId, taskId)) {
        throw new Conflict('That would create a circular dependency');
    }

    const existing = await prisma.taskDependency.findUnique({
        where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId: input.dependsOnTaskId } },
    });
    if (existing) throw new Conflict('These tasks already depend on each other');

    const created = await prisma.taskDependency.create({
        data: { taskId, dependsOnTaskId: input.dependsOnTaskId, type: input.type },
        include: { dependsOnTask: DEP_TASK_INCLUDE },
    });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'dependency.created',
        meta: { dependsOnTaskId: input.dependsOnTaskId, type: created.type },
    });

    return {
        dependencyId: created.id,
        type: created.type,
        createdAt: created.createdAt.toISOString(),
        task: shapeTask(created.dependsOnTask),
    };
}

export async function removeDependency(user: AuthUser, taskId: string, dependencyId: string) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    const dep = await prisma.taskDependency.findFirst({
        where: { id: dependencyId, OR: [{ taskId }, { dependsOnTaskId: taskId }] },
    });
    if (!dep) throw new NotFound('Dependency not found');

    await prisma.taskDependency.delete({ where: { id: dependencyId } });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'dependency.deleted',
        meta: { dependencyId, taskId: dep.taskId, dependsOnTaskId: dep.dependsOnTaskId },
    });
    return { id: dependencyId };
}

/**
 * Unfinished predecessors of a task — the drawer prompts on these when the user completes
 * work that is supposed to wait on them. Soft rule: reported, never enforced.
 */
export async function unsatisfiedBlockers(taskId: string) {
    const rows = await prisma.taskDependency.findMany({
        where: { taskId, task: { deletedAt: null } },
        include: { dependsOnTask: DEP_TASK_INCLUDE },
    });
    return rows
        .filter((row) => row.dependsOnTask.deletedAt === null)
        .map((row) => shapeTask(row.dependsOnTask))
        .filter((t) => t.status !== 'done' && t.status !== 'canceled');
}
