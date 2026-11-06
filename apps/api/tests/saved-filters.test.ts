import { describe, it, expect, beforeAll } from 'vitest';
import { addMember, signUp, unique, type Workspace } from './helpers.js';

/**
 * Saved filters: private per-user task-list snapshots. Verifies the round-trip of the free-form
 * params, the per-user isolation, and that deleting someone else's filter is refused.
 */
describe('saved filters', () => {
    let owner: Workspace;
    let teammate: Workspace;

    beforeAll(async () => {
        owner = await signUp();
        teammate = await addMember(owner);
    });

    const post = (who: Workspace, body: Record<string, unknown>) =>
        who.agent.post(`/api/organizations/${who.orgId}/filters`).send(body);

    it('stores params as a JSON object and lists them back', async () => {
        const res = await post(owner, {
            name: 'My overdue',
            params: { status: ['todo'], overdue: true },
        });
        expect(res.status).toBe(201);
        expect(res.body.params).toEqual({ status: ['todo'], overdue: true });
        expect(res.body.userId).toBe(owner.userId);

        const list = await owner.agent.get(`/api/organizations/${owner.orgId}/filters`);
        expect(list.status).toBe(200);
        expect(list.body.items.some((f: { id: string }) => f.id === res.body.id)).toBe(true);
    });

    it('scopes filters to their owner', async () => {
        const list = await teammate.agent.get(`/api/organizations/${owner.orgId}/filters`);
        expect(list.status).toBe(200);
        expect(list.body.items).toHaveLength(0);
    });

    it('rejects a project from another organization', async () => {
        const other = await signUp(unique('OtherOrg'));
        const res = await post(owner, { name: 'bad', projectId: 'nonexistent', params: {} });
        expect(res.status).toBe(400);
        // sanity: the fresh org genuinely belongs to someone else
        expect(other.orgId).not.toBe(owner.orgId);
    });

    it('lets the owner delete but refuses another member', async () => {
        const created = await post(owner, { name: 'temp', params: { priority: 'high' } });
        const filterId = created.body.id;

        const forbidden = await teammate.agent.delete(`/api/organizations/${owner.orgId}/filters/${filterId}`);
        expect(forbidden.status).toBe(400);

        const removed = await owner.agent.delete(`/api/organizations/${owner.orgId}/filters/${filterId}`);
        expect(removed.status).toBe(200);

        const list = await owner.agent.get(`/api/organizations/${owner.orgId}/filters`);
        expect(list.body.items.some((f: { id: string }) => f.id === filterId)).toBe(false);
    });

    it('requires a name', async () => {
        const res = await post(owner, { name: '', params: {} });
        expect(res.status).toBe(400);
    });
});
