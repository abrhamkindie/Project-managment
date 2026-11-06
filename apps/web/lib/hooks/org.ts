'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
    fetchActivity,
    fetchActivityFeed,
    fetchInvitations,
    fetchLabels,
    fetchMembers,
    fetchPresence,
    fetchTeams,
    keys,
} from '../queries';
import { useToast } from '~/components/toast';
import type { AuditQuery, InviteBody, OrganizationSummary } from '../types';
import { PRESENCE_POLL_MS, messageOf } from './core';

/** People, teams, labels, invitations, activity — everything workspace-scoped. */

export function useMembers(orgId: string) {
    return useQuery({ queryKey: keys.members(orgId), queryFn: () => fetchMembers(orgId) });
}

/**
 * Who is around in this workspace right now, and when the others were last seen.
 *
 * Online/offline flips arrive over the socket and patch this cache directly (see
 * `lib/realtime.tsx`), so the poll is only a safety net: it re-reads the roster after a socket
 * outage and keeps a `seen 12 minutes ago` label honest on a page nobody reloads.
 */
export function usePresence(orgId: string) {
    const query = useQuery({
        queryKey: keys.presence(orgId),
        queryFn: () => fetchPresence(orgId),
        refetchInterval: PRESENCE_POLL_MS,
    });
    const rows = query.data ?? [];
    const byUser = useMemo(() => new Map(rows.map((row) => [row.userId, row])), [rows]);
    const active = useMemo(() => rows.filter((row) => row.online), [rows]);
    return { ...query, byUser, active, activeCount: active.length };
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

/**
 * Audit log with filters, for the Settings panel.
 *
 * The filters are part of the cache identity, and `before` is a page parameter instead of an edit
 * to them: the API hands back the id of the row it stopped on, so walking backwards never re-reads
 * a row that a fresh write shifted at the top of the feed.
 */
export function useAuditLog(orgId: string, query: AuditQuery) {
    return useInfiniteQuery({
        queryKey: [...keys.activity(orgId), query] as const,
        queryFn: ({ pageParam }) => fetchActivityFeed(orgId, { ...query, before: pageParam }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) => last.nextCursor ?? undefined,
    });
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
