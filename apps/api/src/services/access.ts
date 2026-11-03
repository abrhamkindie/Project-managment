import type { Project, Task } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { Forbidden, NotFound } from '../domain/errors.js';
import { can, type Access } from '../domain/permissions.js';
import type { AuthUser } from '../types/express.js';

/**
 * Loads the permission snapshot used by `domain/permissions.ts`.
 *
 * Every task/project/comment/attachment route funnels through one of these helpers, so
 * authorization is never forgotten in a single handler. Each helper returns the loaded
 * record together with its `Access`, so routes need only one round trip.
 */

export interface ProjectContext {
    project: Project;
    access: Access;
}

export async function loadProjectAccess(user: AuthUser, projectId: string): Promise<ProjectContext> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFound('Project not found');

    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: project.orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');

    const projectMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
        select: { role: true },
    });

    const access: Access = {
        userId: user.id,
        orgRole: membership.role as Access['orgRole'],
        projectRole: (projectMember?.role as Access['projectRole']) ?? null,
        projectVisibility: project.visibility as Access['projectVisibility'],
        projectStatus: project.status as Access['projectStatus'],
        projectCreatedById: project.createdById,
    };

    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this project');
    return { project, access };
}

export interface TaskContext {
    task: Task;
    project: Project;
    assigneeIds: string[];
    access: Access;
}

export async function loadTaskAccess(user: AuthUser, taskId: string): Promise<TaskContext> {
    const task = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null },
        include: { project: true, assignees: { select: { userId: true } } },
    });
    if (!task) throw new NotFound('Task not found');

    const assigneeIds = task.assignees.map((a) => a.userId);
    const { access: base, project } = await loadProjectAccess(user, task.projectId);
    const access: Access = {
        ...base,
        isTaskAssignee: assigneeIds.includes(user.id),
        taskCreatedById: task.createdById,
    };
    // Reading a task follows project visibility; the extra fields gate writes.
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this task');
    return { task, project, assigneeIds, access };
}

/** Only organization members may be assigned to tasks in that organization. */
export async function assertAssignable(orgId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const unique = [...new Set(userIds)];
    const members = await prisma.organizationMember.findMany({
        where: { orgId, userId: { in: unique } },
        select: { userId: true },
    });
    const known = new Set(members.map((m) => m.userId));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length > 0) {
        throw new Forbidden('Only organization members can be assigned to tasks', { userIds: missing });
    }
    return unique;
}

/** People who should hear about activity on a task: creator, assignees, commenters. */
export async function taskWatchers(taskId: string, excludeUserId?: string): Promise<string[]> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { createdById: true, assignees: { select: { userId: true } }, comments: { select: { authorId: true } } },
    });
    if (!task) return [];
    const ids = new Set<string>([
        task.createdById,
        ...task.assignees.map((a) => a.userId),
        ...task.comments.map((c) => c.authorId),
    ]);
    if (excludeUserId) ids.delete(excludeUserId);
    return [...ids];
}
