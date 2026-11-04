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
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    startDate: string | null;
    estimateMins: number | null;
    isMilestone: boolean;
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
    timeline: TimelineEntry[];
}

export interface BoardSectionDto extends SectionDto {
    tasks: TaskCardDto[];
}

export interface BoardDto {
    project: Pick<ProjectSummary, 'id' | 'name' | 'color' | 'visibility' | 'status'>;
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
    done: number;
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
    status?: TaskStatus[] | string;
    priority?: TaskPriority[] | string;
    assigneeId?: string;
    labelId?: string;
    overdue?: boolean;
    includeSubtasks?: boolean;
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
    assigneeIds?: string[];
    labelIds?: string[];
}

export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'projectId' | 'assigneeIds' | 'labelIds'>>;

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

export interface InviteBody {
    emails: string[];
    role: OrgRole;
    teamIds?: string[];
    projectIds?: string[];
}
