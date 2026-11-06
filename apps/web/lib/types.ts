/**
 * Client-side mirror of the API contract.
 *
 * These shapes are pinned by the API test suite (`apps/api/tests/*`), so a breaking change
 * on the server is a failing test there rather than a blank screen here. Anything the UI
 * renders is declared explicitly; nothing is `any`.
 */

export type OrgRole = 'admin' | 'manager' | 'member';
export type ProjectRole = 'lead' | 'member';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type ProjectVisibility = 'organization' | 'private';
export type ProjectStatus = 'active' | 'archived';
export type TaskKind = 'task' | 'epic';
export type CycleStatus = 'draft' | 'active' | 'closed';
export type DependencyType = 'FS';

/** Recurrence rule stored as JSON on the task; `null` when the task is not recurring. */
export interface RecurrenceRule {
    freq: 'daily' | 'weekly' | 'monthly';
    interval: number;
    byDays?: number[];
}

/** Paged collections come back as `{ items, total, page, pageSize, pages }`. */
export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
}

export interface UserDto {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    timezone?: string;
    createdAt: string | null;
    prefs: NotificationPrefs;
}

export interface NotificationPrefs {
    emailOnAssign: boolean;
    emailOnComment: boolean;
    emailDigest: boolean;
}

export interface OrganizationSummary {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    createdAt: string;
    role: OrgRole;
    memberCount: number;
}

/** `GET /api/auth/me` — the session envelope every page starts from. */
export interface Session {
    user: UserDto;
    organizations: OrganizationSummary[];
}

export interface LightUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
}

export interface OrganizationDetail {
    organization: { id: string; name: string; slug: string; ownerId: string; createdAt: string };
    me: { role: OrgRole; userId: string };
    memberCount: number;
}

export interface MemberDto {
    id: string;
    role: OrgRole;
    joinedAt: string;
    user: LightUser & { isActive: boolean };
    teams: { id: string; name: string }[];
}

/**
 * `GET /organizations/:orgId/presence` — one row per member of the workspace.
 *
 * `online` means the server holds a live socket for them *and* their tab was beating inside the
 * stale window; `lastSeenAt` is the moment that stopped, which is what the away state shows.
 */
export interface PresenceDto {
    userId: string;
    online: boolean;
    lastSeenAt: string | null;
}

export interface InvitationDto {
    id: string;
    email: string;
    role: OrgRole;
    invitedBy: LightUser | null;
    expiresAt: string;
    createdAt: string;
}

export interface TeamDto {
    id: string;
    name: string;
    slug: string;
    projectCount: number;
    members: { id: string; firstName: string; lastName: string }[];
}

export interface LabelDto {
    id: string;
    name: string;
    color: string;
    orgId: string;
    projectId: string | null;
    createdAt: string;
}

export interface ProjectSummary {
    id: string;
    orgId: string;
    teamId: string | null;
    name: string;
    description: string | null;
    color: string;
    visibility: ProjectVisibility;
    status: ProjectStatus;
    startDate: string | null;
    dueDate: string | null;
    createdAt: string;
    updatedAt: string;
    createdById: string;
    members: (LightUser & { role: ProjectRole; joinedAt: string | null })[];
    memberIds: string[];
    taskCount: number;
    /** Server-authoritative flags; `listProjects` includes them so the UI can gate actions. */
    canEdit?: boolean;
    canDelete?: boolean;
}

/** `GET /api/projects/:id` — a project plus everything its header shows. */
export interface ProjectDetailDto extends ProjectSummary {
    completedTasks: number;
    progress: number;
    canEdit: boolean;
    canManageMembers: boolean;
    byStatus: Partial<Record<TaskStatus, number>>;
    sections: SectionDto[];
}

export interface SectionDto {
    id: string;
    projectId: string;
    name: string;
    position: number;
    isDone: boolean;
}

export interface AssigneeDto extends LightUser {
    isPrimary: boolean;
}

export interface AttachmentDto {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: string;
    url: string;
}

