import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cookieHeaders, cookieValue, PASSWORD, signUp, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Session lifecycle over HTTP: cookie issuance, rotation, theft detection and logout.
 * The cookies are httpOnly, so supertest's cookie jar is the only holder — exactly like
 * the browser behind the Next.js proxy.
 */

describe('registration', () => {
    it('creates a user, a first organization and an httpOnly cookie pair', async () => {
        const email = `${unique('reg')}@atlas.test`;
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email, password: PASSWORD, firstName: 'Ada', lastName: 'Lovelace', organizationName: 'Analytical Engines' })
            .expect(201);

        expect(res.body.user).toMatchObject({ email, firstName: 'Ada', lastName: 'Lovelace' });
        expect(res.body.user).not.toHaveProperty('passwordHash');
        expect(res.body.organizations).toHaveLength(1);
        expect(res.body.organizations[0]).toMatchObject({ name: 'Analytical Engines', role: 'admin', memberCount: 1 });

        const cookies = cookieHeaders(res);
        expect(cookies.some((c) => c.startsWith('atlas_at=') && c.includes('HttpOnly'))).toBe(true);
        expect(cookies.some((c) => c.startsWith('atlas_rt=') && c.includes('HttpOnly') && c.includes('SameSite=Lax'))).toBe(true);

        const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(stored.passwordHash).not.toBe(PASSWORD);
        expect(stored.passwordHash.startsWith('$2')).toBe(true);
        // The bootstrap workspace owns the org and lists the owner as admin.
        const membership = await prisma.organizationMember.findFirstOrThrow({
            where: { userId: stored.id },
        });
        expect(membership.role).toBe('admin');
    });

    it('rejects duplicate and malformed input with a validation envelope', async () => {
        const { email } = await signUp();
        await request(app)
            .post('/api/auth/register')
            .send({ email, password: PASSWORD, firstName: 'Dup', lastName: 'Licate' })
            .expect(409);

        const weak = await request(app)
            .post('/api/auth/register')
            .send({ email: `${unique('weak')}@atlas.test`, password: 'short', firstName: 'x', lastName: 'y' })
            .expect(400);
        expect(weak.body.error.code).toBe('bad_request');
        expect(JSON.stringify(weak.body.error.details)).toContain('password');
    });
});

describe('sign in and out', () => {
    it('accepts the right password and rejects the wrong one identically', async () => {
        const { email } = await signUp();
        await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
        const bad = await request(app).post('/api/auth/login').send({ email, password: 'Wrong1password' }).expect(401);
        expect(bad.body.error.code).toBe('unauthorized');
        const missing = await request(app).post('/api/auth/login').send({ email: 'ghost@atlas.test', password: PASSWORD }).expect(401);
        expect(missing.body.error.message).toBe(bad.body.error.message); // no user enumeration
    });

    it('protects /auth/me and honours logout', async () => {
        const workspace = await signUp();
        await workspace.agent.get('/api/auth/me').expect(200);
        await workspace.agent.post('/api/auth/logout').expect(200);
        await workspace.agent.get('/api/auth/me').expect(401);
        // Refresh was revoked by logout, so it cannot mint a new access token.
        await workspace.agent.post('/api/auth/refresh').expect(401);
    });

    it('reads a bearer token as well as a cookie', async () => {
        const workspace = await signUp();
        const login = await request(app).post('/api/auth/login').send({ email: workspace.email, password: PASSWORD }).expect(200);
        await request(app)
            .get('/api/auth/me')
            .set('authorization', `Bearer ${cookieValue(login, 'atlas_at')}`)
            .expect(200);
    });

    it('updates the profile and changes the password', async () => {
        const workspace = await signUp();
        const patched = await workspace.agent
            .patch('/api/auth/profile')
            .send({ firstName: 'Grace', timezone: 'Europe/Berlin', prefs: { emailDigest: false } })
            .expect(200);
        expect(patched.body.user).toMatchObject({ firstName: 'Grace', timezone: 'Europe/Berlin' });
        expect(patched.body.user.prefs).toEqual({ emailDigest: false });
        expect(patched.body.organizations).toHaveLength(1);

        await workspace.agent
            .post('/api/auth/password')
            .send({ currentPassword: 'NotThePassword1', newPassword: 'Fresh1password' })
            .expect(401);
        await workspace.agent
            .post('/api/auth/password')
            .send({ currentPassword: PASSWORD, newPassword: 'Fresh1password' })
            .expect(200);

        // Changing the password invalidates live sessions: the user is logged out everywhere.
        await workspace.agent.get('/api/auth/me').expect(401);
        await request(app).post('/api/auth/login').send({ email: workspace.email, password: 'Fresh1password' }).expect(200);
    });
});

describe('refresh token rotation', () => {
    it('invalidates the presented token and keeps a session per device', async () => {
        const { email } = await signUp();
        const agent = request.agent(app);
        const login = await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
        const userId = login.body.user.id as string;
        const liveSessions = () => prisma.refreshToken.count({ where: { userId, revokedAt: null } });
        // signUp() already created one session (registration), this login adds a second.
        const before = await liveSessions();
        expect(before).toBe(2);

        await agent.post('/api/auth/refresh').expect(200);
        expect(await liveSessions()).toBe(before); // one revoked, one issued

        const sessions = await agent.get('/api/auth/sessions').expect(200);
        expect(sessions.body.items).toHaveLength(before);

        await agent.delete('/api/auth/sessions').expect(200);
        expect(await liveSessions()).toBe(0);
        await agent.get('/api/auth/me').expect(401);
    });

    it('treats a replayed refresh token as theft and revokes every session', async () => {
        const { email } = await signUp();
        const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
        const userId = login.body.user.id as string;
        const stolen = `atlas_rt=${cookieValue(login, 'atlas_rt')}`;

        await request(app).post('/api/auth/refresh').set('cookie', stolen).expect(200);
        // Reuse of the token that was already rotated away.
        await request(app).post('/api/auth/refresh').set('cookie', stolen).expect(401);
        expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    });

    it('refuses to refresh without a session', async () => {
        await request(app).post('/api/auth/refresh').expect(401);
    });
});
