import { api, apiHref, list, page } from './api';
import type {
    ActivityDto,
    AnalyticsOverview,
    AnalyticsQuery,
    AnalyticsWorkload,
    ApiTokenDto,
    AutomationRuleDto,
    AuditQuery,
    BoardDto,
    CycleDto,
    CustomFieldDto,
    InvitationDto,
    LabelDto,
    MemberDto,
    MfaStatusDto,
    MyTasksGroup,
    NotificationPage,
    NotificationPrefs,
    OrganizationDetail,
    OrganizationSummary,
    PresenceDto,
    ProjectDetailDto,
    ProjectListQuery,
    ProjectSummary,
    SavedFilterDto,
    Session,
    SessionDto,
    ShareLinkDto,
    ShareSnapshot,
    SsoProviderDto,
    TaskCardDto,
    TaskDetailDto,
    TaskFieldsDto,
    TaskListQuery,
    TaskTimeDto,
    TeamDto,
    WebhookDeliveryDto,
    WebhookDto,
    BurndownDto,
    CycleCompletionRow,
} from './types';

/**
 * Every API path the UI uses, in one place.
 *
 * Components never build a URL by hand, and the key factories below define cache identity
 * for the whole app: invalidating "this project's board" means the same thing everywhere.
 */

export const keys = {
    session: ['session'] as const,
    organizations: ['organizations'] as const,
    organization: (orgId: string) => ['org', orgId, 'detail'] as const,
    projects: (orgId: string, query?: ProjectListQuery) => ['org', orgId, 'projects', query ?? {}] as const,
    project: (projectId: string) => ['project', projectId] as const,
    board: (projectId: string) => ['project', projectId, 'board'] as const,
    cycles: (projectId: string, status?: string) => ['project', projectId, 'cycles', status ?? 'all'] as const,
    filters: (orgId: string) => ['org', orgId, 'filters'] as const,
    tasks: (orgId: string, query?: TaskListQuery) => ['org', orgId, 'tasks', query ?? {}] as const,
    myTasks: (orgId: string) => ['org', orgId, 'myTasks'] as const,
    task: (taskId: string) => ['task', taskId] as const,
    time: (taskId: string) => ['task', taskId, 'time'] as const,
    analytics: (orgId: string, query?: AnalyticsQuery) => ['org', orgId, 'analytics', query ?? {}] as const,
    projectAnalytics: (projectId: string, query?: AnalyticsQuery) => ['project', projectId, 'analytics', query ?? {}] as const,
    burndown: (projectId: string, cycleId: string) => ['project', projectId, 'analytics', 'burndown', cycleId] as const,
    cycleCompletion: (projectId: string) => ['project', projectId, 'analytics', 'cycles'] as const,
    workload: (orgId: string, query?: AnalyticsQuery) => ['org', orgId, 'workload', query ?? {}] as const,
    members: (orgId: string) => ['org', orgId, 'members'] as const,
    presence: (orgId: string) => ['org', orgId, 'presence'] as const,
    invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
    teams: (orgId: string) => ['org', orgId, 'teams'] as const,
    labels: (orgId: string) => ['org', orgId, 'labels'] as const,
    activity: (orgId: string) => ['org', orgId, 'activity'] as const,
    // Page is part of the identity, but defaults to 1 so the bell and the inbox share one entry.
    notifications: (unreadOnly: boolean, page = 1) => ['notifications', unreadOnly, page] as const,
    preferences: ['preferences'] as const,
    activeSessions: ['auth', 'sessions'] as const,
    // Integrations & security (Phase 5). Tokens and MFA status belong to the person, so they
    // carry no org id; webhooks, shares and the audit log belong to a workspace.
    apiTokens: ['auth', 'tokens'] as const,
    mfaStatus: ['auth', 'mfa'] as const,
    ssoProviders: ['auth', 'providers'] as const,
    webhooks: (orgId: string) => ['org', orgId, 'webhooks'] as const,
    webhookDeliveries: (orgId: string, webhookId: string, pageNumber: number) =>
        ['org', orgId, 'webhooks', webhookId, 'deliveries', pageNumber] as const,
    shares: (orgId: string) => ['org', orgId, 'shares'] as const,
    automations: (projectId: string) => ['project', projectId, 'automations'] as const,
    // Custom fields (Phase 6). The definition list is keyed by scope, because a project screen wants
    // "workspace-wide + this project's" while settings wants the workspace-wide set alone.
    fields: (orgId: string, projectId?: string | null) => ['org', orgId, 'fields', projectId ?? ''] as const,
    taskFields: (taskId: string) => ['task', taskId, 'fields'] as const,
};

