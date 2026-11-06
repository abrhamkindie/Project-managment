import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  signUp,
  errorMessage,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Project automations.
 *
 * Rules run from the activity write path, so these tests drive them exactly like a user does —
 * create or move a task over the API — and then look at what the engine did on its own. The single
 * most important assertion in this file is the recursion guard: a rule that writes the event it
 * listens to must settle instead of looping.
 */

describe("automations", () => {
  let owner: Workspace;
  let projectId: string;
  let teammate: Workspace;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
    teammate = await addMember(owner, "member");
  });

  // Rules are project-wide and fire on every later mutation, so each test starts from none.
  afterEach(async () => {
    await prisma.automationRule.deleteMany({ where: { projectId } });
  });

  const createRule = (body: Record<string, unknown>) =>
    owner.agent
      .post(`/api/projects/${projectId}/automations`)
      .send({ name: "Rule", active: true, ...body });

  const rule = async (body: Record<string, unknown>) => {
    const res = await createRule(body).expect(201);
    return res.body as { id: string };
  };

  const label = async (name: string) => {
    const res = await owner.agent
      .post(`/api/organizations/${owner.orgId}/labels`)
      .send({ name })
      .expect(201);
    return res.body.id as string;
  };

  /** Rules are checked against the project's organization at save time, so this one never lands. */
  const labelOfOtherOrg = async () => {
    const outsider = await signUp();
    const res = await outsider.agent
      .post(`/api/organizations/${outsider.orgId}/labels`)
      .send({ name: "Elsewhere" })
      .expect(201);
    return res.body.id as string;
  };

  const activities = async (taskId: string) =>
    (await prisma.activity.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })).map(
      (row) => ({ ...row, meta: JSON.parse(row.meta) as Record<string, unknown> }),
    );

  /** Rows the engine wrote itself, as opposed to the ones a human edit produced. */
  const firedBy = (rows: { meta: Record<string, unknown> }[]) =>
    rows.filter((row) => row.meta.via === "automation");

  describe("firing", () => {
    it("runs its actions when the trigger matches", async () => {
      await rule({
        trigger: { event: "task.created" },
        actions: [{ kind: "set_priority", value: "urgent" }],
      });

      const task = await createTask(owner, projectId, { priority: "none" });
      const row = await prisma.task.findUnique({ where: { id: task.id } });
      expect(row!.priority).toBe("urgent");

      const [fired] = firedBy(await activities(task.id));
      expect(fired).toBeDefined();
      expect(fired!.meta.changed).toEqual(["priority"]);
    });

    it("respects from/to conditions on a status change", async () => {
      await rule({
        trigger: { event: "task.status_changed", conditions: { from: "todo", to: "done" } },
        actions: [{ kind: "set_priority", value: "high" }],
      });

      const inProgress = await createTask(owner, projectId, { priority: "none" });
      await owner.agent
        .patch(`/api/tasks/${inProgress.id}`)
        .send({ status: "in_progress" })
        .expect(200);
      expect((await prisma.task.findUnique({ where: { id: inProgress.id } }))!.priority).toBe("none");

      const finished = await createTask(owner, projectId, { priority: "none" });
      await owner.agent.patch(`/api/tasks/${finished.id}`).send({ status: "done" }).expect(200);
      const after = await prisma.task.findUnique({ where: { id: finished.id } });
      expect(after!.priority).toBe("high");
      // The rule mirrored a human edit, so the completion timestamp is honest.
      expect(after!.completedAt).not.toBeNull();
    });

    it("only fires a hasLabelId rule for tasks that carry the label", async () => {
      const hot = await label("Hot");
      await rule({
        trigger: { event: "task.created", conditions: { hasLabelId: hot } },
        actions: [{ kind: "set_priority", value: "urgent" }],
      });

      const plain = await createTask(owner, projectId, { priority: "low" });
      expect((await prisma.task.findUnique({ where: { id: plain.id } }))!.priority).toBe("low");

      const tagged = await createTask(owner, projectId, { priority: "low", labelIds: [hot] });
      expect((await prisma.task.findUnique({ where: { id: tagged.id } }))!.priority).toBe("urgent");
    });

    it("does not re-trigger on the activity its own actions produced", async () => {
      await rule({
        trigger: { event: "task.status_changed", conditions: { to: "in_progress" } },
        // Moves the task to review, which is itself a `task.status_changed` event.
        actions: [{ kind: "set_status", value: "in_review" }],
      });

      const task = await createTask(owner, projectId);
      await owner.agent.patch(`/api/tasks/${task.id}`).send({ status: "in_progress" }).expect(200);

      const rows = await activities(task.id);
      expect(firedBy(rows)).toHaveLength(1);
      expect((await prisma.task.findUnique({ where: { id: task.id } }))!.status).toBe("in_review");
    });

    it("skips inactive rules", async () => {
      await rule({
        trigger: { event: "task.created" },
        actions: [{ kind: "set_priority", value: "urgent" }],
        active: false,
      });

      const task = await createTask(owner, projectId, { priority: "low" });
      expect((await prisma.task.findUnique({ where: { id: task.id } }))!.priority).toBe("low");
    });

    it("reassigns the task and tells the new assignee", async () => {
      await rule({
        trigger: { event: "task.created" },
        actions: [{ kind: "assign", value: teammate.userId }],
      });

      const task = await createTask(owner, projectId, { assigneeIds: [owner.userId] });
      const assignees = await prisma.taskAssignee.findMany({ where: { taskId: task.id } });
      expect(assignees.map((row) => row.userId)).toEqual([teammate.userId]);

      const notice = await prisma.notification.findFirst({
        where: { userId: teammate.userId, type: "task.assigned" },
        orderBy: { createdAt: "desc" },
      });
      expect(notice!.body).toContain("Automation rule");
    });

    it("notifies the watchers it is pointed at", async () => {
      await rule({
        trigger: { event: "comment.added" },
        actions: [{ kind: "notify", value: "Review needed" }],
      });

      const task = await createTask(owner, projectId);
      await owner.agent
        .post(`/api/tasks/${task.id}/comments`)
        .send({ body: "shipping this now" })
        .expect(201);

      const notice = await prisma.notification.findFirst({
        where: { userId: owner.userId, type: "automation.fired" },
        orderBy: { createdAt: "desc" },
      });
      expect(notice!.title).toBe("Review needed");
      expect(notice!.body).toContain("Automation rule");
    });

    it("queues a webhook event with the rule as its payload", async () => {
      const hook = await prisma.webhook.create({
        data: {
          orgId: owner.orgId,
          url: "https://receiver.test/hook",
          secret: "whsec_test",
          events: JSON.stringify(["task.completed"]),
        },
      });
      await rule({
        trigger: { event: "task.status_changed", conditions: { to: "done" } },
        actions: [{ kind: "webhook", value: "task.completed" }],
      });

      const task = await createTask(owner, projectId);
      await owner.agent.patch(`/api/tasks/${task.id}`).send({ status: "done" }).expect(200);

      const deliveries = await prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } });
      // The human move fires `task.completed` through the activity map, and the rule fires its own.
      expect(deliveries.length).toBeGreaterThanOrEqual(2);
      const fromRule = deliveries
        .map((row) => JSON.parse(row.payload))
        .find((body) => body.data.via === "automation");
      expect(fromRule.event).toBe("task.completed");
      expect(fromRule.data.rule).toBe("Rule");

      await prisma.webhook.delete({ where: { id: hook.id } });
    });

    it("keeps going when one rule is broken", async () => {
      const gone = "cl000000000000000000gone";
      // Inserted behind the API: saving through the routes refuses a label that does not exist,
      // but a label deleted after the rule was written has to fail at firing time instead.
      await prisma.automationRule.create({
        data: {
          orgId: owner.orgId,
          projectId,
          name: "Broken",
          trigger: JSON.stringify({ event: "task.created" }),
          actions: JSON.stringify([{ kind: "add_label", value: gone }]),
          active: true,
        },
      });
      await rule({
        name: "Second",
        trigger: { event: "task.created" },
        actions: [{ kind: "set_priority", value: "high" }],
      });

      const task = await createTask(owner, projectId, { priority: "low" });
      expect((await prisma.task.findUnique({ where: { id: task.id } }))!.priority).toBe("high");
    });

    it("ignores a rule whose stored definition cannot be parsed", async () => {
      await prisma.automationRule.create({
        data: {
          orgId: owner.orgId,
          projectId,
          name: "Corrupt",
          trigger: "{not json",
          actions: "[]",
          active: true,
        },
      });
      const task = await createTask(owner, projectId, { priority: "low" });
      expect((await prisma.task.findUnique({ where: { id: task.id } }))!.priority).toBe("low");
    });
  });

  describe("management endpoints", () => {
    it("require project edit rights", async () => {
      const denied = await teammate.agent
        .post(`/api/projects/${projectId}/automations`)
        .send({ name: "Nope", trigger: { event: "task.created" }, actions: [{ kind: "set_priority", value: "low" }] });
      expect(denied.status).toBe(403);
      expect(errorMessage(denied.body)).toMatch(/automations/);

      await teammate.agent.get(`/api/projects/${projectId}/automations`).expect(200);
    });

    it("validate the action payload against the organization", async () => {
      await createRule({
        trigger: { event: "task.created" },
        actions: [{ kind: "set_status", value: "shipped" }],
      }).expect(400);

      await createRule({
        trigger: { event: "task.created" },
        actions: [{ kind: "webhook", value: "task.exploded" }],
      }).expect(400);

      await createRule({
        trigger: { event: "task.created" },
        actions: [{ kind: "add_label", value: "cl0000000000000000000000" }],
      }).expect(400);

      await createRule({
        trigger: { event: "task.created" },
        // A label belonging to another organization is not this one's to attach.
        actions: [{ kind: "add_label", value: await labelOfOtherOrg() }],
      }).expect(400);

      await createRule({
        trigger: { event: "task.created" },
        actions: [{ kind: "assign", value: "random-user-id" }],
      }).expect(400);

      await createRule({ trigger: { event: "task.created" }, actions: [] }).expect(400);
    });

    it("lists, updates and deletes a rule", async () => {
      const created = await rule({
        trigger: { event: "task.created" },
        actions: [{ kind: "set_priority", value: "low" }],
      });

      const listed = await owner.agent.get(`/api/projects/${projectId}/automations`).expect(200);
      expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(created.id);

      const updated = await owner.agent
        .patch(`/api/automations/${created.id}`)
        .send({ active: false, actions: [{ kind: "set_priority", value: "urgent" }] })
        .expect(200);
      expect(updated.body.active).toBe(false);
      expect(updated.body.actions[0].value).toBe("urgent");
      // The trigger was not sent, so the stored one survives.
      expect(updated.body.trigger.event).toBe("task.created");

      await owner.agent.delete(`/api/automations/${created.id}`).expect(200);
      expect(await prisma.automationRule.findUnique({ where: { id: created.id } })).toBeNull();
    });

    it("refuses a rule for a project the caller cannot see", async () => {
      const stranger = await signUp();
      const denied = await stranger.agent
        .post(`/api/projects/${projectId}/automations`)
        .send({ name: "Intruder", trigger: { event: "task.created" }, actions: [{ kind: "set_priority", value: "low" }] });
      expect([403, 404]).toContain(denied.status);
    });
  });
});
