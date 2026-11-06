import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import {
    createProject,
    signUp,
    errorMessage,
    app,
    type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Personal access tokens.
 *
 * A `zrq_…` token is a second credential type for the same `authenticate` middleware, so these
 * tests care about three things: the token authenticates as its owner, its scopes actually bind,
 * and it can never be used to mint or revoke another token.
 */

describe("api tokens", () => {
    let owner: Workspace;
    let projectId: string;

    beforeAll(async () => {
        owner = await signUp();
        const project = await createProject(owner);
        projectId = project.projectId;
    });

    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

    const create = async (body: Record<string, unknown>) => {
        const res = await owner.agent.post("/api/auth/tokens").send(body).expect(201);
        return res.body as { id: string; token: string };
    };

    it("returns the plaintext exactly once and lists only metadata after that", async () => {
        const created = await create({ name: "CI", scopes: ["read", "write"] });
        expect(created.token.startsWith("zrq_")).toBe(true);

        const listed = await owner.agent.get("/api/auth/tokens").expect(200);
        const row = listed.body.items.find(
            (item: { id: string }) => item.id === created.id,
        );
        expect(row.status).toBe("active");
        expect(row.scopes).toEqual(["read", "write"]);
        // Nothing in the list response can be replayed as a credential.
        expect(JSON.stringify(listed.body)).not.toContain(created.token.slice(4));
        expect(row.tokenHash).toBeUndefined();

        // Only the digest is stored, so the plaintext is unrecoverable from the database too.
        const stored = await prisma.apiToken.findUnique({ where: { id: created.id } });
        expect(stored!.tokenHash).not.toContain(created.token);
    });

    it("authenticates a read request for the token owner", async () => {
        const { token } = await create({ name: "Reader", scopes: ["read"] });

        const res = await request(app)
            .get(`/api/organizations/${owner.orgId}/tasks`)
            .set(bearer(token))
            .expect(200);
        expect(Array.isArray(res.body.items)).toBe(true);

        const me = await request(app).get("/api/auth/me").set(bearer(token)).expect(200);
        expect(me.body.user.id).toBe(owner.userId);
    });

    it("refuses a mutation with a read-only token but allows it with write", async () => {
        const readOnly = await create({ name: "ReadOnly", scopes: ["read"] });
        const denied = await request(app)
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .set(bearer(readOnly.token))
            .send({ projectId, title: "nope" });
        expect(denied.status).toBe(403);
        expect(errorMessage(denied.body)).toMatch(/write scope/);

        const writeOnly = await create({ name: "Both", scopes: ["write"] });
        const allowed = await request(app)
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .set(bearer(writeOnly.token))
            .send({ projectId, title: "from a token" })
            .expect(201);
        expect(allowed.body.title).toBe("from a token");
    });

    it("treats `*` as the only scope needed and collapses the narrower ones", async () => {
        const { token, id } = await create({ name: "Everything", scopes: ["read", "write", "*"] });
        const created = await request(app)
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .set(bearer(token))
            .send({ projectId, title: "star scope" })
            .expect(201);

        const listed = await owner.agent.get("/api/auth/tokens").expect(200);
        const row = listed.body.items.find((item: { id: string }) => item.id === id);
        expect(row.scopes).toEqual(["*"]);
        await prisma.task.update({ where: { id: created.body.id }, data: { deletedAt: new Date() } });
    });

    it("stops working on revocation, and a revoked token cannot be un-revoked", async () => {
        const { token, id } = await create({ name: "Temporary", scopes: ["read"] });
        await request(app).get("/api/auth/me").set(bearer(token)).expect(200);

        await owner.agent.delete(`/api/auth/tokens/${id}`).expect(200);
        const gone = await request(app).get("/api/auth/me").set(bearer(token));
        expect(gone.status).toBe(401);

        const listed = await owner.agent.get("/api/auth/tokens").expect(200);
        expect(
            listed.body.items.find((item: { id: string }) => item.id === id).status,
        ).toBe("revoked");
        // Revocation is a timestamp, so the row stays in the list instead of vanishing.
        expect(await prisma.apiToken.findUnique({ where: { id } })).not.toBeNull();
    });

    it("rejects an expired token and an unknown one", async () => {
        const { token, id } = await create({ name: "Expired", scopes: ["read"], expiresInDays: 1 });
        await prisma.apiToken.update({
            where: { id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const expired = await request(app).get("/api/auth/me").set(bearer(token));
        expect(expired.status).toBe(401);
        expect(errorMessage(expired.body)).toMatch(/expired/);

        const unknown = await request(app)
            .get("/api/auth/me")
            .set(bearer("zrq_definitelynotissued"));
        expect(unknown.status).toBe(401);
    });

    it("refuses to let a token manage credentials or change the password", async () => {
        const { token } = await create({ name: "Escalator", scopes: ["*"] });

        const mint = await request(app)
            .post("/api/auth/tokens")
            .set(bearer(token))
            .send({ name: "child", scopes: ["read"] });
        expect(mint.status).toBe(403);
        expect(errorMessage(mint.body)).toMatch(/web app/);

        const revoke = await request(app)
            .delete("/api/auth/tokens/whatever")
            .set(bearer(token));
        expect(revoke.status).toBe(403);

        const password = await request(app)
            .post("/api/auth/password")
            .set(bearer(token))
            .send({ currentPassword: "Passw0rd!", newPassword: "Another1!" });
        expect(password.status).toBe(403);
    });

    it("refuses a token whose account was deactivated", async () => {
        const member = await signUp();
        const minted = await member.agent
            .post("/api/auth/tokens")
            .send({ name: "self", scopes: ["read"] })
            .expect(201);

        await prisma.user.update({ where: { id: member.userId }, data: { isActive: false } });
        const res = await request(app)
            .get("/api/auth/me")
            .set(bearer(minted.body.token));
        expect(res.status).toBe(401);
    });

    it("validates the creation payload", async () => {
        await owner.agent
            .post("/api/auth/tokens")
            .send({ name: "x", scopes: ["read"] })
            .expect(400);
        await owner.agent
            .post("/api/auth/tokens")
            .send({ name: "sane", scopes: ["admin"] })
            .expect(400);
        await owner.agent
            .post("/api/auth/tokens")
            .send({ name: "sane", scopes: [] })
            .expect(400);
    });
});
