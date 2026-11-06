import { z } from 'zod';
import {
    ACTIVITY_TYPES,
    CYCLE_STATUSES,
    DEPENDENCY_TYPES,
    ORG_ROLES,
    PROJECT_ROLES,
    PROJECT_STATUSES,
    PROJECT_VISIBILITIES,
    TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUSES,
    WEBHOOK_EVENTS,
    apiTokenScopeSchema,
    automationActionSchema,
    automationTriggerSchema,
    customFieldTypeSchema,
    recurrenceRuleSchema,
    webhookEventSchema,
} from './enums.js';

/** Request/response contracts. Kept together so routes stay thin and validation is uniform. */

export const idParam = z.object({ id: z.string().min(1) });

/**
 * Query-string booleans. `z.coerce.boolean()` would turn the string `"false"` into
 * `true`, so flags are parsed explicitly.
 */
export const BoolQuery = z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

/**
 * Multi-value query filters. Express hands back a plain string for `?status=done`
 * and an array for `?status=done&status=todo`; both should mean "filter by these".
 * JSON bodies keep using real arrays.
 */
export const CsvList = <T extends readonly [string, ...string[]]>(values: T) =>
    z.preprocess(
        (value) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : value),
        z.array(z.enum(values)),
    );

/**
 * A query-string slot that carries a JSON document.
 *
 * Nested filters have no query-string shape, so the client serialises them and the server parses
 * here rather than trusting a downstream `JSON.parse`. Unparseable input is left untouched so the
 * inner schema reports the ordinary "expected array" instead of a bare syntax error.
 */
export const JsonParam = <T extends z.ZodTypeAny>(schema: T) =>
    z.preprocess((value) => {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }, schema);

const Password = z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(200)
    .regex(/[a-zA-Z]/, 'Include at least one letter')
    .regex(/[0-9]/, 'Include at least one number');

const Email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);