// -------------------------------------------------------------------------- session

export const fetchSession = () => api.get<Session>('/auth/me');

export const fetchOrganizations = () => list<OrganizationSummary>('/organizations');

export const fetchOrganization = (orgId: string) => api.get<OrganizationDetail>(`/organizations/${orgId}`);

/**
 * Step 1 of password recovery. The answer is identical whether or not the address exists,
 * so this returns a message to show rather than a truth to branch on.
 */
export const requestPasswordReset = (email: string) =>
    api.post<{ ok: true; message: string }>('/auth/forgot-password', { email });

/** Step 2 pre-flight: is the link in this URL still usable, and for which masked address? */
export const fetchPasswordResetState = (token: string) =>
    api.get<{ valid: boolean; email?: string }>('/auth/password-reset', { query: { token } });

// ------------------------------------------------------------------------ projects

export const fetchProjects = (orgId: string, query?: ProjectListQuery) =>
    page<ProjectSummary>(`/organizations/${orgId}/projects`, query);

export const fetchProject = (projectId: string) => api.get<ProjectDetailDto>(`/projects/${projectId}`);

export const fetchBoard = (projectId: string) => api.get<BoardDto>(`/projects/${projectId}/board`);

/** Cycles ride under the project; `status` filters server-side (undefined = all). */
export const fetchCycles = (projectId: string, status?: string) =>
    list<CycleDto>(`/projects/${projectId}/cycles`, status ? { status } : undefined);

export const fetchSavedFilters = (orgId: string) =>
    list<SavedFilterDto>(`/organizations/${orgId}/filters`);

// ---------------------------------------------------------------------------- tasks

export const fetchTasks = (orgId: string, query?: TaskListQuery) =>
    page<TaskCardDto>(`/organizations/${orgId}/tasks`, query);

/** Wrapped in `{ groups }` by the API, like every non-paged collection. */
export const fetchMyTasks = (orgId: string) => api.get<{ groups: MyTasksGroup[] }>(`/organizations/${orgId}/my-tasks`);

export const fetchTask = (taskId: string) => api.get<TaskDetailDto>(`/tasks/${taskId}`);

/** `GET /tasks/:id/time` — the drawer's timer list, running state and logged-vs-estimate totals. */
export const fetchTaskTime = (taskId: string) => api.get<TaskTimeDto>(`/tasks/${taskId}/time`);

// --------------------------------------------------------------------- custom fields

/** Definitions visible to the caller: workspace-wide, or that set plus one project's own. */
export const fetchCustomFields = (orgId: string, projectId?: string | null) =>
    list<CustomFieldDto>(`/organizations/${orgId}/fields`, projectId ? { projectId } : undefined);

/** What this task may carry and what it already holds — one call paints the drawer block. */
export const fetchTaskFields = (taskId: string) => api.get<TaskFieldsDto>(`/tasks/${taskId}/fields`);

// ------------------------------------------------------------------------ analytics

