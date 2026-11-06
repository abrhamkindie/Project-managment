import { describe, it, expect, beforeAll } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  signUp,
  type Workspace,
} from "./helpers.js";

/**
 * Cycle reporting: the burndown of one cycle and the velocity trend across a project.
 *
 * Scope is the set of tasks carrying the cycle *now*, so both charts describe the present reading of
 * the plan rather than replaying every `cycleId` edit — the same approximation Linear and Jira make.
 */

const DAY = 86_400_000;
const dayStamp = (offset: number) => new Date(Date.now() + offset * DAY).toISOString();

async function newCycle(owner: Workspace, projectId: string, offsetDays: { start: number; end: number }) {
  const res = await owner.agent
    .post(`/api/projects/${projectId}/cycles`)
    .send({
      name: `Cycle ${Date.now()}`,
      startsAt: dayStamp(offsetDays.start),
      endsAt: dayStamp(offsetDays.end),
    });
  return res;
}

describe("cycle reporting", () => {
  let owner: Workspace;
  let projectId: string;
  let cycleId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;

    // A window that straddles today: past days have history, later days have none yet.
    const cycle = await newCycle(owner, projectId, { start: -2, end: 3 });
    cycleId = cycle.body.id;

    await createTask(owner, projectId, { cycleId, title: "Landed", status: "done" });
    await createTask(owner, projectId, { cycleId, title: "Still open", estimateMins: 90 });
    await createTask(owner, projectId, { cycleId, title: "Also open" });
    // Backlog work must not leak into the cycle's scope.
    await createTask(owner, projectId, { title: "Not scheduled" });
  });

  it("plots remaining scope against the ideal line for every day of the cycle", async () => {
    const res = await owner
      .agent.get(`/api/projects/${projectId}/analytics/burndown?cycleId=${cycleId}`)
      .expect(200);

    expect(res.body.cycle.id).toBe(cycleId);
    // Inclusive day count: -2 … +3 is six days.
    expect(res.body.days).toHaveLength(6);
    expect(res.body.totals).toMatchObject({ scope: 3, completed: 1, remaining: 2, estimateMins: 90 });
    expect(res.body.totals.completion).toBeCloseTo(33.3, 1);

    const first = res.body.days[0];
    const last = res.body.days[res.body.days.length - 1];
    expect(first.date).toHaveLength(10);
    // The ideal line starts at the whole scope and ends at zero.
    expect(first.ideal).toBeCloseTo(3, 1);
    expect(last.ideal).toBe(0);

    // Days after today carry no truth: the actual line stops, the ideal line keeps falling.
    const today = new Date().toISOString().slice(0, 10);
    const future = res.body.days.filter((day: { date: string }) => day.date > today);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((day: { remaining: number | null }) => day.remaining === null)).toBe(true);

    const plotted = res.body.days.filter((day: { remaining: number | null }) => day.remaining !== null);
    const latest = plotted[plotted.length - 1];
    expect(latest.date).toBe(today);
    expect(latest).toMatchObject({ remaining: 2, completed: 1 });
  });

  it("counts logged time per day and in the totals", async () => {
    const task = await createTask(owner, projectId, { cycleId, title: "Measured" });
    await owner.agent
      .post(`/api/tasks/${task.id}/time/entries`)
      .send({ startedAt: dayStamp(-1), durationMins: 40 })
      .expect(201);
    // A running sitting has no duration, so it must not inflate the chart.
    await owner.agent.post(`/api/tasks/${task.id}/time/start`).send({}).expect(201);

    const res = await owner
      .agent.get(`/api/projects/${projectId}/analytics/burndown?cycleId=${cycleId}`)
      .expect(200);
    expect(res.body.totals.loggedMins).toBe(40);
    const day = res.body.days.find((row: { loggedMins: number }) => row.loggedMins > 0);
    expect(day.loggedMins).toBe(40);
  });

  it("needs a cycle and refuses one from another project", async () => {
    const missing = await owner.agent.get(`/api/projects/${projectId}/analytics/burndown`);
    expect(missing.status).toBe(400);

    const other = await createProject(owner);
    const foreign = await owner.agent.get(
      `/api/projects/${other.projectId}/analytics/burndown?cycleId=${cycleId}`,
    );
    expect(foreign.status).toBe(404);
  });

  it("trends scope and completion across the project's cycles", async () => {
    const earlier = await newCycle(owner, projectId, { start: -20, end: -14 });
    await createTask(owner, projectId, { cycleId: earlier.body.id, title: "Long ago", status: "done" });

    const res = await owner.agent.get(`/api/projects/${projectId}/analytics/cycles`).expect(200);
    const numbers = res.body.cycles.map((row: { number: number }) => row.number);
    expect(numbers).toEqual([...numbers].sort((a: number, b: number) => a - b));

    const current = res.body.cycles.find((row: { id: string }) => row.id === cycleId);
    expect(current).toMatchObject({ scope: 4, completed: 1 });
    expect(current.completion).toBeCloseTo(25, 1);
    expect(current.loggedMins).toBe(40);

    const previous = res.body.cycles.find((row: { id: string }) => row.id === earlier.body.id);
    expect(previous).toMatchObject({ scope: 1, completed: 1, completion: 100 });
  });

  it("reports on the whole organization's window, including logged minutes", async () => {
    // Workload rows only exist for people holding assigned tasks, so give the owner one.
    await createTask(owner, projectId, {
      title: "Carried",
      assigneeIds: [owner.userId],
      estimateMins: 30,
    });
    // One landed early, one late: `onTimeRate` compares completedAt against dueDate.
    await createTask(owner, projectId, { title: "Early", status: "done", dueDate: dayStamp(2) });
    await createTask(owner, projectId, { title: "Late", status: "done", dueDate: dayStamp(-2) });

    const overview = await owner
      .agent.get(`/api/organizations/${owner.orgId}/analytics/overview`)
      .expect(200);
    expect(overview.body.totals.loggedMins).toBeGreaterThanOrEqual(40);
    expect(overview.body.totals.onTimeRate).toBe(50);
    const mine = overview.body.workload.find((row: { user: { id: string } }) => row.user.id === owner.userId);
    expect(mine.loggedMins).toBeGreaterThanOrEqual(40);
  });

  it("keeps a member who cannot see the project out of the report", async () => {
    const stranger = await signUp();
    const res = await stranger.agent.get(
      `/api/projects/${projectId}/analytics/burndown?cycleId=${cycleId}`,
    );
    expect([403, 404]).toContain(res.status);

    // An org member who *can* see an organization-visible project may read it.
    const teammate = await addMember(owner, "member");
    const allowed = await teammate.agent.get(
      `/api/projects/${projectId}/analytics/burndown?cycleId=${cycleId}`,
    );
    expect(allowed.status).toBe(200);
  });
});