export const registerSchema = z.object({
    email: Email,
    password: Password,
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    /** Creating the first organization in the same call keeps sign-up to one screen. */
    organizationName: z.string().trim().min(2).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    email: Email,
    password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: Password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({ email: Email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** The token is a random secret from the e-mailed link; length is the only sane check. */
export const resetPasswordSchema = z.object({
    token: z.string().min(20).max(200),
    password: Password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const resetTokenQuerySchema = z.object({ token: z.string().min(20).max(200) });

export const updateProfileSchema = z.object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    timezone: z.string().max(60).optional(),
    avatarUrl: z.string().url().max(500).optional().nullable(),
    prefs: z
        .object({
            emailOnAssign: z.boolean().optional(),
            emailOnComment: z.boolean().optional(),
            emailDigest: z.boolean().optional(),
        })
        .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ------------------------------------------------------------------ organization

export const createOrganizationSchema = z.object({
    name: z.string().trim().min(2).max(80),
});

export const updateOrganizationSchema = z.object({
    name: z.string().trim().min(2).max(80).optional(),
});

export const inviteSchema = z.object({
    emails: z.array(Email).min(1).max(50),
    role: z.enum(ORG_ROLES).default('member'),
    teamIds: z.array(z.string()).max(20).optional(),
    projectIds: z.array(z.string()).max(20).optional(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({ token: z.string().min(10) });

export const memberRoleSchema = z.object({ role: z.enum(ORG_ROLES) });

export const createTeamSchema = z.object({
    name: z.string().trim().min(2).max(60),
    memberIds: z.array(z.string()).max(200).optional(),
});

export const teamMembersSchema = z.object({ userIds: z.array(z.string()).min(1).max(200) });

// ---------------------------------------------------------------------- projects

export const createProjectSchema = z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().max(2000).optional().nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
    visibility: z.enum(PROJECT_VISIBILITIES).default('organization'),
    teamId: z.string().optional().nullable(),
    startDate: z.coerce.date().optional().nullable(),
    dueDate: z.coerce.date().optional().nullable(),
    memberIds: z.array(z.string()).max(200).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema
    .partial()
    .extend({ status: z.enum(PROJECT_STATUSES).optional() });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectMemberSchema = z.object({
    userIds: z.array(z.string()).min(1).max(200),
    role: z.enum(PROJECT_ROLES).default('member'),
});

export const projectListQuerySchema = z.object({
    status: z.enum(PROJECT_STATUSES).default('active'),
    teamId: z.string().optional(),
    search: z.string().max(120).optional(),
    memberId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

// ------------------------------------------------------------------------ labels

export const createLabelSchema = z.object({
    name: z.string().trim().min(1).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f766e'),
    projectId: z.string().optional().nullable(),
});

export const labelIdsSchema = z.object({ labelIds: z.array(z.string()).max(30) });

// ---------------------------------------------------------------- custom fields

/**
 * A field definition. `type` is immutable after creation on purpose: every stored value is already
 * a plain string, so reinterpreting a text field as a number would silently rewrite what people
 * typed. `options` belongs to `select` and nothing else.
 */
export const createCustomFieldSchema = z
    .object({
        name: z.string().trim().min(1).max(60),
        type: customFieldTypeSchema,
        /** Absent or null = organization-wide; otherwise the field shows up only in this project. */
        projectId: z.string().optional().nullable(),
        options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.type === 'select' && !value.options?.length) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'A select field needs at least one option' });
        }
        if (value.type !== 'select' && value.options?.length) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: `Only a select field can have options (${value.type} cannot)` });
        }
    });
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

/** Which definitions a caller may see: organization-wide, plus one project's own when asked for. */
export const fieldListQuerySchema = z.object({
    /** Scope the list to one project: organization-wide fields plus that project's own. */
    projectId: z.string().optional(),
});
export type FieldListQuery = z.infer<typeof fieldListQuerySchema>;

/** Rename, or replace the option list of a select field. Type and scope stay as created. */
export const updateCustomFieldSchema = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    options: z.array(z.string().trim().min(1).max(60)).min(1).max(30).optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;

/**
 * Values keyed by field id. The shape is deliberately loose: the rules that decide whether a value
 * is legal are the definition's (a number must be numeric, a select value must still be an option),
 * and the service has to load those rows anyway to write them.
 */
export const taskFieldValuesSchema = z
    .object({
        values: z.record(z.string().min(1), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])),
    })
    .superRefine((value, ctx) => {
        const ids = Object.keys(value.values);
        if (ids.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: 'Send at least one field to set or clear' });
        if (ids.length > 40) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: 'One save may touch at most 40 fields' });
    });
export type TaskFieldValuesInput = z.infer<typeof taskFieldValuesSchema>;

/**
 * One custom-field filter in a task list query. `value` is matched by the field's own type: text is
 * a substring, everything else is equality. A saved filter stores these in its `params` JSON, so
 * `fieldFilters` doubles as the query-string form (a JSON array) and the stored form.
 */
export const customFieldFilterSchema = z.object({
    fieldId: z.string().min(1),
    value: z.union([z.string().max(200), z.number(), z.boolean()]),
});
export type CustomFieldFilter = z.infer<typeof customFieldFilterSchema>;

/** Column picker for the project CSV export: `?fields=<definitionId>,…` (plain comma list). */
export const projectExportQuerySchema = z.object({
    fields: z
        .preprocess(
            (value) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : value),
            z.array(z.string().min(1)).max(40),
        )
        .optional(),
});
export type ProjectExportQuery = z.infer<typeof projectExportQuerySchema>;

// ------------------------------------------------------------------------ tasks

