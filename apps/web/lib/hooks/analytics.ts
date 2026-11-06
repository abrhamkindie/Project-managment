'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchBurndown, fetchCycleCompletion, fetchOverview, fetchProjectOverview, fetchWorkload, keys } from '../queries';
import type { AnalyticsQuery } from '../types';

/** Reporting reads for dashboards and project insights. */

export function useOverview(orgId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.analytics(orgId, query), queryFn: () => fetchOverview(orgId, query) });
}

export function useProjectOverview(projectId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.projectAnalytics(projectId, query), queryFn: () => fetchProjectOverview(projectId, query) });
}

export function useWorkload(orgId: string, query?: AnalyticsQuery) {
    return useQuery({ queryKey: keys.workload(orgId, query), queryFn: () => fetchWorkload(orgId, query) });
}

/** Burndown for one cycle; the query stays off until a cycle is actually picked. */
export function useBurndown(projectId: string, cycleId: string | undefined) {
    return useQuery({
        queryKey: keys.burndown(projectId, cycleId ?? ''),
        queryFn: () => fetchBurndown(projectId, cycleId as string),
        enabled: Boolean(cycleId),
    });
}

/** Velocity trend — scope, completion and logged time per cycle, oldest first. */
export function useCycleCompletion(projectId: string) {
    return useQuery({ queryKey: keys.cycleCompletion(projectId), queryFn: () => fetchCycleCompletion(projectId) });
}
