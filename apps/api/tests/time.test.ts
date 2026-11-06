import { describe, it, expect, beforeAll } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  signUp,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Time tracking. A `TimeLog` row is one sitting: `stoppedAt === null` means a live timer, and
 * stopping it freezes `durationMins` so every later total is a plain sum. Logging needs only
 * read access to the task; deleting someone else's row needs a manager.
 */

const HOUR = 3_600_000;
const hourAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

describe("time tracking", () => {
  let owner: Workspace;
  let projectId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
  });

  const addManual = (taskId: string, body: Record<string, unknown>) =>
    owner.agent.post(`/api/tasks/${taskId}/time/entries`).send(body);

  it("starts one timer per person per task and freezes the duration on stop", async () => {
    const task = await createTask(owner, projectId, { estimateMins: 30 });

    const started = await owner.agent
      .post(`/api/tasks/${task.id}/time/start`)
      .send({ description: "heads down" })
      .expect(201);
    expect(started.body.running).toBe(true);
    expect(started.body.durationMins).toBeNull();

    // A second start would silently double the reported time, so it is refused.
    const conflict = await owner.agent.post(`/api/tasks/${task.id}/time/start`).send({});
    expect(conflict.status).toBe(409);

    const stopped = await owner.agent
      .post(`/api/tasks/${task.id}/time/stop`)
      .expect(200);
    expect(stopped.body.running).toBe(false);
    // Rounded up to a minute: a few seconds of work still counts.
    expect(stopped.body.durationMins).toBeGreaterThanOrEqual(1);

    const payload = await owner.agent.get(`/api/tasks/${task.id}/time`).expect(200);
    expect(payload.body.running).toBeNull();
    expect(payload.body.entries).toHaveLength(1);
    expect(payload.body.summary.estimateMins).toBe(30);
    expect(payload.body.summary.totalMins).toBe(stopped.body.durationMins);
    expect(payload.body.summary.overEstimateMins).toBe(
      (stopped.body.durationMins as number) - 30,
    );
    expect(payload.body.summary.byUser[0].mins).toBe(stopped.body.durationMins);
  });

  it("stops nothing it did not start", async () => {
    const task = await createTask(owner, projectId);
    const res = await owner.agent.post(`/api/tasks/${task.id}/time/stop`);
    expect(res.status).toBe(404);
  });

  it("requires a manual entry to say how long the work took", async () => {
    const task = await createTask(owner, projectId);
    const res = await addManual(task.id, { startedAt: hourAgo(2) });
    expect(res.status).toBe(400);
    // The envelope message is generic; the Zod issue list in `details` names the fields.
    expect(JSON.stringify(res.body)).toMatch(/durationMins|stoppedAt/);
  });

  it("derives minutes from the start/stop pair and rejects nonsense", async () => {
    const task = await createTask(owner, projectId);

    const ok = await addManual(task.id, {
      startedAt: hourAgo(3),
      stoppedAt: hourAgo(1),
    }).expect(201);
    expect(ok.body.durationMins).toBe(120);
    expect(ok.body.running).toBe(false);

    const backwards = await addManual(task.id, {
      startedAt: hourAgo(1),
      stoppedAt: hourAgo(3),
    });
    expect(backwards.status).toBe(400);

    const future = await addManual(task.id, {
      startedAt: new Date(Date.now() + HOUR).toISOString(),
      durationMins: 10,
    });
    expect(future.status).toBe(400);

    const tooLong = await addManual(task.id, {
      startedAt: hourAgo(4000),
      durationMins: 60 * 24 * 31,
    });
    expect(tooLong.status).toBe(400);
  });

  it("exposes logged minutes on the card payload the board and list read", async () => {
    const task = await createTask(owner, projectId, { estimateMins: 60 });
    await addManual(task.id, { startedAt: hourAgo(4), durationMins: 45 }).expect(201);

    const detail = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
    expect(detail.body.loggedMins).toBe(45);

    const list = await owner.agent
      .get(`/api/organizations/${owner.orgId}/tasks?projectId=${projectId}&pageSize=100`)
      .expect(200);
    const row = list.body.items.find((item: { id: string }) => item.id === task.id);
    expect(row.loggedMins).toBe(45);
  });

  it("lets the owner remove their own row, but needs a manager for someone else's", async () => {
    const task = await createTask(owner, projectId);
    const teammate = await addMember(owner, "member");
    const manager = await addMember(owner, "manager");

    const mine = await addManual(task.id, {
      startedAt: hourAgo(2),
      durationMins: 15,
    }).expect(201);

    const theirs = await teammate.agent
      .post(`/api/tasks/${task.id}/time/entries`)
      .send({ startedAt: hourAgo(2), durationMins: 20 })
      .expect(201);

    const denied = await teammate.agent.delete(
      `/api/tasks/${task.id}/time/entries/${mine.body.id}`,
    );
    expect(denied.status).toBe(403);

    // Own rows are always removable, by their author.
    await teammate.agent
      .delete(`/api/tasks/${task.id}/time/entries/${theirs.body.id}`)
      .expect(200);

    await manager.agent
      .delete(`/api/tasks/${task.id}/time/entries/${mine.body.id}`)
      .expect(200);

    const payload = await owner.agent.get(`/api/tasks/${task.id}/time`).expect(200);
    expect(payload.body.entries).toHaveLength(0);
  });

  it("refuses an entry id that belongs to another task", async () => {
    const a = await createTask(owner, projectId);
    const b = await createTask(owner, projectId);
    const entry = await addManual(a.id, {
      startedAt: hourAgo(2),
      durationMins: 5,
    }).expect(201);

    const res = await owner.agent.delete(`/api/tasks/${b.id}/time/entries/${entry.body.id}`);
    expect(res.status).toBe(404);
  });

  it("writes the activity trail", async () => {
    const task = await createTask(owner, projectId, { title: "Audited work" });
    await owner.agent.post(`/api/tasks/${task.id}/time/start`).send({}).expect(201);
    await owner.agent.post(`/api/tasks/${task.id}/time/stop`).expect(200);

    const started = await prisma.activity.findFirst({
      where: { taskId: task.id, type: "time.started" },
    });
    const logged = await prisma.activity.findFirst({
      where: { taskId: task.id, type: "time.logged" },
    });
    expect(started).not.toBeNull();
    expect(logged).not.toBeNull();
    expect(JSON.parse(logged!.meta as unknown as string)).toMatchObject({
      title: "Audited work",
    });
  });

  it("keeps outsiders out of the time ledger", async () => {
    const task = await createTask(owner, projectId);
    const stranger = await signUp();

    const read = await stranger.agent.get(`/api/tasks/${task.id}/time`);
    expect([403, 404]).toContain(read.status);

    const write = await stranger.agent
      .post(`/api/tasks/${task.id}/time/start`)
      .send({});
    expect([403, 404]).toContain(write.status);
  });
});