export const createTaskSchema = z.object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).optional().nullable(),
    sectionId: z.string().optional().nullable(),
    parentTaskId: z.string().optional().nullable(),
    status: z.enum(TASK_STATUSES).default('todo'),
    priority: z.enum(TASK_PRIORITIES).default('none'),
    dueDate: z.coerce.date().optional().nullable(),
    startDate: z.coerce.date().optional().nullable(),
    estimateMins: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
    isMilestone: z.boolean().default(false),
    kind: z.enum(TASK_KINDS).default('task'),
    cycleId: z.string().optional().nullable(),
    /** Optional recurrence rule; stored as a JSON string on the row. */
    recurrence: recurrenceRuleSchema.optional().nullable(),
    assigneeIds: z.array(z.string()).max(50).optional(),
    labelIds: z.array(z.string()).max(30).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).optional().nullable(),
    sectionId: z.string().optional().nullable(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: z.coerce.date().optional().nullable(),
    startDate: z.coerce.date().optional().nullable(),
    estimateMins: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
    isMilestone: z.boolean().optional(),
    parentTaskId: z.string().optional().nullable(),
    kind: z.enum(TASK_KINDS).optional(),
    cycleId: z.string().optional().nullable(),
    /** Send a rule object to (re)apply recurrence, or null to clear it. */
    recurrence: recurrenceRuleSchema.optional().nullable(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const assignSchema = z.object({
    userIds: z.array(z.string()).max(50),
    mode: z.enum(['replace', 'add', 'remove']).default('replace'),
});
export type AssignInput = z.infer<typeof assignSchema>;

/** Kanban drag & drop: `after`/`before` are neighbouring task ids in the target column. */
export const moveTaskSchema = z.object({
    sectionId: z.string().min(1),
    afterTaskId: z.string().optional().nullable(),
    beforeTaskId: z.string().optional().nullable(),
    inheritSectionStatus: z.boolean().default(true),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

/**
 * One action over a batch of tasks. The cap is a product decision as much as a
 * performance one: the response reports per-id outcomes, and a thousand checkboxes in one
 * click would bury the activity trail the audit log depends on.
 */
export const bulkTaskSchema = z
    .object({
        ids: z.array(z.string()).min(1).max(100),
        action: z.enum(['status', 'priority', 'delete', 'move', 'assign']),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        sectionId: z.string().optional(),
        inheritSectionStatus: z.boolean().optional(),
        assigneeIds: z.array(z.string()).max(50).optional(),
        assignMode: z.enum(['add', 'replace', 'remove']).optional(),
    })
    .superRefine((value, ctx) => {
        // A batch action that is missing the field it acts on is a client bug, so it is refused
        // before any task is touched; otherwise one bad request becomes a hundred per-id failures
        // carried inside a 200. `assign` is absent on purpose: `replace` with an empty list is a
        // legitimate way to unassign a whole set.
        const required: Partial<Record<typeof value.action, { field: 'status' | 'priority' | 'sectionId'; hint: string }>> = {
            status: { field: 'status', hint: 'which status to set' },
            priority: { field: 'priority', hint: 'which priority to set' },
            move: { field: 'sectionId', hint: 'which column to move into' },
        };
        const need = required[value.action];
        if (need && !value[need.field]) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [need.field], message: `"${value.action}" needs ${need.hint}` });
        }
    });
export type BulkTaskInput = z.infer<typeof bulkTaskSchema>;

/** Board payload size guard; the default is `BOARD_SECTION_TASK_LIMIT`. */
export const boardQuerySchema = z.object({
    limit: z.coerce.number().int().min(10).max(1000).optional(),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

/**
 * Activity feed window. `before` is the id of the last row already shown: the feed pages
 * with a keyset cursor rather than `skip` because the audit trail grows while you scroll,
 * and offset paging would repeat or drop rows exactly when the org is busiest.
 */
export const activityFeedQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().optional(),
    /**
     * Audit filters (Settings → Audit). All optional, so the ordinary feed keeps working
     * unchanged; `userId` is the actor, and `from`/`to` bound the timestamp either way.
     */
    userId: z.string().optional(),
    type: z.enum(ACTIVITY_TYPES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});
export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;

export const taskListQuerySchema = z.object({
    projectId: z.string().optional(),
    sectionId: z.string().optional(),
    cycleId: z.string().optional(),
    kind: z.enum(TASK_KINDS).optional(),
    status: CsvList(TASK_STATUSES).optional(),
    priority: CsvList(TASK_PRIORITIES).optional(),
    assigneeId: z.string().optional(),
    labelId: z.string().optional(),
    dueBefore: z.coerce.date().optional(),
    dueAfter: z.coerce.date().optional(),
    overdue: BoolQuery.optional(),
    /** Custom-field filters (Phase 6), as a JSON array on the query string. */
    fieldFilters: JsonParam(z.array(customFieldFilterSchema).max(10)).optional(),
    includeSubtasks: BoolQuery.default(true),
    search: z.string().max(120).optional(),
    orderBy: z.enum(['position', 'dueDate', 'priority', 'createdAt', 'updatedAt']).default('position'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/**
 * A saved filter stores an arbitrary snapshot of `taskListQuerySchema` params (kept as free-form
 * JSON so the client owns the shape) under a user-chosen name. `params` is validated only as a
 * plain object; the list endpoint re-validates it when the filter is applied.
 */
export const createSavedFilterSchema = z.object({
    name: z.string().trim().min(1).max(80),
    projectId: z.string().optional().nullable(),
    params: z.record(z.string(), z.unknown()),
});
export type CreateSavedFilterInput = z.infer<typeof createSavedFilterSchema>;

export const createSectionSchema = z.object({
    name: z.string().trim().min(1).max(60),
    afterSectionId: z.string().optional().nullable(),
    isDone: z.boolean().default(false),
});

export const updateSectionSchema = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    isDone: z.boolean().optional(),
});

export const reorderSectionsSchema = z.object({ orderedIds: z.array(z.string()).min(1).max(50) });

// ------------------------------------------------------------------------ cycles

/**
 * A cycle (Linear "sprint"). Dates are start-of-day timestamps; `endsAt` must follow
 * `startsAt`. `number` is assigned server-side (per-project sequence) on create.
 */
export const createCycleSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
    })
    .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
        message: '`endsAt` must be after `startsAt`',
        path: ['endsAt'],
    });
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const updateCycleSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        status: z.enum(CYCLE_STATUSES).optional(),
    })
    .refine((v) => !v.startsAt || !v.endsAt || v.endsAt.getTime() > v.startsAt.getTime(), {
        message: '`endsAt` must be after `startsAt`',
        path: ['endsAt'],
    });
