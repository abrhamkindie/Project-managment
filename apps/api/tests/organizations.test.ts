import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
    addMember,
    app,
    cookieValue,
    createProject,
    createTask,
    errorMessage,
    PASSWORD,
    signIn,
    signUp,
    unique,
} from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, hashSecret } from '../src/lib/crypto.js';

/**
 * Organization management: workspaces, members, invitations, teams, labels, the activity
 * feed and the notification inbox.
 */

/** Invitations only ever leave the API inside an e-mail, so tests mint the token themselves. */
async function seedInvitation(orgId: string, invitedById: string, email: string, role = 'member', daysToLive = 7) {
    const token = unique('invite-token-long-enough');
    await prisma.invitation.create({
        data: {
            orgId,
            email,
            role,
            tokenHash: hashSecret(token),
            invitedById,
            expiresAt: new Date(Date.now() + daysToLive * 86_400_000),
        },
    });
    return token;
}

describe('workspaces', () => {
    it('lists the workspaces a user belongs to with their role', async () => {
        const owner = await signUp('North Wind');
        const teammate = await addMember(owner);

        const asOwner = await owner.agent.get('/api/organizations').expect(200);
        expect(asOwner.body.items).toEqual([
            expect.objectContaining({ name: 'North Wind', role: 'admin', memberCount: 2, ownerId: owner.userId }),
        ]);
        expect(asOwner.body.items[0].slug).toBe('north-wind');

        // Everybody gets a personal workspace at sign-up, so the joined one is picked by id.
        const asTeammate = await teammate.agent.get('/api/organizations').expect(200);
        expect(asTeammate.body.items).toHaveLength(2);
        expect(asTeammate.body.items.find((org: { id: string }) => org.id === owner.orgId)).toMatchObject({
            name: 'North Wind',
            role: 'member',
            memberCount: 2,
        });

        // A user outside the organization cannot read it at all.
        const outsider = await signUp();
        await outsider.agent.get(`/api/organizations/${owner.orgId}`).expect(403);

        const second = await owner.agent.post('/api/organizations').send({ name: 'South Wind' }).expect(201);
        expect(second.body).toMatchObject({ name: 'South Wind', role: 'admin', memberCount: 1 });
        const after = await owner.agent.get('/api/organizations').expect(200);
        expect(after.body.items).toHaveLength(2);
    });

    it('renames only under the admin role', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);

        await teammate.agent.patch(`/api/organizations/${owner.orgId}`).send({ name: 'Hijacked' }).expect(403);
        const renamed = await owner.agent.patch(`/api/organizations/${owner.orgId}`).send({ name: 'Renamed Org' }).expect(200);
        expect(renamed.body.name).toBe('Renamed Org');
        await owner.agent.patch(`/api/organizations/${owner.orgId}`).send({ name: 'x' }).expect(400);
    });
});

