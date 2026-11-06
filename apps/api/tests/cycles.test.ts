import { describe, it, expect, beforeAll } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  errorMessage,
  signUp,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Cycles (Linear-style sprints): numbering, the single-active rule, and the close
 * behaviour that returns unfinished work to the backlog instead of stranding it.
 */

async function newCycle(
  owner: Workspace,
  projectId: string,
  data: Record<string, unknown> = {},
) {
  const res = await owner.agent
    .post(`/api/projects/${projectId}/cycles`)
    .send({
      name: `Cycle ${Date.now()}`,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-14T00:00:00.000Z",
      ...data,
    });
  return res;
}

describe("cycles", () => {
  let owner: Workspace;
  let projectId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
  });

  it("auto-numbers cycles per project and starts them as drafts", async () => {
    const first = await newCycle(owner, projectId);
    expect(first.status).toBe(201);
    expect(first.body.number).toBe(1);
    expect(first.body.status).toBe("draft");

    const second = await newCycle(owner, projectId);
    expect(second.body.number).toBe(2);

    const list = await owner.agent.get(`/api/projects/${projectId}/cycles`).expect(200);
    // Newest first, and each carries scope counts so the board chip needs no second call.
    expect(list.body.items[0].number).toBe(2);
    expect(list.body.items[0]).toHaveProperty("taskCount");
    expect(list.body.items[0]).toHaveProperty("doneCount");
  });

  it("rejects a window that ends before it starts", async () => {
    const res = await newCycle(owner, projectId, {
      startsAt: "2026-02-10T00:00:00.000Z",
      endsAt: "2026-02-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("activating one cycle closes the previously active one", async () => {
    const a = (await newCycle(owner, projectId)).body;
    const b = (await newCycle(owner, projectId)).body;

    await owner.agent.patch(`/api/cycles/${a.id}`).send({ status: "active" }).expect(200);
    const res = await owner.agent.patch(`/api/cycles/${b.id}`).send({ status: "active" }).expect(200);
    expect(res.body.status).toBe("active");

    const afterA = await prisma.cycle.findUnique({ where: { id: a.id } });
    expect(afterA?.status).toBe("closed");
  });

  it("attaches tasks by cycleId and refuses a cycle from another project", async () => {
    const cycle = (await newCycle(owner, projectId)).body;
    const task = await createTask(owner, projectId, { cycleId: cycle.id });
    expect(task.cycleId).toBe(cycle.id);

    const other = await createProject(owner);
    const res = await owner.agent
      .post(`/api/organizations/${owner.orgId}/tasks`)
      .send({ projectId: other.projectId, title: "cross", cycleId: cycle.id });
    expect(res.status).toBe(400);
    expect(errorMessage(res.body)).toMatch(/cycle/i);
  });

  it("closing a cycle carries open work back to the backlog and detaches it", async () => {
    const cycle = (await newCycle(owner, projectId)).body;
    const open = await createTask(owner, projectId, { cycleId: cycle.id, status: "in_progress" });
    const done = await createTask(owner, projectId, { cycleId: cycle.id, status: "done" });

    const res = await owner.agent.post(`/api/cycles/${cycle.id}/close`).expect(200);
    expect(res.body.status).toBe("closed");
    expect(res.body.carried).toBe(1);

    const openRow = await prisma.task.findUnique({ where: { id: open.id } });
    expect(openRow?.cycleId).toBeNull();
    // Done work keeps its cycle assignment as a frozen snapshot of completed scope.
    const doneRow = await prisma.task.findUnique({ where: { id: done.id } });
    expect(doneRow?.cycleId).toBe(cycle.id);
  });

  it("deleting a cycle detaches its tasks rather than removing them", async () => {
    const cycle = (await newCycle(owner, projectId)).body;
    const task = await createTask(owner, projectId, { cycleId: cycle.id });

    await owner.agent.delete(`/api/cycles/${cycle.id}`).expect(200);
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row).not.toBeNull();
    expect(row?.cycleId).toBeNull();
  });

  it("gates cycle writes on project edit permission", async () => {
    const outsider = await addMember(owner, "member");
    // A plain member who is not on the project cannot create cycles in it.
    const res = await outsider.agent
      .post(`/api/projects/${projectId}/cycles`)
      .send({ name: "nope", startsAt: "2026-03-01T00:00:00.000Z", endsAt: "2026-03-05T00:00:00.000Z" });
    expect([400, 403]).toContain(res.status);
  });
});