/** The task "card": what a list, a board column and a mutation response all return. */
export interface TaskCardDto {
    id: string;
    projectId: string;
    sectionId: string | null;
    parentTaskId: string | null;
    /**
     * Display-only ordinal inside the project (`#42`). Null on mutation and realtime
     * payloads, where the server does not recompute it — the caches keep the known value.
     * Never an identifier: links and ids still use `id`.
     */
    number: number | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    startDate: string | null;
    estimateMins: number | null;
    isMilestone: boolean;
    /** task | epic — epics render a child-completion bar on board and list cards. */
    kind: TaskKind;
    /** Cycle (sprint) this task is scoped to, or null for backlog/unscheduled work. */
    cycleId: string | null;
    /** Parsed recurrence rule (Phase 3), null when not recurring. */
    recurrence: RecurrenceRule | null;
    /**
     * Epic rollup: done/total across direct children. Present only for epics in a list or
     * board payload the server computed it for; absent on single-card mutation responses.
     */
    epicProgress?: { done: number; total: number } | null;
    /**
     * Minutes logged against this task, stopped timers only. Computed for list/board/my-tasks
     * reads; absent on mutation responses, where the cache keeps the known value.
     */
    loggedMins?: number | null;
    /**
     * Custom-field values (Phase 6) — only the fields that actually hold something. Names and types
     * are not repeated per card: the screens read them from `useCustomFields`.
     */
    fields?: TaskFieldValueDto[];
    position: number;
    isOverdue: boolean;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
    createdById: string;
    assignees: AssigneeDto[];
    assigneeIds: string[];
    labels: { id: string; name: string; color: string }[];
    attachments: AttachmentDto[];
    subtaskCount: number;
    commentCount: number;
}

export interface ProjectContextDto {
    id: string;
    orgId: string;
    name: string;
    color: string;
    visibility: ProjectVisibility;
}

export interface CommentDto {
    id: string;
    taskId: string;
    body: string;
    author: LightUser;
    createdAt: string;
    updatedAt: string;
}

export interface ActivityDto {
    id: string;
    type: string;
    meta: Record<string, unknown>;
    projectId: string | null;
    taskId: string | null;
    actor: LightUser;
    createdAt: string;
}

/** Drawer timeline: audit rows and comments interleaved, oldest first. */
export type TimelineEntry =
    | ({ kind: 'activity' } & ActivityDto)
    | ({ kind: 'comment'; type: 'comment.added' } & CommentDto);

/** `GET /api/tasks/:id` — a card plus its context, so updates merge cleanly. */
export interface TaskDetailDto extends TaskCardDto {
    project: ProjectContextDto;
    subtasks: TaskCardDto[];
    parent: TaskCardDto | null;
    dependencies: DependenciesDto;
    timeline: TimelineEntry[];
    /** Feed rows older than the server's cap that were left out of `timeline`. */
    olderHidden: number;
}

// --------------------------------------------------------------------- cycles + deps

/** `GET /projects/:id/cycles` — a sprint plus the scope counts its board chip shows. */
export interface CycleDto {
    id: string;
    projectId: string;
    name: string;
    number: number;
    startsAt: string;
    endsAt: string;
    status: CycleStatus;
    createdAt: string;
    updatedAt: string;
    taskCount: number;
    doneCount: number;
}

// ------------------------------------------------------------------ time tracking

/** One `TimeLog` row — a sitting. `running` means `stoppedAt` is still null. */
export interface TimeEntryDto {
    id: string;
    taskId: string;
    userId: string;
    user: LightUser;
    startedAt: string;
    stoppedAt: string | null;
    durationMins: number | null;
    description: string | null;
    running: boolean;
}

/** `GET /tasks/:id/time` — everything the drawer timer widget paints in one request. */
export interface TaskTimeDto {
    entries: TimeEntryDto[];
    running: TimeEntryDto | null;
    summary: {
        totalMins: number;
        estimateMins: number | null;
        /** Positive once the work has outgrown its estimate; null when there was no estimate. */
        overEstimateMins: number | null;
        byUser: { user: LightUser; mins: number }[];
    };
}

/** `POST /tasks/:id/time/entries` — backfill work that happened away from the timer. */
export interface CreateTimeEntryBody {
    startedAt: string;
    stoppedAt?: string | null;
    durationMins?: number;
    description?: string;
}

// ---------------------------------------------------------------- burndown reports

