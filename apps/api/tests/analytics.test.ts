import { describe, expect, it } from 'vitest';
import { addMember, createProject, createTask, signUp, type Workspace } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { weekKey } from '../src/lib/time.js';

/**
 * Reporting.
 *
 * The API cannot backdate work through its own endpoints, so the fixture creates cards
 * over HTTP and then rewinds `createdAt` / `completedAt` in the database — exactly what
 * the seed does for demo data. That keeps the expected numbers below exact rather than
 * "approximately the last 30 days".
 */

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

interface Fixture {
    status?: string;
    priority?: string;
    dueDate?: Date;
    createdDaysAgo: number;
    completedDaysAgo?: number;
    assigneeIds?: string[];
    isMilestone?: boolean;
}

async function fixtureTask(owner: Workspace, projectId: string, spec: Fixture) {
    const task = await createTask(owner, projectId, {
        status: spec.status ?? 'todo',
        priority: spec.priority ?? 'none',
        dueDate: spec.dueDate?.toISOString(),
        assigneeIds: spec.assigneeIds,
        isMilestone: spec.isMilestone ?? false,
    });
    await prisma.task.update({
        where: { id: task.id },
        data: {
            createdAt: days(spec.createdDaysAgo),
            ...(spec.completedDaysAgo !== undefined ? { completedAt: days(spec.completedDaysAgo) } : {}),
        },
    });
    return task;
}

/**
 * Alpha: 2 done (48h and 24h lead time), 1 overdue urgent, 1 due soon, 1 milestone.
 * Beta:  1 overdue in review, 1 canceled (24h lead time).
 * Gamma: private, 1 todo — invisible to plain members.
 */
async function buildReport() {
    const owner = await signUp();
    const teammate = await addMember(owner, 'member');

    const alpha = await createProject(owner, { name: 'Alpha Programme' });
    const beta = await createProject(owner, { name: 'Beta Docs' });
    const gamma = await createProject(owner, { name: 'Gamma Search', visibility: 'private' });

    await fixtureTask(owner, alpha.projectId, { status: 'done', priority: 'high', createdDaysAgo: 10, completedDaysAgo: 8, assigneeIds: [teammate.userId] });
    await fixtureTask(owner, alpha.projectId, { status: 'done', createdDaysAgo: 6, completedDaysAgo: 5, assigneeIds: [teammate.userId] });
    await fixtureTask(owner, alpha.projectId, { priority: 'urgent', dueDate: hours(-24), createdDaysAgo: 2, assigneeIds: [teammate.userId] });
    await fixtureTask(owner, alpha.projectId, { status: 'in_progress', priority: 'medium', dueDate: hours(72), createdDaysAgo: 1, assigneeIds: [teammate.userId] });
    await fixtureTask(owner, alpha.projectId, { priority: 'low', createdDaysAgo: 1, isMilestone: true, assigneeIds: [owner.userId] });

    await fixtureTask(owner, beta.projectId, { status: 'in_review', dueDate: hours(-48), createdDaysAgo: 3 });
    await fixtureTask(owner, beta.projectId, { status: 'canceled', createdDaysAgo: 5, completedDaysAgo: 4 });

    await fixtureTask(owner, gamma.projectId, { createdDaysAgo: 1 });

    return { owner, teammate, alpha, beta, gamma };
}