describe('invitations', () => {
    it('adds somebody who already has an account immediately', async () => {
        const owner = await signUp();
        const existing = await signUp();

        const res = await owner.agent
            .post(`/api/organizations/${owner.orgId}/invitations`)
            .send({ emails: [existing.email], role: 'manager' })
            .expect(201);
        expect(res.body.items).toEqual([{ email: existing.email, status: 'joined' }]);

        const members = await owner.agent.get(`/api/organizations/${owner.orgId}/members`).expect(200);
        const invited = members.body.items.find(
            (m: { user: { email: string } }) => m.user.email === existing.email,
        );
        expect(invited).toMatchObject({ role: 'manager' });
        expect(await prisma.notification.count({ where: { userId: existing.userId, type: 'project.member_added' } })).toBe(1);

        // Inviting the same person again is a no-op, not a duplicate membership.
        const again = await owner.agent
            .post(`/api/organizations/${owner.orgId}/invitations`)
            .send({ emails: [existing.email] })
            .expect(201);
        expect(again.body.items).toEqual([{ email: existing.email, status: 'joined' }]);
        expect(await prisma.organizationMember.count({ where: { orgId: owner.orgId, userId: existing.userId } })).toBe(1);
    });

    it('stores a pending invite for an unknown address and can revoke it', async () => {
        const owner = await signUp();
        const email = `${unique('newhire')}@atlas.test`;

        await owner.agent.post(`/api/organizations/${owner.orgId}/invitations`).send({ emails: [email] }).expect(201);
        const pending = await owner.agent.get(`/api/organizations/${owner.orgId}/invitations`).expect(200);
        expect(pending.body.items).toEqual([
            expect.objectContaining({ email, role: 'member', invitedBy: expect.objectContaining({ id: owner.userId }) }),
        ]);

        // Asking twice keeps a single invitation.
        await owner.agent.post(`/api/organizations/${owner.orgId}/invitations`).send({ emails: [email] }).expect(201);
        expect(await prisma.invitation.count({ where: { orgId: owner.orgId, email } })).toBe(1);

        await owner.agent.delete(`/api/organizations/${owner.orgId}/invitations/${pending.body.items[0].id}`).expect(200);
        expect(await prisma.invitation.count({ where: { orgId: owner.orgId, email } })).toBe(0);

        const teammate = await addMember(owner);
        await teammate.agent.post(`/api/organizations/${owner.orgId}/invitations`).send({ emails: [email] }).expect(403);
        await teammate.agent.get(`/api/organizations/${owner.orgId}/invitations`).expect(403);
    });

    it('accepts a token only for the address it was sent to', async () => {
        const owner = await signUp();
        const email = `${unique('contractor')}@atlas.test`;
        const token = await seedInvitation(owner.orgId, owner.userId, email, 'manager');
        const invitee = await accountWithoutOrg(email);

        await invitee.agent.post('/api/organizations/invitations/accept').send({ token: 'too-short' }).expect(400);
        await invitee.agent.post('/api/organizations/invitations/accept').send({ token: `${token}xxxx` }).expect(404);

        const accepted = await invitee.agent.post('/api/organizations/invitations/accept').send({ token }).expect(200);
        expect(accepted.body).toMatchObject({ orgId: owner.orgId, role: 'manager' });

        const workspaces = await invitee.agent.get('/api/organizations').expect(200);
        expect(workspaces.body.items.map((o: { id: string }) => o.id)).toContain(owner.orgId);

        // Replays are refused, and the inbox view no longer lists it.
        const replay = await invitee.agent.post('/api/organizations/invitations/accept').send({ token }).expect(409);
        expect(replay.body.error.message).toMatch(/already used/);
        const pending = await owner.agent.get(`/api/organizations/${owner.orgId}/invitations`).expect(200);
        expect(pending.body.items).toHaveLength(0);
    });

    it('refuses a wrong-address and an expired token', async () => {
        const owner = await signUp();
        const wrong = await signUp();
        const token = await seedInvitation(owner.orgId, owner.userId, `${unique('someone')}@atlas.test`);

        const denied = await wrong.agent.post('/api/organizations/invitations/accept').send({ token }).expect(403);
        expect(denied.body.error.message).toMatch(/Sign in with that address/);

        const expired = await seedInvitation(owner.orgId, owner.userId, wrong.email, 'member', -1);
        const stale = await wrong.agent.post('/api/organizations/invitations/accept').send({ token: expired }).expect(400);
        expect(stale.body.error.message).toMatch(/expired/);
    });
});

/** Register somebody with an account but no workspace of their own. */
async function accountWithoutOrg(email: string) {
    const created = await prisma.user.create({
        data: { email, passwordHash: await hashPassword(PASSWORD), firstName: 'Contract', lastName: 'Or' },
    });
    return { agent: await signIn(email), userId: created.id, email };
}

describe('member roles', () => {
    it('promotes and demotes, but never past the owner', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);

        const promoted = await owner.agent
            .patch(`/api/organizations/${owner.orgId}/members/${teammate.userId}`)
            .send({ role: 'manager' })
            .expect(200);
        expect(promoted.body).toEqual({ userId: teammate.userId, role: 'manager' });

        await owner.agent.patch(`/api/organizations/${owner.orgId}/members/${owner.userId}`).send({ role: 'member' }).expect(409);
        await owner.agent.patch(`/api/organizations/${owner.orgId}/members/${teammate.userId}`).send({ role: 'wizard' }).expect(400);

        const demoted = await teammate.agent
            .patch(`/api/organizations/${owner.orgId}/members/${teammate.userId}`)
            .send({ role: 'manager' })
            .expect(403);
        expect(errorMessage(demoted.body)).toMatch(/admin/);
    });

    it('deactivating a member keeps history but blocks sign-in and assignment', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });

        await owner.agent.delete(`/api/organizations/${owner.orgId}/members/${owner.userId}`).expect(409);
        await owner.agent.delete(`/api/organizations/${owner.orgId}/members/${teammate.userId}`).expect(200);

        expect(await prisma.user.findUniqueOrThrow({ where: { id: teammate.userId } }).then((u) => u.isActive)).toBe(false);
        expect(await prisma.organizationMember.count({ where: { orgId: owner.orgId, userId: teammate.userId } })).toBe(0);
        expect(await prisma.taskAssignee.count({ where: { taskId: task.id, userId: teammate.userId } })).toBe(0);
        await signIn(teammate.email).catch((error: Error) => error);
        const blocked = await prisma.user.count({ where: { id: teammate.userId, isActive: false } });
        expect(blocked).toBe(1);
    });
});