export interface BurndownDayDto {
    date: string;
    ideal: number;
    /** null for days after today — the actual line simply stops. */
    remaining: number | null;
    completed: number;
    loggedMins: number;
}

/** `GET /projects/:id/analytics/burndown?cycleId=` */
export interface BurndownDto {
    cycle: Pick<CycleDto, 'id' | 'name' | 'number' | 'status' | 'startsAt' | 'endsAt'>;
    project: { id: string; name: string; color: string };
    totals: {
        scope: number;
        completed: number;
        remaining: number;
        completion: number;
        estimateMins: number;
        loggedMins: number;
    };
    days: BurndownDayDto[];
}

/** `GET /projects/:id/analytics/cycles` — one row per cycle, oldest first. */
export interface CycleCompletionRow {
    id: string;
    name: string;
    number: number;
    status: CycleStatus;
    startsAt: string;
    endsAt: string;
    scope: number;
    completed: number;
    completion: number;
    loggedMins: number;
}

/** A single edge, seen from one endpoint, with the *other* task attached. */
export interface DependencyEdgeDto {
    dependencyId: string;
    type: DependencyType;
    createdAt: string;
    task: {
        id: string;
        title: string;
        status: TaskStatus;
        priority: TaskPriority;
        kind: TaskKind;
        projectId: string;
        project: { id: string; name: string; color: string };
    };
}

/** `GET /tasks/:id/dependencies` (and embedded in `TaskDetailDto`). */
export interface DependenciesDto {
    /** Tasks this one waits on to start. */
    blockedBy: DependencyEdgeDto[];
    /** Tasks waiting on this one to finish. */
    blocking: DependencyEdgeDto[];
}

export interface BoardSectionDto extends SectionDto {
    tasks: TaskCardDto[];
    /** Cards in the column overall, including the ones the cap left out. */
    total: number;
    /** True when `tasks` is only the first `BoardDto.limit` of `total`. */
    truncated: boolean;
}

export interface BoardDto {
    project: Pick<ProjectSummary, 'id' | 'name' | 'color' | 'visibility' | 'status'>;
    /** Cards returned per column; the rest are reachable through the task list. */
    limit: number;
    sections: BoardSectionDto[];
    unassigned: TaskCardDto[];
}

/** My Tasks is grouped by project, in the order the API returns it. */
export interface MyTasksGroup {
    project: { id: string; name: string; color: string };
    tasks: TaskCardDto[];
}

export interface NotificationDto {
    id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
    readAt: string | null;
    createdAt: string;
}

export interface NotificationPage extends Page<NotificationDto> {
    unread: number;
}

export interface SessionDto {
    id: string;
    userAgent: string | null;
    ip: string | null;
    createdAt: string;
    lastUsedAt: string | null;
}

// ------------------------------------------------------------------------ analytics

export interface AnalyticsTotals {
    tasks: number;
    created: number;
    completed: number;
    open: number;
    overdue: number;
    dueSoon: number;
    completionRate: number | null;
    progress: number;
    avgCompletionHours: number | null;
    /** Share of finished, dated work that landed on or before its due date. */
    onTimeRate: number | null;
    /** Minutes the team logged inside the window. */
    loggedMins: number;
}

export interface Tally {
    key: string;
    count: number;
}

export interface ThroughputBucket {
    bucket: string;
    created: number;
    completed: number;
}

export interface WorkloadRow {
    user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
    open: number;
    overdue: number;
    /** Tasks this person owns that are in a done status (all time, not just the window). */
    done: number;
    /** Of the done tasks, how many finished inside the reporting window. */
    completedInWindow: number;
    /** Every task currently assigned to this person. */
    assigned: number;
    /** done / assigned as a percentage — the member's progress. */
    progress: number;
    /** Minutes this person logged inside the window. */
    loggedMins: number;
    score: number;
}

export type ProjectHealth = 'on_track' | 'at_risk' | 'off_track' | 'empty';

export interface ProjectHealthRow {
    project: { id: string; name: string; color: string };
    total: number;
    completed: number;
    overdue: number;
    progress: number;
    health: ProjectHealth;
}

export interface MilestoneRow {
    id: string;
    title: string;
    status: TaskStatus;
    dueDate: string | null;
    project: string | null;
    isOverdue: boolean;
}

