import { z } from 'zod';
import {
    ORG_ROLES,
    PROJECT_ROLES,
    PROJECT_STATUSES,
    PROJECT_VISIBILITIES,
    TASK_PRIORITIES,
    TASK_STATUSES,
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

// ------------------------------------------------------------------------- tasks

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
});
export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;

export const taskListQuerySchema = z.object({
    projectId: z.string().optional(),
    sectionId: z.string().optional(),
    status: CsvList(TASK_STATUSES).optional(),
    priority: CsvList(TASK_PRIORITIES).optional(),
    assigneeId: z.string().optional(),
    labelId: z.string().optional(),
    dueBefore: z.coerce.date().optional(),
    dueAfter: z.coerce.date().optional(),
    overdue: BoolQuery.optional(),
    includeSubtasks: BoolQuery.default(true),
    search: z.string().max(120).optional(),
    orderBy: z.enum(['position', 'dueDate', 'priority', 'createdAt', 'updatedAt']).default('position'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

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

// ----------------------------------------------------------------- notifications

export const markReadSchema = z.object({ ids: z.array(z.string()).max(200).optional() });

export const notificationListQuerySchema = z.object({
    unreadOnly: BoolQuery.default(false),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

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