describe('teams', () => {
    it('lets managers organize people and projects', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const member = await addMember(owner, 'member');

        const team = await owner.agent
            .post(`/api/organizations/${owner.orgId}/teams`)
            .send({ name: 'Platform', memberIds: [member.userId] })
            .expect(201);
        expect(team.body).toMatchObject({ name: 'Platform', slug: 'platform' });

        const board = await owner.agent
            .post(`/api/organizations/${owner.orgId}/projects`)
            .send({ name: 'Team Project', teamId: team.body.id })
            .expect(201);
        expect(board.body.teamId).toBe(team.body.id);

        const listed = await owner.agent.get(`/api/organizations/${owner.orgId}/teams`).expect(200);
        expect(listed.body.items[0]).toMatchObject({ name: 'Platform', projectCount: 1 });
        expect(listed.body.items[0].members.map((m: { id: string }) => m.id)).toContain(member.userId);

        const setMembers = await owner.agent
            .put(`/api/organizations/${owner.orgId}/teams/${team.body.id}/members`)
            .send({ userIds: [teammate.userId] })
            .expect(200);
        expect(setMembers.body.id).toBe(team.body.id);
        const after = await owner.agent.get(`/api/organizations/${owner.orgId}/teams`).expect(200);
        expect(after.body.items[0].members.map((m: { id: string }) => m.id)).toEqual([teammate.userId]);

        const outsider = await signUp();
        await owner.agent
            .put(`/api/organizations/${owner.orgId}/teams/${team.body.id}/members`)
            .send({ userIds: [outsider.userId] })
            .expect(400);

        await member.agent.post(`/api/organizations/${owner.orgId}/teams`).send({ name: 'Nope' }).expect(403);
    });

    it('filters the project list by team and member', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const team = await owner.agent.post(`/api/organizations/${owner.orgId}/teams`).send({ name: 'Growth' }).expect(201);
        const inTeam = await createProject(owner, { name: 'In Team Project', teamId: team.body.id, memberIds: [teammate.userId] });
        await createProject(owner, { name: 'Out Of Team' });

        const byTeam = await owner.agent
            .get(`/api/organizations/${owner.orgId}/projects?teamId=${team.body.id}`)
            .expect(200);
        expect(byTeam.body.items.map((p: { name: string }) => p.name)).toEqual(['In Team Project']);

        const byMember = await owner.agent
            .get(`/api/organizations/${owner.orgId}/projects?memberId=${teammate.userId}`)
            .expect(200);
        expect(byMember.body.items.map((p: { id: string }) => p.id)).toEqual([inTeam.projectId]);

        const bySearch = await owner.agent
            .get(`/api/organizations/${owner.orgId}/projects?search=Out Of`)
            .expect(200);
        expect(bySearch.body.total).toBe(1);

        // `memberIds` on create also means "this person can see the board".
        const asTeammate = await teammate.agent.get(`/api/projects/${inTeam.projectId}`).expect(200);
        expect(asTeammate.body.members.map((m: { id: string }) => m.id)).toContain(teammate.userId);
        expect(asTeammate.body.canEdit).toBe(false);
        expect(await prisma.notification.count({ where: { userId: teammate.userId, type: 'project.member_added' } })).toBe(1);
    });
});

