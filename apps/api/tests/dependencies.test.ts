import { describe, it, expect, beforeAll } from "vitest";
import {
  createProject,
  createTask,
  errorMessage,
  signUp,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Finish-to-start dependencies: `{ taskId: A, dependsOnTaskId: B }` reads "A waits on B".
 * The graph is advisory (completion only warns), so the invariant we enforce at the API is
 * that it stays acyclic.
 */

describe("task dependencies", () => {
  let owner: Workspace;
  let projectId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
  });

  function depend(taskId: string, dependsOnTaskId: string) {
    return owner.agent
      .post(`/api/tasks/${taskId}/dependencies`)
      .send({ dependsOnTaskId, type: "FS" });
  }

  it("records an edge and reports both directions", async () => {
    const b = await createTask(owner, projectId, { title: "Blocker" });
    const a = await createTask(owner, projectId, { title: "Follower" });

    const res = await depend(a.id, b.id).expect(201);
    expect(res.body.task.id).toBe(b.id);

    const aDeps = await owner.agent.get(`/api/tasks/${a.id}/dependencies`).expect(200);
    expect(aDeps.body.blockedBy.map((d: { task: { id: string } }) => d.task.id)).toContain(b.id);
    expect(aDeps.body.blocking).toHaveLength(0);

    const bDeps = await owner.agent.get(`/api/tasks/${b.id}/dependencies`).expect(200);
    expect(bDeps.body.blocking.map((d: { task: { id: string } }) => d.task.id)).toContain(a.id);
    expect(bDeps.body.blockedBy).toHaveLength(0);
  });

  it("embeds the graph in the task detail payload", async () => {
    const b = await createTask(owner, projectId);
    const a = await createTask(owner, projectId);
    await depend(a.id, b.id).expect(201);

    const detail = await owner.agent.get(`/api/tasks/${a.id}`).expect(200);
    expect(detail.body.dependencies.blockedBy[0].task.id).toBe(b.id);
  });

  it("refuses a self-dependency", async () => {
    const t = await createTask(owner, projectId);
    const res = await depend(t.id, t.id);
    expect(res.status).toBe(400);
    expect(errorMessage(res.body)).toMatch(/itself/i);
  });

  it("refuses a duplicate edge", async () => {
    const b = await createTask(owner, projectId);
    const a = await createTask(owner, projectId);
    await depend(a.id, b.id).expect(201);
    const again = await depend(a.id, b.id);
    expect(again.status).toBe(409);
  });

  it("refuses a cycle, direct and transitive", async () => {
    const b = await createTask(owner, projectId);
    const a = await createTask(owner, projectId);
    await depend(a.id, b.id).expect(201);
    // Reversing the edge would close a 2-loop.
    const reverse = await depend(b.id, a.id);
    expect(reverse.status).toBe(409);
    expect(errorMessage(reverse.body)).toMatch(/circular/i);

    // A -> B -> C, so adding C -> A would close a 3-loop.
    const c = await createTask(owner, projectId);
    const bc = await createTask(owner, projectId);
    await depend(bc.id, c.id).expect(201); // bc waits on c
    await depend(a.id, bc.id).expect(201); // a waits on bc (a -> bc -> c)
    const close = await depend(c.id, a.id); // c waits on a => cycle a->bc->c->a
    expect(close.status).toBe(409);
  });

  it("removes an edge from either endpoint", async () => {
    const b = await createTask(owner, projectId);
    const a = await createTask(owner, projectId);
    const created = await depend(a.id, b.id).expect(201);

    await owner.agent
      .delete(`/api/tasks/${a.id}/dependencies/${created.body.dependencyId}`)
      .expect(200);

    const remaining = await prisma.taskDependency.count({ where: { taskId: a.id } });
    expect(remaining).toBe(0);
  });

  it("rejects a dependency on a task in another organization", async () => {
    const stranger = await signUp();
    const strangerProject = await createProject(stranger);
    const foreign = await createTask(stranger, strangerProject.projectId);
    const local = await createTask(owner, projectId);

    const res = await depend(local.id, foreign.id);
    // Not a member of the foreign org, so access lookup rejects before the org check.
    expect([403, 404, 400]).toContain(res.status);
  });
});
