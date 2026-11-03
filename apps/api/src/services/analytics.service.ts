import { prisma } from '../lib/prisma.js';
import { Forbidden } from '../domain/errors.js';
import { isDoneStatus, isOpenStatus, priorityWeight } from '../domain/enums.js';
import { can, isOverdue, type Access } from '../domain/permissions.js';
import { dayKey, daysAgoStart, weekKey } from '../lib/time.js';
import { visibleProjectIds } from './task.service.js';
import { loadProjectAccess } from './access.js';
import type { AuthUser } from '../types/express.js';
import type { AnalyticsQuery } from '../domain/schemas.js';

/**
 * Reporting.
 *
 * Scope is either the whole organization (managers/admins) or a single project. The
 * default window is the last 30 days. Bucketing and averages are computed in-process
 * over a narrow set of columns instead of dialect-specific SQL, which is what keeps the
 * same code correct on SQLite and PostgreSQL.
 */

interface TaskRow {
    id: string;
    projectId: string;
    status: string;
    priority: string;
    createdAt: Date;
    completedAt: Date | null;
    dueDate: Date | null;
    isMilestone: boolean;
    title: string;
    assignees: { userId: string }[];
}

async function resolveScope(
    user: AuthUser,
    orgId: string,
    projectId?: string,
): Promise<{ projectIds: string[] | 'all'; access: Access }> {
    if (projectId) {
        const { access, project } = await loadProjectAccess(user, projectId);
        if (!can.viewProjectReport(access)) throw new Forbidden('No access to this project report');
        return { projectIds: [project.id], access };
    }
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('Not a member of this organization');
    const access: Access = { userId: user.id, orgRole: membership.role as Access['orgRole'], projectRole: null };
    if (!can.viewOrganizationReport(access)) {
        // Plain members get their own workload report, scoped to projects they can see.
        return { projectIds: await visibleProjectIds(user, orgId), access };
    }
    return { projectIds: 'all', access };
}