export interface AnalyticsOverview {
    window: { from: string; to: string; granularity: 'day' | 'week' };
    totals: AnalyticsTotals;
    byStatus: Tally[];
    byPriority: Tally[];
    throughput: ThroughputBucket[];
    workload: WorkloadRow[];
    projects: ProjectHealthRow[];
    milestones: MilestoneRow[];
}

export interface AnalyticsWorkload {
    window: AnalyticsOverview['window'];
    workload: WorkloadRow[];
}

// -------------------------------------------------------------------------- queries
// Declared as type aliases (not interfaces) on purpose: only object-literal types get an
// implicit index signature, which is what lets them be passed straight to the API client's
// `query` option without a cast.

export type ProjectListQuery = {
    status?: ProjectStatus;
    teamId?: string;
    memberId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}

export type TaskListQuery = {
    projectId?: string;
    sectionId?: string;
    cycleId?: string;
    kind?: TaskKind;
    status?: TaskStatus[] | string;
    priority?: TaskPriority[] | string;
    assigneeId?: string;
    labelId?: string;
    /** Inclusive due-date window (ISO stamps) — the calendar grid reads a month with these. */
    dueAfter?: string;
    dueBefore?: string;
    overdue?: boolean;
    includeSubtasks?: boolean;
    /**
     * Custom-field filters (Phase 6): a JSON-encoded `CustomFieldFilterDto[]`. A string rather than
     * the array, because that is the shape the query string carries — and the same shape a saved
     * filter stores, so the two never need converting.
     */
    fieldFilters?: string;
    search?: string;
    orderBy?: 'position' | 'dueDate' | 'priority' | 'createdAt' | 'updatedAt';
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}

export type AnalyticsQuery = {
    projectId?: string;
    teamId?: string;
    from?: string;
    to?: string;
    granularity?: 'day' | 'week';
    status?: ProjectStatus;
}

// ---------------------------------------------------------------------- write bodies

export interface CreateProjectBody {
    name: string;
    description?: string | null;
    color?: string;
    visibility?: ProjectVisibility;
    teamId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    memberIds?: string[];
}
export type UpdateProjectBody = Partial<CreateProjectBody> & { status?: ProjectStatus };

export interface CreateTaskBody {
    projectId: string;
    title: string;
    description?: string | null;
    sectionId?: string | null;
    parentTaskId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    estimateMins?: number | null;
    isMilestone?: boolean;
    kind?: TaskKind;
    cycleId?: string | null;
    recurrence?: RecurrenceRule | null;
    assigneeIds?: string[];
    labelIds?: string[];
}

export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'projectId' | 'assigneeIds' | 'labelIds'>>;

export interface CreateCycleBody {
    name: string;
    startsAt: string;
    endsAt: string;
}
export type UpdateCycleBody = Partial<CreateCycleBody> & { status?: CycleStatus };

export interface CreateDependencyBody {
    dependsOnTaskId: string;
    type?: DependencyType;
}

/** `GET /organizations/:orgId/filters` — a per-user saved snapshot of task-list params. */
export interface SavedFilterDto {
    id: string;
    userId: string;
    orgId: string;
    projectId: string | null;
    name: string;
    params: Record<string, unknown>;
    createdAt: string;
}

export interface CreateSavedFilterBody {
    name: string;
    projectId?: string | null;
    params: Record<string, unknown>;
}

export interface MoveTaskBody {
    sectionId: string;
    afterTaskId?: string | null;
    beforeTaskId?: string | null;
    inheritSectionStatus?: boolean;
}

export interface AssignBody {
    userIds: string[];
    mode?: 'replace' | 'add' | 'remove';
}

/**
 * One action over a batch of tasks (max 100 ids, which is what the selection UI caps at).
 * `status`, `sectionId` or `assigneeIds` are required depending on `action`.
 */
export interface BulkTaskBody {
    ids: string[];
    action: 'status' | 'priority' | 'delete' | 'move' | 'assign';
    status?: TaskStatus;
    priority?: TaskPriority;
    sectionId?: string;
    inheritSectionStatus?: boolean;
    assigneeIds?: string[];
    assignMode?: 'add' | 'replace' | 'remove';
}

/** Per-id outcomes: a batch is allowed to partially succeed. */
export interface BulkResultDto {
    updated: string[];
    failed: { id: string; reason: string }[];
}

