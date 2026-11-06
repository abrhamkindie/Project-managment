'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fetchBoard, fetchProject, fetchProjects, keys } from '../queries';
import { useToast } from '~/components/toast';
import type { CreateProjectBody, ProjectListQuery, ProjectStatus, ProjectSummary, UpdateProjectBody } from '../types';
import { invalidateBoard, keepPrevious, messageOf } from './core';

/** Projects, board reads and project-scoped administration. */

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
