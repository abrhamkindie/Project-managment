import { beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTask, signUp, type Workspace } from './helpers.js';

/**
 * Org task-list facets.
 *
 * The calendar grid and saved filters both read `GET /organizations/:orgId/tasks`, so the due-date
 * window, ordering, paging and the cycle/kind slices are pinned here rather than only in the UI.
 */
describe('task list filtering', () => {
    let owner: Workspace;
    let projectId: string;

    const list = (query: string) => owner.agent.get(`/api/organizations/${owner.orgId}/tasks?${query}`);
    const titles = (items: { title: string }[]) => items.map((task) => task.title);

    beforeAll(async () => {
        owner = await signUp();
        const board = await createProject(owner);
        projectId = board.projectId;
        await createTask(owner, projectId, { title: 'Early March', dueDate: '2026-03-04T00:00:00.000Z' });
        await createTask(owner, projectId, { title: 'Late March', dueDate: '2026-03-27T00:00:00.000Z' });
        await createTask(owner, projectId, { title: 'June', dueDate: '2026-06-30T00:00:00.000Z' });
        await createTask(owner, projectId, { title: 'Undated' });
    });

    it('returns only tasks whose due date falls inside an inclusive window', async () => {
        const res = await list('dueAfter=2026-03-01T00:00:00.000Z&dueBefore=2026-03-31T23:59:59.999Z&orderBy=dueDate');
        expect(res.status).toBe(200);
        expect(titles(res.body.items)).toEqual(['Early March', 'Late March']);
    });

    it('pages and reports the full count for the window', async () => {
        const res = await list('dueAfter=2026-03-01T00:00:00.000Z&orderBy=dueDate&pageSize=2&page=2');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2, pages: 2 });
        expect(titles(res.body.items)).toEqual(['June']);
    });

    it('slices by cycle and by kind', async () => {
        const cycle = await owner.agent
            .post(`/api/projects/${projectId}/cycles`)
            .send({ name: 'March', startsAt: '2026-03-01T00:00:00.000Z', endsAt: '2026-03-31T00:00:00.000Z' });
        expect(cycle.status).toBe(201);
        await createTask(owner, projectId, { title: 'Sprint work', cycleId: cycle.body.id });
        await createTask(owner, projectId, { title: 'Big epic', kind: 'epic' });

        const inCycle = await list(`cycleId=${cycle.body.id}`);
        expect(titles(inCycle.body.items)).toEqual(['Sprint work']);

        const epics = await list('kind=epic');
        expect(titles(epics.body.items)).toEqual(['Big epic']);
    });

    it('rejects an unknown enum value instead of ignoring it', async () => {
        const res = await list('kind=sprint');
        expect(res.status).toBe(400);
    });
});
