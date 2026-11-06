import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import {
  addMember,
  createProject,
  createTask,
  signUp,
  app,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Public share links.
 *
 * The token is the only credential, so the two things that must never slip are the projection (no
 * e-mail addresses, no comments, no files) and expiry/revocation (a dead link answers 404, not 403,
 * so probing cannot distinguish "yours" from "never existed").
 */

describe("share links", () => {
  let owner: Workspace;
  let projectId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
  });

  const share = (body: Record<string, unknown>) =>
    owner.agent.post(`/api/organizations/${owner.orgId}/shares`).send(body);

  const open = (token: string) => request(app).get(`/api/public/shares/${token}`);

  it("publishes a board snapshot to an anonymous caller", async () => {
    await createTask(owner, projectId, { title: "Public board card", priority: "high" });
    const created = await share({ projectId }).expect(201);
    expect(created.body.token.length).toBeGreaterThan(20);
    expect(created.body.url).toContain(`/share/${created.body.token}`);

    const res = await open(created.body.token).expect(200);
    expect(res.body.kind).toBe("project");
    expect(res.body.project.name).toBeTruthy();
    expect(res.body.sections.length).toBeGreaterThan(0);
    expect(res.body.tasks[0].title).toBe("Public board card");
    // A share answers for one viewer at a time; nothing may be cached in between.
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("publishes a task without e-mail addresses, comments or files", async () => {
    const task = await createTask(owner, projectId, { assigneeIds: [owner.userId] });
    await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: "internal note" }).expect(201);
    const created = await share({ taskId: task.id, expiresInDays: 1 }).expect(201);

    const res = await open(created.body.token).expect(200);
    expect(res.body.kind).toBe("task");
    expect(res.body.task.title).toBe(task.title);
    expect(res.body.task.assignees).toEqual([
      { name: "Test User", primary: true },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(owner.email);
    expect(JSON.stringify(res.body)).not.toContain("internal note");
    expect(res.body.task.subtaskCount).toBe(0);
  });

  it("requires exactly one target", async () => {
    await share({ projectId, taskId: "task-1" }).expect(400);
    const neither = await share({});
    expect(neither.status).toBe(400);
    expect(JSON.stringify(neither.body.error.details)).toMatch(/exactly one/);
  });

  it("lists only my own links, with a derived status", async () => {
    const teammate = await addMember(owner, "member");
    const before = await owner.agent.get(`/api/organizations/${owner.orgId}/shares`).expect(200);
    const mine = await share({ projectId }).expect(201);
    await teammate.agent
      .post(`/api/organizations/${owner.orgId}/shares`)
      .send({ projectId })
      .expect(201);

    const listed = await owner.agent
      .get(`/api/organizations/${owner.orgId}/shares`)
      .expect(200);
    // The other account's link is invisible, and the earlier tests' links are unchanged in number.
    expect(listed.body.items).toHaveLength(before.body.items.length + 1);
    expect(listed.body.items[0].id).toBe(mine.body.id);
    expect(listed.body.items[0].status).toBe("active");
    expect(listed.body.items[0].projectName).toBeTruthy();
    // The plaintext token is not repeated in the list.
    expect(JSON.stringify(listed.body)).not.toContain(mine.body.token);

    await owner.agent
      .delete(`/api/organizations/${owner.orgId}/shares/${mine.body.id}`)
      .expect(200);
    await teammate.agent
      .delete(`/api/organizations/${owner.orgId}/shares/${mine.body.id}`)
      .expect(404);
  });

  it("answers 404 for a revoked, an expired and an unknown token", async () => {
    const created = await share({ projectId }).expect(201);
    await open(created.body.token).expect(200);

    await owner.agent
      .delete(`/api/organizations/${owner.orgId}/shares/${created.body.id}`)
      .expect(200);
    const revoked = await open(created.body.token);
    expect(revoked.status).toBe(404);

    const expiring = await share({ projectId, expiresInDays: 1 }).expect(201);
    await prisma.shareLink.update({
      where: { id: expiring.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await open(expiring.body.token);
    expect(expired.status).toBe(404);
    expect(expired.body.error.message).toMatch(/expired/);

    expect((await open("definitely-not-a-token")).status).toBe(404);

    const listed = await owner.agent
      .get(`/api/organizations/${owner.orgId}/shares`)
      .expect(200);
    const statuses = listed.body.items.map((item: { status: string }) => item.status);
    expect(statuses.filter((status: string) => status === "revoked").length).toBeGreaterThan(0);
    expect(statuses.filter((status: string) => status === "expired").length).toBeGreaterThan(0);
  });

  it("only shares what the caller can already see", async () => {
    const stranger = await signUp();
    const denied = await stranger.agent
      .post(`/api/organizations/${stranger.orgId}/shares`)
      .send({ projectId });
    expect([403, 404]).toContain(denied.status);

    // And a link from another organization is not resolvable by guessing its id.
    const mine = await share({ projectId }).expect(201);
    await stranger.agent
      .delete(`/api/organizations/${stranger.orgId}/shares/${mine.body.id}`)
      .expect(404);

    const stillOpen = await open(mine.body.token).expect(200);
    expect(stillOpen.body.kind).toBe("project");
  });

  it("reports the card count and a truncation flag on a board snapshot", async () => {
    const other = await createProject(owner, { name: "Big board" });
    for (let index = 0; index < 3; index += 1) await createTask(owner, other.projectId);

    const created = await share({ projectId: other.projectId }).expect(201);
    const res = await open(created.body.token).expect(200);
    expect(res.body.project.taskCount).toBe(3);
    expect(res.body.project.truncated).toBe(false);
  });
});
