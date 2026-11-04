import type { Prisma } from '@prisma/client';
import { isOverdue } from '../domain/permissions.js';

/**
 * Response presenters. Keeping them in one place guarantees a stable public contract:
 * the database shape (snake_case relations, JSON strings, `Date`s) never leaks to clients.
 */

const date = (value?: Date | null) => (value ? value.toISOString() : null);

export interface ActorDto {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

export function presentUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
    timezone?: string;
    createdAt?: Date;
}): ActorDto & { avatarUrl: string | null; timezone: string | undefined; createdAt: string | null } {
    return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        timezone: user.timezone,
        createdAt: date(user.createdAt ?? null),
    };
}

const lightUser = (u: { id: string; email: string; firstName: string; lastName: string; avatarUrl?: string | null }) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl ?? null,
});

export const TASK_INCLUDE = {
    assignees: { include: { user: true }, orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
    labels: { include: { label: true } },
    attachments: true,
    _count: { select: { children: true, comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export function presentTask(task: TaskWithRelations, now = new Date(), number?: number | null) {
    return {
        id: task.id,
        projectId: task.projectId,
        sectionId: task.sectionId,
        parentTaskId: task.parentTaskId,
        /**
         * Ordinal inside the project (`#42`), for humans only: computed from creation order
         * rather than stored, so it needs no migration and is not a durable identifier.
         * Absent where computing it would cost more than the label is worth.
         */
        number: number ?? null,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: date(task.dueDate),
        startDate: date(task.startDate),
        estimateMins: task.estimateMins,
        isMilestone: task.isMilestone,
        position: task.position,
        isOverdue: isOverdue(task.dueDate, task.status, now),
        completedAt: date(task.completedAt),
        createdAt: date(task.createdAt)!,
        updatedAt: date(task.updatedAt)!,
        createdById: task.createdById,
        assignees: task.assignees.map((a) => ({ ...lightUser(a.user), isPrimary: a.isPrimary })),
        assigneeIds: task.assignees.map((a) => a.user.id),
        labels: task.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
        attachments: task.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            createdAt: date(a.createdAt)!,
            url: `/api/tasks/${task.id}/attachments/${a.id}/download`,
        })),
        subtaskCount: task._count.children,
        commentCount: task._count.comments,
    };
}

export function presentProject(
    project: Prisma.ProjectGetPayload<{ include: { members: { include: { user: true } }; _count: { select: { tasks: true } } } }>,
) {
    return {
        id: project.id,
        orgId: project.orgId,
        teamId: project.teamId,
        name: project.name,
        description: project.description,
        color: project.color,
        visibility: project.visibility,
        status: project.status,
        startDate: date(project.startDate),
        dueDate: date(project.dueDate),
        createdAt: date(project.createdAt)!,
        updatedAt: date(project.updatedAt)!,
        createdById: project.createdById,
        members: project.members.map((m) => ({ ...lightUser(m.user), role: m.role, joinedAt: date(m.createdAt) })),
        memberIds: project.members.map((m) => m.userId),
        taskCount: project._count.tasks,
    };
}

export function presentSection(section: { id: string; projectId: string; name: string; position: number; isDone: boolean }) {
    return {
        id: section.id,
        projectId: section.projectId,
        name: section.name,
        position: section.position,
        isDone: section.isDone,
    };
}

export function presentComment(comment: {
    id: string;
    taskId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; email: string; firstName: string; lastName: string; avatarUrl?: string | null };
}) {
    return {
        id: comment.id,
        taskId: comment.taskId,
        body: comment.body,
        author: lightUser(comment.author),
        createdAt: date(comment.createdAt)!,
        updatedAt: date(comment.updatedAt)!,
    };
}

export function presentActivity(activity: {
    id: string;
    type: string;
    meta: string;
    projectId: string | null;
    taskId: string | null;
    createdAt: Date;
    actor: { id: string; email: string; firstName: string; lastName: string; avatarUrl?: string | null };
}) {
    let meta: Record<string, unknown>;
    try {
        meta = JSON.parse(activity.meta) as Record<string, unknown>;
    } catch {
        // A malformed audit row must never break the feed.
        meta = {};
    }
    return {
        id: activity.id,
        type: activity.type,
        meta,
        projectId: activity.projectId,
        taskId: activity.taskId,
        actor: lightUser(activity.actor),
        createdAt: date(activity.createdAt)!,
    };
}

export function presentNotification(notification: {
    id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
    readAt: Date | null;
    createdAt: Date;
}) {
    return {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        link: notification.link,
        readAt: date(notification.readAt),
        createdAt: date(notification.createdAt)!,
    };
}

export function presentOrganization(org: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    ownerId: string;
}) {
    return { id: org.id, name: org.name, slug: org.slug, ownerId: org.ownerId, createdAt: date(org.createdAt)! };
}

export function presentMember(member: {
    id: string;
    role: string;
    createdAt: Date;
    user: { id: string; email: string; firstName: string; lastName: string; avatarUrl?: string | null; isActive: boolean };
}) {
    return {
        id: member.id,
        role: member.role,
        joinedAt: date(member.createdAt)!,
        user: { ...lightUser(member.user), isActive: member.user.isActive },
    };
}