export type UpdateCycleInput = z.infer<typeof updateCycleSchema>;

export const cycleListQuerySchema = z.object({
    status: z.enum(CYCLE_STATUSES).optional(),
});
export type CycleListQuery = z.infer<typeof cycleListQuerySchema>;

// ------------------------------------------------------------------- dependencies

export const createDependencySchema = z.object({
    /** id of the task that must finish first (this task waits on it). */
    dependsOnTaskId: z.string().min(1),
    type: z.enum(DEPENDENCY_TYPES).default('FS'),
});
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;

// --------------------------------------------------------------------- time logs

/** Starting a timer may carry a one-line note about what the sitting is for. */
export const startTimeLogSchema = z.object({
    description: z.string().trim().max(200).optional(),
});
export type StartTimeLogInput = z.infer<typeof startTimeLogSchema>;

/**
 * A backfilled entry: either a duration or the start/stop pair. `durationMins` wins when both are
 * given, because that is the number the user actually meant to record.
 */
export const manualTimeLogSchema = z
    .object({
        startedAt: z.coerce.date(),
        stoppedAt: z.coerce.date().optional().nullable(),
        durationMins: z.coerce.number().int().min(1).max(60 * 24 * 30).optional(),
        description: z.string().trim().max(200).optional(),
    })
    .refine((value) => value.durationMins !== undefined || value.stoppedAt !== undefined,
        { message: 'Provide either stoppedAt or durationMins' });
export type ManualTimeLogInput = z.infer<typeof manualTimeLogSchema>;

// --------------------------------------------------------------------- comments

export const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(20000),
});

// --------------------------------------------------------------------- analytics

