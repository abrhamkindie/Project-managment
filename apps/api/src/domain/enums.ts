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

export const CYCLE_STATUSES = ['draft', 'active', 'closed'] as const;
export const cycleStatusSchema = z.enum(CYCLE_STATUSES);
export type CycleStatus = z.infer<typeof cycleStatusSchema>;

/** Task kind widens `Task` into epics without a second table (Phase 2). */
export const TASK_KINDS = ['task', 'epic'] as const;
export const taskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof taskKindSchema>;

/** Only finish-to-start for now; the row shape leaves room for the other three. */
export const DEPENDENCY_TYPES = ['FS'] as const;
export const dependencyTypeSchema = z.enum(DEPENDENCY_TYPES);
export type DependencyType = z.infer<typeof dependencyTypeSchema>;

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export const recurrenceRuleSchema = z.object({
    freq: z.enum(RECURRENCE_FREQS),
    /** Every N days/weeks/months; 1 = plain weekly etc. */
    interval: z.number().int().min(1).max(365).default(1),
    /** Weekly only: ISO weekdays (1=Mon … 7=Sun) the task may land on. */
    byDays: z.array(z.number().int().min(1).max(7)).optional(),
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox'] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const SHARE_SCOPES = ['read'] as const;
export const shareScopeSchema = z.enum(SHARE_SCOPES);
export type ShareScope = z.infer<typeof shareScopeSchema>;

/** Events a Webhook can subscribe to; matches `Activity.type` values that can fire today. */
export const WEBHOOK_EVENTS = [
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.assigned',
    'task.completed',
    'comment.added',
    'project.updated',
    'member.added',
] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed'] as const;
export const webhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

/** API-token scopes; `*` is the full surface (checked by name, not hierarchy). */
export const API_TOKEN_SCOPES = ['read', 'write', '*'] as const;
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

/**
 * Every personal access token starts with this, which is also how the auth middleware tells a
 * token apart from a JWT without parsing either. Long enough to be unambiguous in a log line.
 */
export const API_TOKEN_PREFIX = 'zrq_';

/** Automation triggers — the subset of activity events the rule engine evaluates. */
export const AUTOMATION_TRIGGERS = [
    'task.created',
    'task.status_changed',
    'task.assigned',
    'comment.added',
] as const;
export const automationTriggerSchema = z.enum(AUTOMATION_TRIGGERS);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

/** Automation action primitives — no free code, only these shapes (Phase 5). */
export const AUTOMATION_ACTIONS = [
    'set_status',
    'set_priority',
    'assign',
    'add_label',
    'notify',
    'webhook',
] as const;
export const automationActionSchema = z.object({
    kind: z.enum(AUTOMATION_ACTIONS),
    /** Shape depends on `kind`: status/priority string, userId, labelId, message… */
    value: z.union([z.string(), z.number(), z.array(z.string())]),
});
export type AutomationAction = z.infer<typeof automationActionSchema>;

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
    'cycle.created',
    'cycle.updated',
    'cycle.closed',
    'dependency.created',
    'dependency.deleted',
    'time.started',
    'time.logged',
    'time.deleted',
    // Custom fields (Phase 6): the definition trail is auditable because a field shape change
    // rewrites what every other member can see, and a value edit is a task change.
    'field.created',
    'field.updated',
    'field.deleted',
    'task.fields_updated',
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
    /** Sent by an automation rule; carries the rule name so the inbox explains itself. */
    'automation.fired',
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