export interface InviteBody {
    emails: string[];
    role: OrgRole;
    teamIds?: string[];
    projectIds?: string[];
}

// ------------------------------------------------------- integrations & security (Phase 5)

/** Three states a stored credential can be in; derived on the server, rendered as one badge. */
export type CredentialStatus = 'active' | 'expired' | 'revoked';

export type ApiTokenScope = 'read' | 'write' | '*';

/** `GET /auth/tokens` — the caller's own personal access tokens, hash never returned. */
export interface ApiTokenDto {
    id: string;
    name: string;
    scopes: ApiTokenScope[];
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    status: CredentialStatus;
}

/** Create response: `token` is the plaintext, and it appears in this one answer only. */
export interface CreatedApiTokenDto {
    id: string;
    name: string;
    scopes: ApiTokenScope[];
    createdAt: string;
    expiresAt: string | null;
    token: string;
}

export interface CreateApiTokenBody {
    name: string;
    scopes?: ApiTokenScope[];
    expiresInDays?: number;
}

export type WebhookEvent =
    | 'task.created'
    | 'task.updated'
    | 'task.status_changed'
    | 'task.assigned'
    | 'task.completed'
    | 'comment.added'
    | 'project.updated'
    | 'member.added';

export interface WebhookDto {
    id: string;
    orgId: string;
    url: string;
    events: WebhookEvent[];
    active: boolean;
    createdAt: string;
}

/** Create response: `secret` is shown once, exactly like a token. */
export interface CreatedWebhookDto extends WebhookDto {
    secret: string;
}

export interface CreateWebhookBody {
    url: string;
    events: WebhookEvent[];
    active?: boolean;
}

export type UpdateWebhookBody = Partial<CreateWebhookBody>;

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/** One delivery attempt's log row. The body is summarized as a byte count, never returned. */
export interface WebhookDeliveryDto {
    id: string;
    event: string;
    status: WebhookDeliveryStatus;
    attempts: number;
    responseCode: number | null;
    error: string | null;
    createdAt: string;
    nextAttemptAt: string;
    payloadBytes: number;
}

export interface ShareLinkDto {
    id: string;
    scope: 'read';
    projectId: string | null;
    taskId: string | null;
    projectName: string | null;
    taskTitle: string | null;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
    status: CredentialStatus;
}

/** Create response: `url` is ready to paste, `token` is the secret half of it. */
export interface CreatedShareDto {
    id: string;
    orgId: string;
    scope: 'read';
    expiresAt: string;
    createdAt: string;
    url: string;
    token: string;
    projectId: string | null;
    taskId: string | null;
}

export interface CreateShareBody {
    projectId?: string;
    taskId?: string;
    expiresInDays?: number;
}

export type AutomationTriggerEvent = 'task.created' | 'task.status_changed' | 'task.assigned' | 'comment.added';

export type AutomationActionKind = 'set_status' | 'set_priority' | 'assign' | 'add_label' | 'notify' | 'webhook';

/** `value` is shape-dependent: a status, a priority, a user id, a label id or a message. */
export interface AutomationActionDto {
    kind: AutomationActionKind;
    value: string | number | string[];
}

export interface AutomationTriggerDto {
    event: AutomationTriggerEvent;
    conditions?: {
        from?: TaskStatus;
        to?: TaskStatus;
        priority?: TaskPriority;
        hasLabelId?: string;
    };
}

