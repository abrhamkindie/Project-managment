'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '../api';
import { fetchOrganization, fetchSession, keys } from '../queries';
import type { Session } from '../types';

/** Session and workspace identity hooks. */

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