export const analyticsQuerySchema = z.object({
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** `day` | `week` buckets for the throughput chart. */
    granularity: z.enum(['day', 'week']).default('day'),
    status: z.enum(PROJECT_STATUSES).default('active'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** `?cycleId=` for the burndown report. */
export const burndownQuerySchema = z.object({ cycleId: z.string().min(1) });
export type BurndownQuery = z.infer<typeof burndownQuerySchema>;

// ----------------------------------------------------------------- notifications

export const markReadSchema = z.object({ ids: z.array(z.string()).max(200).optional() });

export const notificationListQuerySchema = z.object({
    unreadOnly: BoolQuery.default(false),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

// ----------------------------------------------------------- API tokens (Phase 5)

/**
 * Personal access tokens. The plain secret (`zrq_…`) is returned exactly once, so the
 * create response is the only place it exists; everything later reads the hash.
 */
export const createApiTokenSchema = z.object({
    name: z.string().trim().min(2).max(60),
    /** Deduplicated by the service; `*` is matched by name, never by hierarchy. */
    scopes: z.array(apiTokenScopeSchema).min(1).max(3).default(['read']),
    /** Omit for a token that only dies when it is revoked. */
    expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

// ------------------------------------------------------------- webhooks (Phase 5)

/**
 * Outbound URL. Only the scheme is checked here: the receiver is operator-supplied, and an
 * `http(s)` guard is the part that can be expressed declaratively. Host allow/deny lists are not
 * validated here: the URL is operator-supplied in an admin-only settings screen, so the trust
 * decision is the admin's, not the schema's.
 */
const WebhookUrl = z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }, 'Enter a valid http(s) URL');

export const createWebhookSchema = z.object({
    url: WebhookUrl,
    events: z.array(webhookEventSchema).min(1).max(WEBHOOK_EVENTS.length),
    active: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = createWebhookSchema.omit({ events: true }).partial().extend({
    events: z.array(webhookEventSchema).min(1).max(WEBHOOK_EVENTS.length).optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const webhookDeliveryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type WebhookDeliveryQuery = z.infer<typeof webhookDeliveryQuerySchema>;

// ------------------------------------------------------------ automations (Phase 5)

/** `AutomationRule.trigger` JSON: which activity event, and what the task must look like. */
export const automationTriggerShapeSchema = z.object({
    event: automationTriggerSchema,
    conditions: z
        .object({
            /** Status transitions are matched as `from` -> `to`; `to` alone is the common case. */
            from: z.enum(TASK_STATUSES).optional(),
            to: z.enum(TASK_STATUSES).optional(),
            priority: z.enum(TASK_PRIORITIES).optional(),
            /** Fires only when the task carries this label. */
            hasLabelId: z.string().optional(),
        })
        .optional(),
});
export type AutomationTriggerShape = z.infer<typeof automationTriggerShapeSchema>;

export const createAutomationSchema = z.object({
    name: z.string().trim().min(2).max(80),
    trigger: automationTriggerShapeSchema,
    actions: z.array(automationActionSchema).min(1).max(6),
    active: z.boolean().default(true),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = createAutomationSchema.partial();
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// ------------------------------------------------------------- share links (Phase 5)

/** Exactly one target: a project snapshot or a single task, never both. */
export const createShareLinkSchema = z
    .object({
        projectId: z.string().min(1).optional(),
        taskId: z.string().min(1).optional(),
        expiresInDays: z.coerce.number().int().min(1).max(90).default(7),
    })
    .refine((value) => Boolean(value.projectId) !== Boolean(value.taskId), {
        message: 'Share exactly one project or task',
    });
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

// ------------------------------------------------------------------ MFA (Phase 5)

/** Authenticator code (6 digits) or a backup recovery code. */
const OtpCode = z.string().trim().min(6).max(40);

export const mfaSetupVerifySchema = z.object({ code: OtpCode });
export type MfaSetupVerifyInput = z.infer<typeof mfaSetupVerifySchema>;

/** Second login step: the challenge handed back by `/auth/login` plus a code. */
export const mfaChallengeSchema = z.object({ challenge: z.string().min(16), code: OtpCode });
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

export const mfaDisableSchema = z.object({ password: z.string().min(1).max(200) });
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

/** Inferred payload types used by the route handlers. */
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type MemberRoleInput = z.infer<typeof memberRoleSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type TeamMembersInput = z.infer<typeof teamMembersSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type LabelIdsInput = z.infer<typeof labelIdsSchema>;
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ReorderSectionsInput = z.infer<typeof reorderSectionsSchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
