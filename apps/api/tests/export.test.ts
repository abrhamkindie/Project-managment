import { describe, it, expect, beforeAll } from 'vitest';
import { addMember, createProject, createTask, signUp, type Workspace } from './helpers.js';

/**
 * CSV export. The endpoint streams a whole-project snapshot; these tests assert the header,
 * RFC-4180 quoting of messy fields, and the viewer-access gate.
 */
describe('project CSV export', () => {
    let owner: Workspace;
    let projectId: string;
    const messyTitle = 'Fix "login", commas,\nand newlines';

    beforeAll(async () => {
        owner = await signUp();
        const project = await createProject(owner);
        projectId = project.projectId;
        await createTask(owner, projectId, { title: messyTitle, priority: 'high' });
        await createTask(owner, projectId, { title: 'Plain task' });
    });

    it('returns a csv attachment with a header row and one line per task', async () => {
        const res = await owner.agent.get(`/api/projects/${projectId}/export`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.headers['content-disposition']).toMatch(/attachment; filename="tasks-/);

        const text = res.text;
        expect(text.startsWith('id,title,status,priority,kind,')).toBe(true);
        // Messy field is quoted with inner quotes doubled; the plain task is unquoted.
        expect(text).toContain('"Fix ""login"", commas,\nand newlines"');
        expect(text).toContain(',Plain task,');
    });

    it('forbids a non-member from exporting a private project', async () => {
        const outsider = await signUp('outsider-org');
        const privateProject = await createProject(owner, { visibility: 'private' });
        const res = await outsider.agent.get(`/api/projects/${privateProject.projectId}/export`);
        expect(res.status).toBe(403);
    });

    it('lets an org member export an organization-visible project', async () => {
        const teammate = await addMember(owner);
        const orgProject = await createProject(owner, { visibility: 'organization' });
        await createTask(owner, orgProject.projectId, { title: 'Shared' });
        const res = await teammate.agent.get(`/api/projects/${orgProject.projectId}/export`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('Shared');
    });
});
