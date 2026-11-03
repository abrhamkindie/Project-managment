'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, api } from './api';
import {
    fetchActivity,
    fetchActiveSessions,
    fetchBoard,
    fetchInvitations,
    fetchLabels,
    fetchMembers,
    fetchMyTasks,
    fetchNotifications,
    fetchOrganization,
    fetchOverview,
    fetchPreferences,
    fetchProject,
    fetchProjectOverview,
    fetchProjects,
    fetchSession,
    fetchTask,
    fetchTasks,
    fetchTeams,
    fetchWorkload,
    keys,
} from './queries';
import { useToast } from '~/components/toast';
import { mergeTaskIntoBoard, removeTaskFromBoard } from './board-cache';
import { homeFor } from './paths';
import type {
    AnalyticsQuery,
    AssignBody,
    BoardDto,
    CreateProjectBody,
    CreateTaskBody,
    InviteBody,
    MoveTaskBody,
    NotificationPrefs,
    OrganizationSummary,
    ProjectListQuery,
    ProjectStatus,
    ProjectSummary,
    Session,
    TaskCardDto,
    TaskDetailDto,
    TaskListQuery,
    UpdateProjectBody,
    UpdateTaskBody,
} from './types';

/**
 * Data layer: one hook per screen concern, all cache identity from `lib/queries.keys`.
 *
 * Mutations follow one shape — call the API, patch the caches the result belongs to,
 * surface errors as a toast — so behaviour is identical wherever a task is edited.
 */

const DEFAULT_STALE_TIME = 30_000;

/** Boards and inboxes change while a tab is open, so they are never considered fresh for long. */
export const queryDefaults = {
    queries: { staleTime: DEFAULT_STALE_TIME, refetchOnWindowFocus: true, retry: (failureCount: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && failureCount < 2 },
};

// -------------------------------------------------------------------------- session

export function useSession() {
    return useQuery({ queryKey: keys.session, queryFn: fetchSession, staleTime: 60_000 });
}

export function useWorkspace(orgId: string) {
    return useQuery({ queryKey: keys.organization(orgId), queryFn: () => fetchOrganization(orgId) });
}

/** Role of the current user in this workspace, for show/hide of admin affordances. */
export function useMyRole(session: Session | undefined, orgId: string) {
    return session?.organizations.find((org) => org.id === orgId)?.role;
}

export function useLogout() {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: () => api.post<{ ok: boolean }>('/auth/logout'),
        onSuccess: () => {
            client.clear();
            router.replace('/login');
        },
    });
}

// ------------------------------------------------------------------------ projects

export function useProjects(orgId: string, query?: ProjectListQuery) {
    return useQuery({ queryKey: keys.projects(orgId, query), queryFn: () => fetchProjects(orgId, query), placeholderData: keepPrevious });
}

export function useProject(projectId: string) {
    return useQuery({ queryKey: keys.project(projectId), queryFn: () => fetchProject(projectId) });
}

export function useBoard(projectId: string) {
    return useQuery({ queryKey: keys.board(projectId), queryFn: () => fetchBoard(projectId) });
}

