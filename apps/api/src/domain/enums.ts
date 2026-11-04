import { z } from 'zod';

/**
 * String-backed enumerations.
 *
 * Prisma `enum`s are intentionally not used so the exact same schema runs on SQLite
 * (dev/test) and PostgreSQL (prod). These Zod unions are the single source of truth
 * and are enforced at every write boundary.
 */

export const ORG_ROLES = ['admin', 'manager', 'member'] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const PROJECT_ROLES = ['lead', 'member'] as const;
export const projectRoleSchema = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'canceled'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const PROJECT_VISIBILITIES = ['organization', 'private'] as const;
export const projectVisibilitySchema = z.enum(PROJECT_VISIBILITIES);
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Default Kanban columns created with every new project. */
export const DEFAULT_SECTIONS: { name: string; status: TaskStatus; isDone: boolean }[] = [
    { name: 'Backlog', status: 'todo', isDone: false },
    { name: 'In progress', status: 'in_progress', isDone: false },
    { name: 'In review', status: 'in_review', isDone: false },
    { name: 'Done', status: 'done', isDone: true },
];

/** Status a task moves to when it is dropped into a section. */
export const SECTION_STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'canceled'];

export const ACTIVITY_TYPES = [
    'task.created',
    'task.updated',
    'task.assigned',
    'task.unassigned',
    'task.status_changed',
    'task.completed',
    'task.reopened',
    'task.deleted',
    'task.moved',
    'task.bulk_updated',
    'subtask.created',
    'comment.added',
    'comment.mentioned',
    'comment.deleted',
    'attachment.added',
    'label.attached',
    'project.created',
    'project.updated',
    'project.member_added',
    'project.member_removed',
    'member.invited',
    'member.role_changed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const NOTIFICATION_TYPES = [
    'task.assigned',
    'task.due',
    'task.status_changed',
    'comment.added',
    'comment.mentioned',
    'member.invited',
    'project.member_added',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Relative weight used for sorting and workload scoring. */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
};

/** Safe lookup for values coming from the database as plain strings. */
export function priorityWeight(priority: string): number {
    return PRIORITY_WEIGHT[priority as TaskPriority] ?? 0;
}

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review'];
export const DONE_STATUSES: TaskStatus[] = ['done', 'canceled'];

/**
 * Database rows store status as a portable string, so these guards narrow it back to
 * `TaskStatus` instead of scattering `as never` casts across services.
 */
export function isDoneStatus(status: string): status is TaskStatus {
    return (DONE_STATUSES as readonly string[]).includes(status);
}

export function isOpenStatus(status: string): status is TaskStatus {
    return (OPEN_STATUSES as readonly string[]).includes(status);
}