export async function overview(user: AuthUser, orgId: string, query: AnalyticsQuery) {
    const now = new Date();
    const to = query.to ?? now;
    const from = query.from ?? daysAgoStart(30, to);
    const { projectIds } = await resolveScope(user, orgId, query.projectId);

    const scopeWhere = {
        deletedAt: null as null,
        project: { orgId, status: query.status },
        ...(projectIds === 'all' ? {} : { projectId: { in: projectIds } }),
        ...(query.teamId ? { project: { orgId, status: query.status, teamId: query.teamId } } : {}),
    };

    const [rows, projectNames] = await Promise.all([
        prisma.task.findMany({
            where: scopeWhere,
            select: {
                id: true,
                projectId: true,
                status: true,
                priority: true,
                createdAt: true,
                completedAt: true,
                dueDate: true,
                isMilestone: true,
                title: true,
                assignees: { select: { userId: true } },
            },
        }),
        prisma.project.findMany({
            where: { orgId, status: query.status, ...(query.teamId ? { teamId: query.teamId } : {}) },
            select: { id: true, name: true, color: true },
        }),
    ]);

    const projectLabel = new Map(projectNames.map((p) => [p.id, p]));
    const inWindow = (date: Date | null) => !!date && date >= from && date <= to;

    const created = rows.filter((t) => inWindow(t.createdAt));
    const completed = rows.filter((t) => inWindow(t.completedAt));
    const open = rows.filter((t) => isOpenStatus(t.status));
    const overdue = open.filter((t) => isOverdue(t.dueDate, t.status, now));
    const dueSoon = open.filter(
        (t) => t.dueDate && !isOverdue(t.dueDate, t.status, now) && t.dueDate.getTime() <= now.getTime() + 7 * 86_400_000,
    );
    const done = rows.filter((t) => isDoneStatus(t.status));

    // Average lead time: created -> completed, for work finished inside the window.
    const leadTimes = completed
        .filter((t) => t.completedAt)
        .map((t) => (t.completedAt as Date).getTime() - t.createdAt.getTime())
        .filter((ms) => ms >= 0);
    const avgCompletionHours = leadTimes.length
        ? Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length / 3_600_000) * 10) / 10
        : null;

    const byStatus = tally(rows, (t) => t.status);
    const byPriority = tally(rows, (t) => t.priority);

    // Throughput: created vs completed per bucket.
    const buckets = new Map<string, { bucket: string; created: number; completed: number }>();
    const keyOf = query.granularity === 'week' ? weekKey : dayKey;
    const touch = (date: Date) => {
        const key = keyOf(date);
        const entry = buckets.get(key) ?? { bucket: key, created: 0, completed: 0 };
        buckets.set(key, entry);
        return entry;
    };
    for (const t of created) touch(t.createdAt).created += 1;
    for (const t of completed) touch(t.completedAt as Date).completed += 1;
    const throughput = [...buckets.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));

    // Workload per person, restricted to people visible in this scope.
    const workload = new Map<string, { open: number; overdue: number; done: number; score: number }>();
    for (const t of rows) {
        for (const a of t.assignees) {
            const entry = workload.get(a.userId) ?? { open: 0, overdue: 0, done: 0, score: 0 };
            if (isOpenStatus(t.status)) {
                entry.open += 1;
                entry.score += 1 + priorityWeight(t.priority);
                if (isOverdue(t.dueDate, t.status, now)) {
                    entry.overdue += 1;
                    entry.score += 2;
                }
            } else if (isDoneStatus(t.status) && inWindow(t.completedAt)) {
                entry.done += 1;
            }
            workload.set(a.userId, entry);
        }
    }
    const people = await prisma.user.findMany({
        where: { id: { in: [...workload.keys()] } },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    const workloadByPerson = people
        .map((p) => ({ user: p, ...(workload.get(p.id) ?? { open: 0, overdue: 0, done: 0, score: 0 }) }))
        .sort((a, b) => b.score - a.score);

    // Per-project health, only meaningful for the organization view.
    const perProject = query.projectId
        ? []
        : projectNames
            .map((project) => {
                const tasks = rows.filter((t) => t.projectId === project.id);
                const finished = tasks.filter((t) => isDoneStatus(t.status)).length;
                const late = tasks.filter((t) => isOpenStatus(t.status) && isOverdue(t.dueDate, t.status, now)).length;
                return {
                    project,
                    total: tasks.length,
                    completed: finished,
                    overdue: late,
                    progress: tasks.length ? Math.round((finished / tasks.length) * 100) : 0,
                    health: healthFor({ total: tasks.length, completed: finished, overdue: late }),
                };
            })
            .filter((p) => p.total > 0)
            .sort((a, b) => b.overdue - a.overdue || a.progress - b.progress);

    const milestones = rows
        .filter((t) => t.isMilestone)
        .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            dueDate: t.dueDate?.toISOString() ?? null,
            project: projectLabel.get(t.projectId)?.name ?? null,
            isOverdue: isOverdue(t.dueDate, t.status, now),
        }))
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));

    return {
        window: { from: from.toISOString(), to: to.toISOString(), granularity: query.granularity },
        totals: {
            tasks: rows.length,
            created: created.length,
            completed: completed.length,
            open: open.length,
            overdue: overdue.length,
            dueSoon: dueSoon.length,
            // Completed vs created inside the window: > 1 means the team is keeping up.
            completionRate: created.length ? Math.round((completed.length / created.length) * 1000) / 10 : null,
            progress: rows.length ? Math.round((done.length / rows.length) * 1000) / 10 : 0,
            avgCompletionHours,
        },
        byStatus,
        byPriority,
        throughput,
        workload: workloadByPerson,
        projects: perProject,
        milestones,
    };
}

function healthFor(input: { total: number; completed: number; overdue: number }): 'on_track' | 'at_risk' | 'off_track' | 'empty' {
    if (input.total === 0) return 'empty';
    if (input.overdue === 0 && input.completed / input.total >= 0.5) return 'on_track';
    if (input.overdue / input.total > 0.25) return 'off_track';
    return 'at_risk';
}

function tally(rows: TaskRow[], key: (row: TaskRow) => string): { key: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    return [...counts.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

/** Who owns what, per person — powers the "Workload" page. */
export async function workload(user: AuthUser, orgId: string, query: AnalyticsQuery) {
    const report = await overview(user, orgId, query);
    return { window: report.window, workload: report.workload };
}
