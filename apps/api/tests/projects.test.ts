import { describe, expect, it } from 'vitest';
import { addMember, createProject, createTask, sectionNamed, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Projects: creation defaults, visibility, membership and the board structure.
 */

describe('creating a project', () => {
    it('gives the creator the lead role and the four default columns', async () => {
        const owner = await signUp();
        const board = await createProject(owner, { name: 'Website Relaunch', color: '#16a34a' });

        expect(board).toMatchObject({
            name: 'Website Relaunch',
            color: '#16a34a',
            visibility: 'organization',
            status: 'active',
            progress: 0,
            taskCount: 0,
            canEdit: true,
            canManageMembers: true,
        });
        expect(board.sections.map((s) => s.name)).toEqual(['Backlog', 'In progress', 'In review', 'Done']);
        expect(board.sections.filter((s) => s.isDone)).toHaveLength(1);

        const members = board.members as unknown as { id: string; role: string }[];
        expect(members).toEqual([expect.objectContaining({ id: owner.userId, role: 'lead' })]);

        const activity = await prisma.activity.findFirst({ where: { projectId: board.projectId, type: 'project.created' } });
        expect(activity).not.toBeNull();
    });

    it('rejects a member without the manager role, accepts a manager', async () => {
        const owner = await signUp();
        const member = await addMember(owner, 'member');
        const manager = await addMember(owner, 'manager');

        const denied = await member.agent
            .post(`/api/organizations/${owner.orgId}/projects`)
            .send({ name: 'Should not exist' })
            .expect(403);
        expect(denied.body.error.code).toBe('forbidden');

        await manager.agent
            .post(`/api/organizations/${owner.orgId}/projects`)
            .send({ name: 'Manager project' })
            .expect(201);
    });

    it('validates the colour and name', async () => {
        const owner = await signUp();
        await owner.agent
            .post(`/api/organizations/${owner.orgId}/projects`)
            .send({ name: 'Ok', color: 'not-a-colour' })
            .expect(400);
        await owner.agent
            .post(`/api/organizations/${owner.orgId}/projects`)
            .send({ name: 'A' })
            .expect(400);
    });
});

describe('visibility', () => {
    it('hides private projects from other org members but not from managers', async () => {
        const owner = await signUp();
        const member = await addMember(owner, 'member');
        const manager = await addMember(owner, 'manager');
        const privateBoard = await createProject(owner, { name: 'Secret Launch', visibility: 'private' });

        const list = await member.agent.get(`/api/organizations/${owner.orgId}/projects`).expect(200);
        expect(list.body.items.map((p: { name: string }) => p.name)).not.toContain('Secret Launch');

        await member.agent.get(`/api/projects/${privateBoard.projectId}`).expect(403);

        const managerList = await manager.agent.get(`/api/organizations/${owner.orgId}/projects`).expect(200);
        expect(managerList.body.items.map((p: { name: string }) => p.name)).toContain('Secret Launch');
    });

    it('shows org-wide projects to every member and adds members explicitly', async () => {
        const owner = await signUp();
        const member = await addMember(owner, 'member');
        const board = await createProject(owner, { name: 'Public Roadmap' });

        const list = await member.agent.get(`/api/organizations/${owner.orgId}/projects`).expect(200);
        expect(list.body.items.map((p: { name: string }) => p.name)).toContain('Public Roadmap');

        await member.agent.get(`/api/projects/${board.projectId}`).expect(200);

        const added = await owner.agent
            .post(`/api/projects/${board.projectId}/members`)
            .send({ userIds: [member.userId], role: 'lead' })
            .expect(201);
        expect(added.body.added).toContain(member.userId);

        const detail = await owner.agent.get(`/api/projects/${board.projectId}`).expect(200);
        expect(detail.body.members).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: member.userId, role: 'lead' })]),
        );
    });

    it('refuses to assign people from outside the organization', async () => {
        const owner = await signUp();
        const stranger = await signUp();
        const board = await createProject(owner);

        await owner.agent
            .post(`/api/projects/${board.projectId}/members`)
            .send({ userIds: [stranger.userId] })
            .expect(400);
    });
});