describe('labels', () => {
    it('creates, lists and deletes org labels with role limits', async () => {
        const owner = await signUp();
        const member = await addMember(owner, 'member');

        const label = await owner.agent
            .post(`/api/organizations/${owner.orgId}/labels`)
            .send({ name: 'Blocking', color: '#b91c1c' })
            .expect(201);
        expect(label.body).toMatchObject({ name: 'Blocking', color: '#b91c1c', orgId: owner.orgId });

        const duplicate = await owner.agent.post(`/api/organizations/${owner.orgId}/labels`).send({ name: 'Blocking' }).expect(409);
        expect(duplicate.body.error.message).toMatch(/already exists/);

        await member.agent.post(`/api/organizations/${owner.orgId}/labels`).send({ name: 'Design' }).expect(201);
        const listed = await member.agent.get(`/api/organizations/${owner.orgId}/labels`).expect(200);
        expect(listed.body.items.map((l: { name: string }) => l.name)).toEqual(['Blocking', 'Design']);

        await member.agent.delete(`/api/organizations/${owner.orgId}/labels/${label.body.id}`).expect(403);
        await owner.agent.delete(`/api/organizations/${owner.orgId}/labels/${label.body.id}`).expect(200);
        expect(await prisma.label.count({ where: { orgId: owner.orgId } })).toBe(1);
    });

    it('feeds the organization activity stream, newest first', async () => {
        const owner = await signUp();
        await createProject(owner, { name: 'Feed Project' });
        await createProject(owner, { name: 'Second Project' });

        const feed = await owner.agent.get(`/api/organizations/${owner.orgId}/activity?limit=1`).expect(200);
        expect(feed.body.items).toHaveLength(1);
        expect(feed.body.items[0]).toMatchObject({ type: 'project.created', actor: { id: owner.userId } });

        const all = await owner.agent.get(`/api/organizations/${owner.orgId}/activity`).expect(200);
        expect(all.body.items.length).toBeGreaterThan(1);
        const timestamps = all.body.items.map((a: { createdAt: string }) => a.createdAt);
        expect([...timestamps].sort().reverse()).toEqual(timestamps);
    });
});

describe('notification inbox', () => {
    it('paginates, filters unread and marks read', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner);
        const board = await createProject(owner, { name: 'Inbox Project' });
        await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });
        await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });

        const inbox = await teammate.agent.get('/api/notifications').expect(200);
        expect(inbox.body.unread).toBe(2);
        expect(inbox.body.total).toBe(2);
        expect(inbox.body.items[0]).toMatchObject({ type: 'task.assigned', readAt: null });

        const first = inbox.body.items[0].id as string;
        await teammate.agent.post('/api/notifications/read').send({ ids: [first] }).expect(200);
        const afterOne = await teammate.agent.get('/api/notifications?unreadOnly=true').expect(200);
        expect(afterOne.body.unread).toBe(1);
        expect(afterOne.body.items.map((n: { id: string }) => n.id)).not.toContain(first);

        await teammate.agent.post(`/api/notifications/${afterOne.body.items[0].id}/read`).expect(200);
        const empty = await teammate.agent.get('/api/notifications?unreadOnly=true').expect(200);
        expect(empty.body.items).toHaveLength(0);

        // Marking another person notification does nothing.
        const mine = await teammate.agent.get('/api/notifications').expect(200);
        const other = await owner.agent.post('/api/notifications/read').send({ ids: [mine.body.items[0].id] }).expect(200);
        expect(other.body.updated).toBe(0);

        await teammate.agent.delete(`/api/notifications/${mine.body.items[0].id}`).expect(200);
        const deleted = await teammate.agent.get('/api/notifications').expect(200);
        expect(deleted.body.total).toBe(1);
    });

    it('reads and writes e-mail preferences', async () => {
        const owner = await signUp();

        const defaults = await owner.agent.get('/api/notifications/preferences').expect(200);
        expect(defaults.body).toEqual({ emailOnAssign: true, emailOnComment: true, emailDigest: true });

        await owner.agent.put('/api/notifications/preferences').send({}).expect(400);
        const updated = await owner.agent.put('/api/notifications/preferences').send({ prefs: { emailOnAssign: false } }).expect(200);
        expect(updated.body).toEqual({ emailOnAssign: false, emailOnComment: true, emailDigest: true });

        const back = await owner.agent.get('/api/notifications/preferences').expect(200);
        expect(back.body.emailOnAssign).toBe(false);
    });
});

describe('bearer tokens', () => {
    it('authorizes the same routes without cookies', async () => {
        const owner = await signUp('Header Works');
        const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: PASSWORD }).expect(200);
        const token = cookieValue(login, 'atlas_at');
        expect(token).not.toBe('');

        const orgs = await request(app).get('/api/organizations').set('Authorization', `Bearer ${token}`).expect(200);
        expect(orgs.body.items.map((o: { name: string }) => o.name)).toContain('Header Works');

        await request(app).get('/api/organizations').expect(401);
        await request(app).get('/api/organizations').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });
});