export const fetchOverview = (orgId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsOverview>(`/organizations/${orgId}/analytics/overview`, { query });

export const fetchProjectOverview = (projectId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsOverview>(`/projects/${projectId}/analytics`, { query });

export const fetchWorkload = (orgId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsWorkload>(`/organizations/${orgId}/analytics/workload`, { query });

/** Burndown for one cycle. `cycleId` is required by the API. */
export const fetchBurndown = (projectId: string, cycleId: string) =>
    api.get<BurndownDto>(`/projects/${projectId}/analytics/burndown`, { query: { cycleId } });

/** Velocity trend: one row per cycle, oldest first. */
export const fetchCycleCompletion = (projectId: string) =>
    api.get<{ cycles: CycleCompletionRow[] }>(`/projects/${projectId}/analytics/cycles`);

// --------------------------------------------------------------------- organization

export const fetchMembers = (orgId: string) => list<MemberDto>(`/organizations/${orgId}/members`);

/**
 * Who is around. Read separately from the directory because the two change at wildly
 * different speeds: a roster almost never, presence every minute.
 */
export const fetchPresence = (orgId: string) => list<PresenceDto>(`/organizations/${orgId}/presence`);

export const fetchInvitations = (orgId: string) => list<InvitationDto>(`/organizations/${orgId}/invitations`);

export const fetchTeams = (orgId: string) => list<TeamDto>(`/organizations/${orgId}/teams`);

export const fetchLabels = (orgId: string) => list<LabelDto>(`/organizations/${orgId}/labels`);

export const fetchActivity = (orgId: string, limit = 40) => list<ActivityDto>(`/organizations/${orgId}/activity`, { limit });

/**
 * Audit feed with the panel's filters. Separate from `fetchActivity` only because the cursor
 * matters here: the Settings screen pages backwards through history, the dashboard feed does not.
 */
export const fetchActivityFeed = (orgId: string, query?: AuditQuery) =>
    api.get<{ items: ActivityDto[]; nextCursor: string | null }>(`/organizations/${orgId}/activity`, { query });

/** `<a href>` for the audit CSV — the browser attaches the cookie itself, so no fetch is involved. */
export function auditExportHref(orgId: string, query: AuditQuery = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const encoded = params.toString();
    return apiHref(`/organizations/${orgId}/activity/export${encoded ? `?${encoded}` : ''}`);
}

// ------------------------------------------------------------- integrations & security

export const fetchApiTokens = () => list<ApiTokenDto>('/auth/tokens');

export const fetchMfaStatus = () => api.get<MfaStatusDto>('/auth/mfa');

/** Which sign-in buttons the deployment can actually honour. */
export const fetchSsoProviders = () => list<SsoProviderDto>('/auth/providers');

export const fetchWebhooks = (orgId: string) => list<WebhookDto>(`/organizations/${orgId}/webhooks`);

/** Delivery log, newest first. `pageNumber` is 1-based, like every other page in the API. */
export const fetchWebhookDeliveries = (orgId: string, webhookId: string, pageNumber = 1) =>
    page<WebhookDeliveryDto>(`/organizations/${orgId}/webhooks/${webhookId}/deliveries`, { page: pageNumber });

/** Only the caller's own links; the API has no "see who else shared what". */
export const fetchShares = (orgId: string) => list<ShareLinkDto>(`/organizations/${orgId}/shares`);

export const fetchAutomationRules = (projectId: string) =>
    list<AutomationRuleDto>(`/projects/${projectId}/automations`);

/**
 * The anonymous read behind a share link. It needs no session, so it is the one call that must
 * not trigger the refresh-and-retry dance — a visitor with no cookies at all would refresh forever.
 */
export const fetchShareSnapshot = (token: string) =>
    api.get<ShareSnapshot>(`/public/shares/${token}`, { retryOn401: false });

// -------------------------------------------------------------------- notifications

export const fetchNotifications = (unreadOnly = false, page = 1, query?: { pageSize?: number }) =>
    api.get<NotificationPage>('/notifications', { query: { ...query, page, unreadOnly } });

export const fetchPreferences = () => api.get<NotificationPrefs>('/notifications/preferences');

/** `GET /api/auth/sessions` — the refresh tokens still valid for this account. */
export const fetchActiveSessions = () => list<SessionDto>('/auth/sessions');