export function useCreateProject(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateProjectBody) => api.post<ProjectSummary>(`/organizations/${orgId}/projects`, body),
        onSuccess: (project) => {
            void client.invalidateQueries({ queryKey: keys.projects(orgId) });
            void client.invalidateQueries({ queryKey: keys.activity(orgId) });
            toast.success(`Project “${project.name}” created`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateProject(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: UpdateProjectBody) => api.patch<ProjectSummary>(`/projects/${projectId}`, body),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.project(projectId) });
            void client.invalidateQueries({ queryKey: keys.board(projectId) });
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Archive / restore: same endpoint, different `status`. */
export function useSetProjectStatus(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ projectId, status }: { projectId: string; status: ProjectStatus }) =>
            api.patch<{ id: string }>(`/projects/${projectId}`, { status }),
        onSuccess: (_result, variables) => {
            void client.invalidateQueries({ queryKey: keys.projects(orgId) });
            void client.invalidateQueries({ queryKey: keys.project(variables.projectId) });
            toast.success(variables.status === 'archived' ? 'Project archived' : 'Project restored');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useDeleteProject(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (projectId: string) => api.del<{ id: string }>(`/projects/${projectId}`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.projects(orgId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
            toast.success('Project deleted');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useProjectMembers(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return {
        add: useMutation({
            mutationFn: (body: { userIds: string[]; role?: 'lead' | 'member' }) => api.post<unknown>(`/projects/${projectId}/members`, body),
            onSuccess: () => {
                void client.invalidateQueries({ queryKey: keys.project(projectId) });
                toast.success('Members added');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (userId: string) => api.del<{ id: string }>(`/projects/${projectId}/members/${userId}`),
            onSuccess: () => void client.invalidateQueries({ queryKey: keys.project(projectId) }),
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

// ------------------------------------------------------------------------ sections

export function useSections(projectId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return {
        create: useMutation({
            mutationFn: (body: { name: string; afterSectionId?: string | null; isDone?: boolean }) =>
                api.post<{ id: string }>(`/projects/${projectId}/sections`, body),
            onSuccess: () => invalidateBoard(client, projectId),
            onError: (error) => toast.error(messageOf(error)),
        }),
        update: useMutation({
            mutationFn: (body: { sectionId: string; patch: { name?: string; isDone?: boolean } }) =>
                api.patch<{ id: string }>(`/sections/${body.sectionId}`, body.patch),
            onSuccess: () => invalidateBoard(client, projectId),
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (sectionId: string) => api.del<{ id: string }>(`/sections/${sectionId}`),
            onSuccess: () => invalidateBoard(client, projectId),
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

// ---------------------------------------------------------------------------- tasks

export function useTasks(orgId: string, query?: TaskListQuery) {
    return useQuery({ queryKey: keys.tasks(orgId, query), queryFn: () => fetchTasks(orgId, query), placeholderData: keepPrevious });
}

export function useMyTasks(orgId: string) {
    return useQuery({ queryKey: keys.myTasks(orgId), queryFn: () => fetchMyTasks(orgId) });
}

export function useTask(taskId: string | undefined) {
    return useQuery({ queryKey: keys.task(taskId ?? ''), queryFn: () => fetchTask(taskId as string), enabled: Boolean(taskId) });
}

/** Board-aware task mutations: a card edit must land in the column cache too. */
export function useCreateTask(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: CreateTaskBody) => api.post<TaskCardDto>(`/organizations/${orgId}/tasks`, body),
        onSuccess: (task) => {
            applyTaskToCaches(client, task);
            void client.invalidateQueries({ queryKey: keys.activity(orgId) });
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useUpdateTask() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, patch }: { taskId: string; patch: UpdateTaskBody }) => api.patch<TaskCardDto>(`/tasks/${taskId}`, patch),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useMoveTask() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, move }: { taskId: string; move: MoveTaskBody }) => api.post<TaskCardDto>(`/tasks/${taskId}/move`, move),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useSetAssignees() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ taskId, body }: { taskId: string; body: AssignBody }) => api.put<TaskCardDto>(`/tasks/${taskId}/assignees`, body),
        onSuccess: (task) => applyTaskToCaches(client, task),
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useSetLabels() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, labelIds }: { taskId: string; labelIds: string[] }) => api.put<TaskCardDto>(`/tasks/${taskId}/labels`, { labelIds }),
        onSuccess: (task) => applyTaskToCaches(client, task),
    });
}

export function useDeleteTask(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (taskId: string) => api.del<{ id: string }>(`/tasks/${taskId}`),
        onSuccess: (_result, taskId) => {
            // The delete acknowledgement carries no project, so the column it was in comes from
            // whichever cache still holds the card; without it we just wait for the board refetch.
            const projectId = client.getQueryData<TaskDetailDto>(keys.task(taskId))?.projectId;
            if (projectId) {
                client.setQueryData(keys.board(projectId), (board: BoardDto | undefined) => (board ? removeTaskFromBoard(board, taskId) : board));
                void client.invalidateQueries({ queryKey: keys.project(projectId) });
            }
            client.removeQueries({ queryKey: keys.task(taskId) });
            void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
            toast.success('Task deleted');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

// ------------------------------------------------------------------- task detail bits

export function useComments(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    const refresh = () => client.invalidateQueries({ queryKey: keys.task(taskId) });
    return {
        add: useMutation({
            mutationFn: (body: string) => api.post<unknown>(`/tasks/${taskId}/comments`, { body }),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        edit: useMutation({
            mutationFn: ({ commentId, body }: { commentId: string; body: string }) => api.patch<unknown>(`/comments/${commentId}`, { body }),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (commentId: string) => api.del<{ id: string }>(`/comments/${commentId}`),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

export function useAttachments(taskId: string) {
    const client = useQueryClient();
    const toast = useToast();
    const refresh = () => client.invalidateQueries({ queryKey: keys.task(taskId) });
    return {
        upload: useMutation({
            mutationFn: (file: File) => {
                const form = new FormData();
                form.append('file', file);
                return api.upload<unknown>(`/tasks/${taskId}/attachments`, form);
            },
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
        remove: useMutation({
            mutationFn: (attachmentId: string) => api.del<{ id: string }>(`/tasks/${taskId}/attachments/${attachmentId}`),
            onSuccess: refresh,
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

// ------------------------------------------------------------------------ analytics

export function useOverview(orgId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.analytics(orgId, query), queryFn: () => fetchOverview(orgId, query) });
}

export function useProjectOverview(projectId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.projectAnalytics(projectId, query), queryFn: () => fetchProjectOverview(projectId, query) });
}

export function useWorkload(orgId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.workload(orgId, query), queryFn: () => fetchWorkload(orgId, query) });
}

// --------------------------------------------------------------------- organization

export function useMembers(orgId: string) {
    return useQuery({ queryKey: keys.members(orgId), queryFn: () => fetchMembers(orgId) });
}

/**
 * The workspace as a flat list of people, which is what every picker needs.
 *
 * Deactivated accounts are left out: they can still appear in old assignee lists, but handing
 * them new work is never the intent of a click.
 */
export function usePeople(orgId: string) {
    const members = useMembers(orgId);
    const people = useMemo(
        () => (members.data ?? []).filter((member) => member.user.isActive).map((member) => member.user),
        [members.data],
    );
    return { ...members, people };
}

export function useInvitations(orgId: string, enabled = true) {
    return useQuery({ queryKey: keys.invitations(orgId), queryFn: () => fetchInvitations(orgId), enabled });
}

export function useTeams(orgId: string) {
    return useQuery({ queryKey: keys.teams(orgId), queryFn: () => fetchTeams(orgId) });
}

export function useLabels(orgId: string) {
    return useQuery({ queryKey: keys.labels(orgId), queryFn: () => fetchLabels(orgId) });
}

export function useActivity(orgId: string) {
    return useQuery({ queryKey: keys.activity(orgId), queryFn: () => fetchActivity(orgId) });
}

export function useInviteMembers(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (body: InviteBody) => api.post<{ items: unknown[] }>(`/organizations/${orgId}/invitations`, body),
        onSuccess: (result) => {
            void client.invalidateQueries({ queryKey: keys.invitations(orgId) });
            void client.invalidateQueries({ queryKey: keys.members(orgId) });
            toast.success(`${result.items.length} ${result.items.length === 1 ? 'invitation' : 'invitations'} sent`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

export function useWorkspaceAdmin(orgId: string) {
    const client = useQueryClient();
    const toast = useToast();
    return {
        rename: useMutation({
            mutationFn: (name: string) => api.patch<unknown>(`/organizations/${orgId}`, { name }),
            onSuccess: () => {
                void client.invalidateQueries({ queryKey: keys.session });
                void client.invalidateQueries({ queryKey: keys.organization(orgId) });
                toast.success('Workspace renamed');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        setRole: useMutation({
            mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'manager' | 'member' }) =>
                api.patch<{ id: string }>(`/organizations/${orgId}/members/${userId}`, { role }),
            onSuccess: () => {
                void client.invalidateQueries({ queryKey: keys.members(orgId) });
                void client.invalidateQueries({ queryKey: keys.session });
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        removeMember: useMutation({
            mutationFn: (userId: string) => api.del<{ id: string }>(`/organizations/${orgId}/members/${userId}`),
            onSuccess: () => {
                void client.invalidateQueries({ queryKey: keys.members(orgId) });
                void client.invalidateQueries({ queryKey: keys.myTasks(orgId) });
                toast.success('Member removed');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        revokeInvitation: useMutation({
            mutationFn: (invitationId: string) => api.del<{ id: string }>(`/organizations/${orgId}/invitations/${invitationId}`),
            onSuccess: () => void client.invalidateQueries({ queryKey: keys.invitations(orgId) }),
            onError: (error) => toast.error(messageOf(error)),
        }),
        createTeam: useMutation({
            mutationFn: (body: { name: string; memberIds?: string[] }) => api.post<{ id: string }>(`/organizations/${orgId}/teams`, body),
            onSuccess: () => void client.invalidateQueries({ queryKey: keys.teams(orgId) }),
            onError: (error) => toast.error(messageOf(error)),
        }),
        setTeamMembers: useMutation({
            mutationFn: ({ teamId, userIds }: { teamId: string; userIds: string[] }) =>
                api.put<{ id: string }>(`/organizations/${orgId}/teams/${teamId}/members`, { userIds }),
            onSuccess: () => {
                void client.invalidateQueries({ queryKey: keys.teams(orgId) });
                void client.invalidateQueries({ queryKey: keys.members(orgId) });
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        createLabel: useMutation({
            mutationFn: (body: { name: string; color?: string; projectId?: string | null }) => api.post<{ id: string }>(`/organizations/${orgId}/labels`, body),
            onSuccess: () => void client.invalidateQueries({ queryKey: keys.labels(orgId) }),
            onError: (error) => toast.error(messageOf(error)),
        }),
        deleteLabel: useMutation({
            mutationFn: (labelId: string) => api.del<{ id: string }>(`/organizations/${orgId}/labels/${labelId}`),
            onSuccess: () => void client.invalidateQueries({ queryKey: keys.labels(orgId) }),
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

/**
 * Creating a workspace is not scoped to one, so it lives outside `useWorkspaceAdmin`: the
 * onboarding screen and the switcher menu both call it before a slug exists.
 */
export function useCreateOrganization() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (name: string) => api.post<OrganizationSummary>('/organizations', { name }),
        onSuccess: (organization) => {
            // The session envelope carries the membership list, which is what the switcher reads.
            void client.invalidateQueries({ queryKey: keys.session });
            void client.invalidateQueries({ queryKey: keys.organizations });
            toast.success(`${organization.name} is ready`);
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

// -------------------------------------------------------------------- notifications

export function useNotifications(unreadOnly = false, page = 1) {
    return useQuery({ queryKey: keys.notifications(unreadOnly, page), queryFn: () => fetchNotifications(unreadOnly, page) });
}

export function useMarkNotificationsRead() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (ids?: string[]) => api.post<{ updated: number }>('/notifications/read', { ids }),
        onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    });
}

export function useDeleteNotification() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.del<{ id: string }>(`/notifications/${id}`),
        onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    });
}

export function usePreferences() {
    return useQuery({ queryKey: keys.preferences, queryFn: fetchPreferences });
}

export function useUpdatePreferences() {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: (prefs: Partial<NotificationPrefs>) => api.put<NotificationPrefs>('/notifications/preferences', { prefs }),
        onSuccess: (merged) => {
            // The API returns the full merged object, so no refetch is needed.
            client.setQueryData(keys.preferences, merged);
            void client.invalidateQueries({ queryKey: keys.session });
            toast.success('Notification preferences saved');
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

/** Active refresh tokens, so an unfamiliar device can be seen before it is revoked. */
export function useSessions() {
    return useQuery({ queryKey: keys.activeSessions, queryFn: fetchActiveSessions });
}

export function useProfile() {
    const client = useQueryClient();
    const toast = useToast();
    const router = useRouter();
    return {
        update: useMutation({
            mutationFn: (body: { firstName?: string; lastName?: string; timezone?: string; avatarUrl?: string | null }) =>
                api.patch<Session>('/auth/profile', body),
            onSuccess: (session) => {
                client.setQueryData(keys.session, session);
                toast.success('Profile updated');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        changePassword: useMutation({
            mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<{ ok: boolean }>('/auth/password', body),
            onSuccess: () => {
                client.clear();
                toast.success('Password changed — sign in again');
                router.replace('/login');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
        revokeAllSessions: useMutation({
            mutationFn: () => api.del<{ ok: boolean }>('/auth/sessions'),
            onSuccess: () => {
                client.clear();
                router.replace('/login');
            },
            onError: (error) => toast.error(messageOf(error)),
        }),
    };
}

// ---------------------------------------------------------------------------- auth

export function useLogin(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { email: string; password: string }) => api.post<Session>('/auth/login', body, { retryOn401: false }),
        onSuccess: (session) => {
            client.setQueryData(keys.session, session);
            // A `redirectTo` arrives from the query string (an invitation link, a deep link), and
            // `safeNext` has already proven it is an internal path.
            router.replace(redirectTo ?? homeFor(session));
        },
    });
}

export function useRegister(redirectTo?: string) {
    const client = useQueryClient();
    const router = useRouter();
    return useMutation({
        mutationFn: (body: { email: string; password: string; firstName: string; lastName: string; organizationName?: string }) =>
            api.post<Session>('/auth/register', body, { retryOn401: false }),
        onSuccess: (session) => {
            client.setQueryData(keys.session, session);
            router.replace(redirectTo ?? homeFor(session));
        },
    });
}

/**
 * Silent session restore for the signed-out screens.
 *
 * A page can be reached with an expired 15-minute access token and a valid refresh token, and
 * only the browser may rotate it — the `Set-Cookie` has to land in the visitor's jar. Success
 * means the app can skip the login form entirely; the endpoint answers with the same session
 * envelope as `GET /auth/me`, so one call is enough.
 *
 * The in-flight promise is shared on purpose: React StrictMode runs effects twice in development,
 * and a second replay of a single-use refresh token would look like token theft and revoke every
 * session for that user.
 */
let restoreInFlight: Promise<Session | null> | null = null;

export function restoreSession(): Promise<Session | null> {
    restoreInFlight ??= api
        .post<Session>('/auth/refresh', undefined, { retryOn401: false })
        .catch(() => null)
        .finally(() => {
            restoreInFlight = null;
        });
    return restoreInFlight;
}

export function useAcceptInvitation() {
    const client = useQueryClient();
    const router = useRouter();
    const toast = useToast();
    return useMutation({
        mutationFn: (token: string) => api.post<{ orgId: string; name: string; role: string }>('/organizations/invitations/accept', { token }),
        onSuccess: async (result) => {
            const session = await fetchSession();
            client.setQueryData(keys.session, session);
            // Land in the workspace that was joined, not in whichever one happens to be first.
            const joined = session?.organizations.find((org) => org.id === result.orgId);
            toast.success(`You joined ${result.name}`);
            router.replace(joined ? `/w/${joined.slug}/dashboard` : homeFor(session ?? { organizations: [] }));
        },
        onError: (error) => toast.error(messageOf(error)),
    });
}

// ----------------------------------------------------------------------- utilities

/** Errors are always `ApiError`s from the API envelope; anything else is a network failure. */
export function messageOf(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    if (error instanceof Error) return error.message;
    return 'Something went wrong';
}

function keepPrevious<T>(previous: T | undefined) {
    return previous;
}

/**
 * Debounced value, used for search boxes: every keystroke would otherwise be a new query key
 * and a new request.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}

function invalidateBoard(client: QueryClient, projectId: string) {
    void client.invalidateQueries({ queryKey: keys.board(projectId) });
    void client.invalidateQueries({ queryKey: keys.project(projectId) });
}

/**
 * Applies a task mutation response to every cache that holds the card.
 *
 * The board cache is patched in place — a refetch would flash the column the user is looking
 * at — the detail cache is merged so an open drawer updates instantly, and the aggregate
 * project counters are marked stale because status or position probably moved.
 */
export function applyTaskToCaches(client: QueryClient, task: TaskCardDto) {
    client.setQueryData(keys.board(task.projectId), (board: BoardDto | undefined) => (board ? mergeTaskIntoBoard(board, task) : board));
    client.setQueryData(keys.task(task.id), (detail: TaskDetailDto | undefined) => (detail ? { ...detail, ...task } : detail));
    void client.invalidateQueries({ queryKey: keys.project(task.projectId) });
}
