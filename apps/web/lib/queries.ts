import { api, list, page } from './api';
import type {
    ActivityDto,
    AnalyticsOverview,
    AnalyticsQuery,
    AnalyticsWorkload,
    BoardDto,
    InvitationDto,
    LabelDto,
    MemberDto,
    MyTasksGroup,
    NotificationPage,
    NotificationPrefs,
    OrganizationDetail,
    OrganizationSummary,
    PresenceDto,
    ProjectDetailDto,
    ProjectListQuery,
    ProjectSummary,
    Session,
    SessionDto,
    TaskCardDto,
    TaskDetailDto,
    TaskListQuery,
    TeamDto,
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
    tasks: (orgId: string, query?: TaskListQuery) => ['org', orgId, 'tasks', query ?? {}] as const,
    myTasks: (orgId: string) => ['org', orgId, 'myTasks'] as const,
    task: (taskId: string) => ['task', taskId] as const,
    analytics: (orgId: string, query?: AnalyticsQuery) => ['org', orgId, 'analytics', query ?? {}] as const,
    projectAnalytics: (projectId: string, query?: AnalyticsQuery) => ['project', projectId, 'analytics', query ?? {}] as const,
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

// ---------------------------------------------------------------------------- tasks

export const fetchTasks = (orgId: string, query?: TaskListQuery) =>
    page<TaskCardDto>(`/organizations/${orgId}/tasks`, query);

/** Wrapped in `{ groups }` by the API, like every non-paged collection. */
export const fetchMyTasks = (orgId: string) => api.get<{ groups: MyTasksGroup[] }>(`/organizations/${orgId}/my-tasks`);

export const fetchTask = (taskId: string) => api.get<TaskDetailDto>(`/tasks/${taskId}`);

// ------------------------------------------------------------------------ analytics

export const fetchOverview = (orgId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsOverview>(`/organizations/${orgId}/analytics/overview`, { query });

export const fetchProjectOverview = (projectId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsOverview>(`/projects/${projectId}/analytics`, { query });

export const fetchWorkload = (orgId: string, query?: AnalyticsQuery) =>
    api.get<AnalyticsWorkload>(`/organizations/${orgId}/analytics/workload`, { query });

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

// -------------------------------------------------------------------- notifications

export const fetchNotifications = (unreadOnly = false, page = 1, query?: { pageSize?: number }) =>
    api.get<NotificationPage>('/notifications', { query: { ...query, page, unreadOnly } });

export const fetchPreferences = () => api.get<NotificationPrefs>('/notifications/preferences');

/** `GET /api/auth/sessions` — the refresh tokens still valid for this account. */
export const fetchActiveSessions = () => list<SessionDto>('/auth/sessions');