describe('board structure', () => {
    it('creates, renames, reorders and deletes sections', async () => {
        const owner = await signUp();
        const board = await createProject(owner);

        const created = await owner.agent
            .post(`/api/projects/${board.projectId}/sections`)
            .send({ name: 'Waiting on legal' })
            .expect(201);
        const extraId = created.body.id as string;
        expect(created.body).toMatchObject({ name: 'Waiting on legal', projectId: board.projectId });

        await owner.agent.patch(`/api/sections/${extraId}`).send({ name: 'Legal review', isDone: true }).expect(200);

        const ordered = await owner.agent
            .post(`/api/projects/${board.projectId}/sections/reorder`)
            .send({ orderedIds: [extraId, ...board.sections.map((s) => s.id)] })
            .expect(200);
        expect((ordered.body.sections as { id: string }[])[0]?.id).toBe(extraId);

        await owner.agent.delete(`/api/sections/${extraId}`).expect(200);
        const after = await owner.agent.get(`/api/projects/${board.projectId}`).expect(200);
        expect(after.body.sections).toHaveLength(board.sections.length);
        expect(await prisma.section.findFirst({ where: { id: extraId } })).toBeNull();
    });

    it('moves cards to the next column when their section is deleted', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { sectionId: sectionNamed(board, 'Backlog').id });

        await owner.agent.delete(`/api/sections/${sectionNamed(board, 'Backlog').id}`).expect(200);

        // Cards are never destroyed with a column; they land in the first remaining one.
        const moved = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
        expect(moved.body.sectionId).toBe(sectionNamed(board, 'In progress').id);

        const boardAfter = await owner.agent.get(`/api/projects/${board.projectId}/board`).expect(200);
        expect(boardAfter.body.sections).toHaveLength(3);
        expect(boardAfter.body.sections[0].name).toBe('In progress');
        expect(boardAfter.body.sections[0].tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    });

    it('refuses to delete the last column', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        // Delete down to a single column; every one of these has a remaining fallback.
        for (const section of board.sections.slice(0, -1)) {
            await owner.agent.delete(`/api/sections/${section.id}`).expect(200);
        }
        const remaining = await owner.agent.get(`/api/projects/${board.projectId}`).expect(200);
        expect(remaining.body.sections).toHaveLength(1);

        const denied = await owner.agent.delete(`/api/sections/${remaining.body.sections[0].id}`).expect(409);
        expect(denied.body.error.message).toMatch(/at least one column/);
    });

    it('shows cards without a section as unassigned on the board', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);
        await prisma.task.update({ where: { id: task.id as string }, data: { sectionId: null } });

        const res = await owner.agent.get(`/api/projects/${board.projectId}/board`).expect(200);
        expect(res.body.unassigned.map((t: { id: string }) => t.id)).toContain(task.id);
        expect(res.body.sections.every((s: { tasks: unknown[] }) => s.tasks.length === 0)).toBe(true);
    });
});

describe('archiving and deleting', () => {
    it('freezes archived projects for writes', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const worker = await addMember(owner, 'manager');
        await owner.agent.post(`/api/projects/${board.projectId}/members`).send({ userIds: [worker.userId] }).expect(201);

        await owner.agent.patch(`/api/projects/${board.projectId}`).send({ status: 'archived' }).expect(200);

        await worker.agent
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .send({ projectId: board.projectId, title: 'Should be blocked' })
            .expect(403);
        // Archived projects drop out of the default list but are still reachable.
        const list = await owner.agent.get(`/api/organizations/${owner.orgId}/projects`).expect(200);
        expect(list.body.items.map((p: { name: string }) => p.name)).not.toContain(board.name as string);
        const archivedList = await owner.agent
            .get(`/api/organizations/${owner.orgId}/projects?status=archived`)
            .expect(200);
        expect(archivedList.body.items).toHaveLength(1);
    });

    it('deletes a project together with its tasks', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        await owner.agent.delete(`/api/projects/${board.projectId}`).expect(200);
        expect(await prisma.task.findFirst({ where: { id: task.id as string } })).toBeNull();
        await owner.agent.get(`/api/projects/${board.projectId}`).expect(404);
    });
});