export interface AutomationRuleDto {
    id: string;
    projectId: string;
    name: string;
    active: boolean;
    trigger: AutomationTriggerDto;
    actions: AutomationActionDto[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateAutomationBody {
    name: string;
    trigger: AutomationTriggerDto;
    actions: AutomationActionDto[];
    active?: boolean;
}

export type UpdateAutomationBody = Partial<CreateAutomationBody>;

export interface MfaStatusDto {
    enabled: boolean;
    /** A started-but-never-confirmed setup, so the UI can offer to finish it. */
    pendingSetup: boolean;
    recoveryCodesLeft: number;
}

export interface MfaSetupDto {
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
    currentCode: string;
}

export interface MfaEnableResult {
    enabled: true;
    recoveryCodes: string[];
}

export interface MfaRecoveryResult {
    recoveryCodes: string[];
}

/**
 * `POST /auth/login` answer. A password alone either ends the flow or hands back a challenge
 * that is worth nothing without the second factor — so the union is the whole contract.
 */
export type LoginResult = Session | { mfaRequired: true; challenge: string };

export const isMfaChallenge = (result: LoginResult): result is { mfaRequired: true; challenge: string } =>
    'mfaRequired' in result;

/** `GET /auth/providers` — the sign-in buttons the deployment actually supports. */
export interface SsoProviderDto {
    name: 'google' | 'oidc';
    /** `token` is handled in the browser, `redirect` is a server-side code flow. */
    kind: 'token' | 'redirect';
    label: string;
    clientId: string | null;
}

// --------------------------------------------------------------- public share snapshot

/** Read-only projection served without a credential. Field-for-field what a stranger sees. */
export interface ShareSnapshotTask {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    startDate: string | null;
    estimateMins: number | null;
    isMilestone: boolean;
    kind: TaskKind;
    completedAt: string | null;
    assignees: { name: string; primary: boolean }[];
    labels: { id: string; name: string; color: string }[];
    subtaskCount: number;
}

export interface ShareSnapshotBoardTask {
    id: string;
    title: string;
    status: TaskStatus;
    sectionId: string | null;
    priority: TaskPriority;
    dueDate: string | null;
    startDate: string | null;
    isMilestone: boolean;
    kind: TaskKind;
    isSubtask: boolean;
    assignees: string[];
    labels: { id: string; name: string; color: string }[];
}

export type ShareSnapshot =
    | {
        scope: 'read';
        kind: 'task';
        project: { id: string; name: string; color: string; orgId: string };
        task: ShareSnapshotTask;
    }
    | {
        scope: 'read';
        kind: 'project';
        project: { id: string; name: string; color: string; status: ProjectStatus; description: string | null; orgId: string; taskCount: number; truncated: boolean };
        sections: { id: string; name: string; isDone: boolean; position: number }[];
        tasks: ShareSnapshotBoardTask[];
    };

/**
 * Settings → Audit: the same query the feed accepts, with the filters the panel sets.
 * A type alias rather than an interface on purpose — only aliases get the implicit index
 * signature that `RequestOptions['query']` requires.
 */
export type AuditQuery = {
    limit?: number;
    before?: string;
    userId?: string;
    type?: string;
    from?: string;
    to?: string;
};

// ---------------------------------------------------------------- custom fields (Phase 6)

/** The five shapes a custom field can take. Mirrors `CUSTOM_FIELD_TYPES` in the API. */
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

/**
 * `GET /organizations/:orgId/fields` — a field definition.
 *
 * `projectId` null means the whole workspace sees it; a value means only that project does. The
 * `type` never changes after creation, because every stored value is a plain string and a retyped
 * field would silently reinterpret them.
 */
export interface CustomFieldDto {
    id: string;
    orgId: string;
    projectId: string | null;
    name: string;
    type: CustomFieldType;
    options: string[];
    createdAt: string;
}

/** One stored value. Always a string on the wire, whatever the field type says. */
export interface TaskFieldValueDto {
    fieldId: string;
    value: string;
}

/** `GET /tasks/:id/fields` — everything the drawer's field block needs in one round-trip. */
export interface TaskFieldsDto {
    items: CustomFieldDto[];
    values: TaskFieldValueDto[];
}

export interface CreateCustomFieldBody {
    name: string;
    type: CustomFieldType;
    /** Omit (or null) for a workspace-wide field; managers only. */
    projectId?: string | null;
    options?: string[];
}

/** Rename and re-offer options only — there is no way to change a type in place. */
export interface UpdateCustomFieldBody {
    name?: string;
    options?: string[];
}

/** `PATCH /tasks/:id/fields` body: keys are field ids, `null` or '' clears that field. */
export type TaskFieldValuesBody = Record<string, string | number | boolean | null>;

/**
 * A server-side custom-field filter. The API takes these as a JSON array in `fieldFilters`, which is
 * also exactly how a saved filter stores them, so one shape serves both.
 */
export interface CustomFieldFilterDto {
    fieldId: string;
    value: string | number | boolean;
}