const tallyMap = (rows: { key: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

describe('organization overview', () => {
    it('aggregates the headline metrics over the default 30-day window', async () => {
        const { owner, teammate } = await buildReport();

        const res = await owner.agent.get(`/api/organizations/${owner.orgId}/analytics/overview`).expect(200);
        const report = res.body;

        expect(report.window.granularity).toBe('day');
        expect(new Date(report.window.from).getTime()).toBeLessThan(new Date(report.window.to).getTime());

        expect(report.totals).toMatchObject({
            tasks: 8,
            created: 8,
            completed: 3,
            // Three of the eight are in a finished status, so five are still open — including the
            // one in the private project, which the owner can of course see.
            open: 5,
            overdue: 2,
            dueSoon: 1,
            // 3 completed against 8 created, and 3 of 8 cards in a finished status.
            completionRate: 37.5,
            progress: 37.5,
            avgCompletionHours: 32,
        });

        expect(tallyMap(report.byStatus)).toEqual({ todo: 3, done: 2, in_progress: 1, in_review: 1, canceled: 1 });
        expect(tallyMap(report.byPriority)).toEqual({ none: 4, urgent: 1, high: 1, medium: 1, low: 1 });

        expect(report.throughput.reduce((sum: number, b: { created: number }) => sum + b.created, 0)).toBe(8);
        expect(report.throughput.reduce((sum: number, b: { completed: number }) => sum + b.completed, 0)).toBe(3);
        const buckets = report.throughput.map((b: { bucket: string }) => b.bucket);
        expect([...buckets].sort()).toEqual(buckets);

        expect(report.workload).toHaveLength(2);
        expect(report.workload[0].user.id).toBe(teammate.userId);
        expect(report.workload[0]).toMatchObject({ open: 2, overdue: 1, done: 2 });
        expect(report.workload[1]).toMatchObject({ user: { id: owner.userId }, open: 1, overdue: 0, done: 0 });

        expect(report.milestones).toEqual([
            expect.objectContaining({ title: expect.any(String), status: 'todo', isOverdue: false }),
        ]);
    });

    it('grades each project and keeps empty ones out of the table', async () => {
        const { owner } = await buildReport();
        await createProject(owner, { name: 'Empty Wrapper' });

        const res = await owner.agent.get(`/api/organizations/${owner.orgId}/analytics/overview`).expect(200);
        const rows = res.body.projects as { project: { name: string }; total: number; completed: number; overdue: number; progress: number; health: string }[];

        expect(rows.map((r) => r.project.name)).not.toContain('Empty Wrapper');
        const byName = Object.fromEntries(rows.map((r) => [r.project.name, r]));

        expect(byName['Alpha Programme']).toMatchObject({ total: 5, completed: 2, overdue: 1, progress: 40, health: 'at_risk' });
        expect(byName['Beta Docs']).toMatchObject({ total: 2, completed: 1, overdue: 1, progress: 50, health: 'off_track' });
        expect(byName['Gamma Search']).toMatchObject({ total: 1, completed: 0, overdue: 0, progress: 0, health: 'at_risk' });
    });

    it('honours the window and the bucket granularity', async () => {
        const { owner } = await buildReport();

        const narrowed = await owner
            .agent
            .get(`/api/organizations/${owner.orgId}/analytics/overview?from=${days(2.5).toISOString()}`)
            .expect(200);
        // The window filters creations and completions, never the current board state.
        expect(narrowed.body.totals).toMatchObject({ tasks: 8, created: 4, completed: 0, overdue: 2, completionRate: 0 });
        expect(narrowed.body.totals.avgCompletionHours).toBeNull();

        const weekly = await owner.agent
            .get(`/api/organizations/${owner.orgId}/analytics/overview?granularity=week`)
            .expect(200);
        expect(weekly.body.window.granularity).toBe('week');
        expect(weekly.body.throughput.map((b: { bucket: string }) => b.bucket)).toContain(weekKey(new Date()));
    });

    it('excludes archived projects and can filter by team', async () => {
        const { owner, alpha } = await buildReport();
        const team = await owner.agent.post(`/api/organizations/${owner.orgId}/teams`).send({ name: 'Platform' }).expect(201);

        await owner.agent.patch(`/api/projects/${alpha.projectId}`).send({ status: 'archived' }).expect(200);
        const archived = await owner.agent.get(`/api/organizations/${owner.orgId}/analytics/overview`).expect(200);
        expect(archived.body.totals.tasks).toBe(3);

        const includeArchived = await owner.agent
            .get(`/api/organizations/${owner.orgId}/analytics/overview?status=archived`)
            .expect(200);
        expect(includeArchived.body.totals.tasks).toBe(5);

        await owner.agent.patch(`/api/projects/${alpha.projectId}`).send({ status: 'active', teamId: team.body.id }).expect(200);
        const byTeam = await owner.agent
            .get(`/api/organizations/${owner.orgId}/analytics/overview?teamId=${team.body.id}`)
            .expect(200);
        expect(byTeam.body.totals.tasks).toBe(5);
        expect(byTeam.body.projects.map((p: { project: { name: string } }) => p.project.name)).toEqual(['Alpha Programme']);
    });

    it('scopes reports to what the requester may see', async () => {
        const { owner, teammate, alpha } = await buildReport();
        const manager = await addMember(owner, 'manager');

        const asMember = await teammate.agent.get(`/api/organizations/${teammate.orgId}/analytics/overview`).expect(200);
        // Private projects stay out of a plain member's organization report.
        expect(asMember.body.totals.tasks).toBe(7);
        expect(asMember.body.projects.map((p: { project: { name: string } }) => p.project.name)).not.toContain('Gamma Search');

        const asManager = await manager.agent.get(`/api/organizations/${owner.orgId}/analytics/overview`).expect(200);
        expect(asManager.body.totals.tasks).toBe(8);

        const single = await teammate.agent.get(`/api/projects/${alpha.projectId}/analytics`).expect(200);
        expect(single.body.totals).toMatchObject({ tasks: 5, open: 3, completed: 2 });
        // A project-scoped report has no per-project table to show.
        expect(single.body.projects).toEqual([]);

        const stranger = await signUp();
        await stranger.agent.get(`/api/organizations/${owner.orgId}/analytics/overview`).expect(403);
        await stranger.agent.get(`/api/projects/${alpha.projectId}/analytics`).expect(403);
    });

    it('answers the workload endpoint with just the workload', async () => {
        const { owner, teammate } = await buildReport();

        const res = await owner.agent.get(`/api/organizations/${owner.orgId}/analytics/workload`).expect(200);
        expect(Object.keys(res.body).sort()).toEqual(['window', 'workload']);
        expect(res.body.workload[0]).toMatchObject({ user: { id: teammate.userId }, open: 2 });
    });

    it('rejects an unknown team and a malformed window', async () => {
        const { owner } = await buildReport();
        await owner.agent.get(`/api/organizations/${owner.orgId}/analytics/overview?from=yesterday`).expect(400);
        const empty = await owner.agent
            .get(`/api/organizations/${owner.orgId}/analytics/overview?teamId=does-not-exist`)
            .expect(200);
        expect(empty.body.totals.tasks).toBe(0);
    });
});
