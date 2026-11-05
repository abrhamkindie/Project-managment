import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  sectionNamed,
  signUp,
  unique,
  type Agent,
  type Card,
} from "./helpers.js";
import { TEST_UPLOAD_DIR } from "./env.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * The task lifecycle: creation, editing, subtasks, Kanban moves, assignment,
 * discussion, attachments and the "My tasks" read model.
 *
 * These tests double as executable documentation of the response contract: a task
 * mutation answers with the flat card, and `GET /tasks/:id` answers with that card plus
 * its project, subtasks, parent and timeline.
 */

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

describe("creating a task", () => {
  it("applies defaults, lands at the bottom of the first open column and logs the event", async () => {
    const owner = await signUp();
    const board = await createProject(owner);

    const first = await createTask(owner, board.projectId, {
      title: "Draft the brief",
    });
    expect(first).toMatchObject({
      projectId: board.projectId,
      sectionId: sectionNamed(board, "Backlog").id,
      status: "todo",
      priority: "none",
      isMilestone: false,
      completedAt: null,
      position: 1000,
      subtaskCount: 0,
      commentCount: 0,
      assignees: [],
    });
    expect(first.id).toBeTypeOf("string");

    // New cards append, so a drag never has to renumber the column.
    const second = await createTask(owner, board.projectId, {
      title: "Collect logos",
    });
    expect(second.position).toBe(2000);

    const activity = await prisma.activity.findFirst({
      where: { taskId: first.id as string, type: "task.created" },
    });
    expect(JSON.parse(activity!.meta).title).toBe("Draft the brief");
  });

  it("stamps completedAt when a card is created already done", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, { status: "done" });

    expect(task.completedAt).toBeTypeOf("string");
    expect(task.sectionId).toBe(sectionNamed(board, "Done").id);
  });

  it("notifies teammates who are assigned, but never the actor", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);

    const task = await createTask(owner, board.projectId, {
      assigneeIds: [teammate.userId, owner.userId],
    });
    expect(task.assigneeIds).toEqual(
      expect.arrayContaining([teammate.userId, owner.userId]),
    );
    // The actor is the primary when they assign themselves, so "my work" sorts first.
    const assignees = task.assignees as { id: string; isPrimary: boolean }[];
    expect(assignees.find((a) => a.id === owner.userId)?.isPrimary).toBe(true);

    expect(
      await prisma.notification.count({
        where: { userId: teammate.userId, type: "task.assigned" },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: owner.userId } }),
    ).toBe(0);

    const inbox = await teammate.agent.get("/api/notifications").expect(200);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.items[0].link).toBe(
      `/projects/${board.projectId}/tasks/${task.id}`,
    );

    // The card is reachable in the teammate's inbox view.
    const mine = await teammate.agent
      .get(`/api/organizations/${owner.orgId}/my-tasks`)
      .expect(200);
    expect(
      mine.body.groups[0].tasks.map((t: { id: string }) => t.id),
    ).toContain(task.id);
  });

  it("refuses assignees from outside the organization", async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const board = await createProject(owner);

    const res = await owner.agent
      .post(`/api/organizations/${owner.orgId}/tasks`)
      .send({
        projectId: board.projectId,
        title: "Bad assignment",
        assigneeIds: [stranger.userId],
      })
      .expect(403);
    expect(res.body.error.details).toEqual({ userIds: [stranger.userId] });
  });

  it("validates the title and the project", async () => {
    const owner = await signUp();
    const board = await createProject(owner);

    await owner.agent
      .post(`/api/organizations/${owner.orgId}/tasks`)
      .send({ projectId: board.projectId, title: "   " })
      .expect(400);
    await owner.agent
      .post(`/api/organizations/${owner.orgId}/tasks`)
      .send({ projectId: "missing-project-id", title: "Orphan" })
      .expect(404);
  });
});

describe("editing a task", () => {
  it("records a status change, mirrors completedAt and can reopen", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, {
      assigneeIds: [teammate.userId],
    });

    const done = await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ status: "done" })
      .expect(200);
    expect(done.body).toMatchObject({ id: task.id, status: "done" });
    expect(done.body.completedAt).toBeTypeOf("string");

    const reopened = await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ status: "in_progress" })
      .expect(200);
    expect(reopened.body.completedAt).toBeNull();

    const types = (
      await prisma.activity.findMany({
        where: { taskId: task.id as string },
        select: { type: true },
      })
    ).map((row) => row.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "task.created",
        "task.assigned",
        "task.status_changed",
        "task.completed",
        "task.reopened",
      ]),
    );

    // The assignee hears about the movement even though they did not cause it.
    expect(
      await prisma.notification.count({
        where: { userId: teammate.userId, type: "task.status_changed" },
      }),
    ).toBe(2);
  });

  it("answers a no-op patch without writing history", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, { priority: "high" });

    await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ priority: "high" })
      .expect(200);
    expect(
      await prisma.activity.count({ where: { taskId: task.id as string } }),
    ).toBe(1);
  });

  it("quick-completes from the board action", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const res = await owner.agent
      .post(`/api/tasks/${task.id}/complete`)
      .expect(200);
    expect(res.body).toMatchObject({ id: task.id, status: "done" });
  });

  it("keeps the card in a section that matches the status it was moved to", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, {
      sectionId: sectionNamed(board, "Backlog").id,
    });

    const res = await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ status: "done", sectionId: sectionNamed(board, "Done").id })
      .expect(200);
    expect(res.body.sectionId).toBe(sectionNamed(board, "Done").id);

    // A section from another project is not a valid target.
    const other = await createProject(owner);
    await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ sectionId: sectionNamed(other, "Backlog").id })
      .expect(400);
  });
});

describe("subtasks", () => {
  it("creates children, counts them and shows them on the parent", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const parent = await createTask(owner, board.projectId, {
      title: "Ship release",
    });
    const child = await createTask(owner, board.projectId, {
      title: "Write notes",
      parentTaskId: parent.id,
    });

    expect(child.parentTaskId).toBe(parent.id);
    expect(
      await prisma.activity.count({
        where: { taskId: child.id as string, type: "subtask.created" },
      }),
    ).toBe(1);

    const detail = await owner.agent.get(`/api/tasks/${parent.id}`).expect(200);
    expect(detail.body.subtasks.map((t: { id: string }) => t.id)).toEqual([
      child.id,
    ]);
    expect(detail.body.subtaskCount).toBe(1);

    const childDetail = await owner.agent
      .get(`/api/tasks/${child.id}`)
      .expect(200);
    expect(childDetail.body.parent.id).toBe(parent.id);
  });

  it("refuses to nest a task below itself, below another project, or in a cycle", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const other = await createProject(owner);
    const parent = await createTask(owner, board.projectId);
    const child = await createTask(owner, board.projectId, {
      parentTaskId: parent.id,
    });
    const foreign = await createTask(owner, other.projectId);

    await owner.agent
      .patch(`/api/tasks/${parent.id}`)
      .send({ parentTaskId: parent.id })
      .expect(400);
    await owner.agent
      .patch(`/api/tasks/${parent.id}`)
      .send({ parentTaskId: foreign.id })
      .expect(400);
    await owner.agent
      .patch(`/api/tasks/${parent.id}`)
      .send({ parentTaskId: "nope" })
      .expect(404);

    const cycle = await owner.agent
      .patch(`/api/tasks/${parent.id}`)
      .send({ parentTaskId: child.id })
      .expect(409);
    expect(cycle.body.error.message).toMatch(/circular/);
  });
});

describe("assignment", () => {
  it("replaces, adds and removes assignees, telling only who changed", async () => {
    const owner = await signUp();
    const a = await addMember(owner, "member");
    const b = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const replaced = await owner.agent
      .put(`/api/tasks/${task.id}/assignees`)
      .send({ userIds: [a.userId] })
      .expect(200);
    expect(replaced.body.assigneeIds).toEqual([a.userId]);
    // The very first assignee becomes the owner of the card.
    expect(replaced.body.assignees[0]).toMatchObject({
      id: a.userId,
      isPrimary: true,
    });

    const added = await owner.agent
      .put(`/api/tasks/${task.id}/assignees`)
      .send({ userIds: [b.userId], mode: "add" })
      .expect(200);
    expect(added.body.assigneeIds).toEqual(
      expect.arrayContaining([a.userId, b.userId]),
    );

    const removed = await owner.agent
      .put(`/api/tasks/${task.id}/assignees`)
      .send({ userIds: [a.userId], mode: "remove" })
      .expect(200);
    expect(removed.body.assigneeIds).toEqual([b.userId]);

    const types = (
      await prisma.activity.findMany({
        where: { taskId: task.id },
        select: { type: true },
      })
    ).map((row) => row.type);
    expect(types).toEqual(
      expect.arrayContaining(["task.assigned", "task.unassigned"]),
    );
    expect(
      await prisma.notification.count({
        where: { userId: b.userId, type: "task.assigned" },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: a.userId, type: "task.assigned" },
      }),
    ).toBe(1);

    await owner.agent
      .put(`/api/tasks/${task.id}/assignees`)
      .send({ userIds: ["ghost"], mode: "add" })
      .expect(403);
  });
});

describe("moving on the board", () => {
  it("inherits the column status and slots between neighbours", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const backlog = sectionNamed(board, "Backlog");
    const done = sectionNamed(board, "Done");

    const one = await createTask(owner, board.projectId, { title: "One" });
    const two = await createTask(owner, board.projectId, { title: "Two" });

    const moved = await owner.agent
      .post(`/api/tasks/${one.id}/move`)
      .send({ sectionId: done.id, beforeTaskId: null, afterTaskId: null })
      .expect(200);
    // Dropping into a done column completes the card, and vice versa.
    expect(moved.body).toMatchObject({ sectionId: done.id, status: "done" });
    expect(moved.body.completedAt).toBeTypeOf("string");

    const back = await owner.agent
      .post(`/api/tasks/${one.id}/move`)
      .send({ sectionId: backlog.id, afterTaskId: two.id })
      .expect(200);
    expect(back.body).toMatchObject({
      sectionId: backlog.id,
      status: "in_progress",
    });
    expect(back.body.completedAt).toBeNull();
    expect(back.body.position).toBeGreaterThan(two.position as number);

    const types = (
      await prisma.activity.findMany({
        where: { taskId: one.id as string },
        select: { type: true },
      })
    ).map((row) => row.type);
    expect(types).toEqual(
      expect.arrayContaining(["task.moved", "task.completed", "task.reopened"]),
    );

    // Opting out of inheritance leaves the status alone.
    const held = await owner.agent
      .post(`/api/tasks/${two.id}/move`)
      .send({ sectionId: done.id, inheritSectionStatus: false })
      .expect(200);
    expect(held.body.status).toBe("todo");
  });

  it("rejects a column from another project", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const other = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    await owner.agent
      .post(`/api/tasks/${task.id}/move`)
      .send({ sectionId: sectionNamed(other, "Done").id })
      .expect(400);
  });
});

describe("listing and filtering", () => {
  it("filters by status, overdue flag, assignee and text", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);

    const todo = await createTask(owner, board.projectId, {
      title: "Zebra migration",
      assigneeIds: [owner.userId],
    });
    const done = await createTask(owner, board.projectId, { status: "done" });
    const late = await createTask(owner, board.projectId, {
      title: "Paying audit",
      dueDate: hoursFromNow(-24),
      assigneeIds: [owner.userId],
    });
    await createTask(owner, board.projectId, {
      title: "Assigned away",
      assigneeIds: [teammate.userId],
    });

    const byStatus = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&status=done`,
      )
      .expect(200);
    expect(byStatus.body.items.map((t: { id: string }) => t.id)).toEqual([
      done.id,
    ]);

    const overdue = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&overdue=true`,
      )
      .expect(200);
    expect(overdue.body.items.map((t: { id: string }) => t.id)).toEqual([
      late.id,
    ]);
    expect(overdue.body.items[0].isOverdue).toBe(true);

    const mine = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?assigneeId=me&projectId=${board.projectId}`,
      )
      .expect(200);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toEqual(
      expect.arrayContaining([todo.id, late.id]),
    );

    const searched = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&search=zebra`,
      )
      .expect(200);
    expect(searched.body.items.map((t: { id: string }) => t.id)).toEqual([
      todo.id,
    ]);

    const paged = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&pageSize=2&page=2`,
      )
      .expect(200);
    expect(paged.body).toMatchObject({
      total: 4,
      page: 2,
      pageSize: 2,
      pages: 2,
    });
    expect(paged.body.items).toHaveLength(2);

    // Rejected filters fail loudly instead of silently widening the result set.
    await owner.agent
      .get(`/api/organizations/${owner.orgId}/tasks?status=parked`)
      .expect(400);
  });

  it("reads a bare due date as the whole day, so work due today is not late yet", async () => {
    const owner = await signUp();
    const board = await createProject(owner);

    // What a date picker sends: no time, no offset. `z.coerce.date()` lands it on UTC midnight.
    const utcDay = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

    const dueToday = await createTask(owner, board.projectId, {
      title: "Due today",
      dueDate: utcDay(0),
    });
    const dueYesterday = await createTask(owner, board.projectId, {
      title: "Slipped",
      dueDate: utcDay(-1),
    });

    const late = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&overdue=true`,
      )
      .expect(200);
    expect(late.body.items.map((t: { id: string }) => t.id)).toEqual([
      dueYesterday.id,
    ]);

    // The row keeps the calendar day the picker sent, and lateness is judged on that day only.
    expect(String(dueToday.dueDate).startsWith(utcDay(0))).toBe(true);
    expect(dueToday.isOverdue).toBe(false);
  });

  it("orders by due date with undated cards last", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    await createTask(owner, board.projectId, { title: "No date" });
    const soon = await createTask(owner, board.projectId, {
      title: "Soon",
      dueDate: hoursFromNow(2),
    });
    const later = await createTask(owner, board.projectId, {
      title: "Later",
      dueDate: hoursFromNow(48),
    });

    const res = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&orderBy=dueDate`,
      )
      .expect(200);
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([
      soon.id,
      later.id,
      expect.anything(),
    ]);

    const reversed = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&orderBy=createdAt&order=desc`,
      )
      .expect(200);
    expect(reversed.body.items[0].id).toBe(later.id);
  });

  it("hides subtasks from a plain board listing unless asked", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const parent = await createTask(owner, board.projectId);
    const child = await createTask(owner, board.projectId, {
      parentTaskId: parent.id,
    });

    const top = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&includeSubtasks=false`,
      )
      .expect(200);
    expect(top.body.items.map((t: { id: string }) => t.id)).toEqual([
      parent.id,
    ]);
    expect(top.body.total).toBe(1);

    const all = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`,
      )
      .expect(200);
    expect(all.body.items.map((t: { id: string }) => t.id)).toEqual(
      expect.arrayContaining([parent.id, child.id]),
    );
  });

  it("groups open work by project in My tasks", async () => {
    const owner = await signUp();
    const board = await createProject(owner, { name: "Orbita Web" });
    const other = await createProject(owner, { name: "Orbita Docs" });
    const kept = await createTask(owner, board.projectId, {
      assigneeIds: [owner.userId],
    });
    await createTask(owner, other.projectId, { assigneeIds: [owner.userId] });
    const finished = await createTask(owner, board.projectId, {
      assigneeIds: [owner.userId],
      status: "done",
    });

    const res = await owner.agent
      .get(`/api/organizations/${owner.orgId}/my-tasks`)
      .expect(200);
    expect(
      res.body.groups.map((g: { project: { name: string } }) => g.project.name),
    ).toEqual(expect.arrayContaining(["Orbita Web", "Orbita Docs"]));
    const ids = res.body.groups.flatMap((g: { tasks: { id: string }[] }) =>
      g.tasks.map((t: { id: string }) => t.id),
    );
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(finished.id);
  });
});

describe("labels", () => {
  it("attaches org labels and rejects unknown ones", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const label = await owner.agent
      .post(`/api/organizations/${owner.orgId}/labels`)
      .send({ name: "Bug", color: "#dc2626" })
      .expect(201);

    const tagged = await owner.agent
      .put(`/api/tasks/${task.id}/labels`)
      .send({ labelIds: [label.body.id] })
      .expect(200);
    expect(tagged.body.labels).toEqual([
      { id: label.body.id, name: "Bug", color: "#dc2626" },
    ]);

    await owner.agent
      .put(`/api/tasks/${task.id}/labels`)
      .send({ labelIds: ["not-a-label"] })
      .expect(400);

    const byLabel = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&labelId=${label.body.id}`,
      )
      .expect(200);
    expect(byLabel.body.items).toHaveLength(1);

    const cleared = await owner.agent
      .put(`/api/tasks/${task.id}/labels`)
      .send({ labelIds: [] })
      .expect(200);
    expect(cleared.body.labels).toEqual([]);
  });
});

describe("discussion", () => {
  it("adds, edits and soft-deletes comments, notifying watchers", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, {
      assigneeIds: [teammate.userId],
    });

    const comment = await teammate.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({ body: "Blocked on the API contract." })
      .expect(201);
    expect(comment.body).toMatchObject({
      taskId: task.id,
      body: "Blocked on the API contract.",
      author: { id: teammate.userId },
    });

    // The creator watches their own task.
    expect(
      await prisma.notification.count({
        where: { userId: owner.userId, type: "comment.added" },
      }),
    ).toBe(1);
    expect(
      await prisma.activity.count({
        where: { taskId: task.id as string, type: "comment.added" },
      }),
    ).toBe(1);

    const edited = await teammate.agent
      .patch(`/api/comments/${comment.body.id}`)
      .send({ body: "Unblocked now." })
      .expect(200);
    expect(edited.body.body).toBe("Unblocked now.");
    await owner.agent
      .patch(`/api/comments/${comment.body.id}`)
      .send({ body: "Not mine" })
      .expect(403);

    await owner.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({ body: "" })
      .expect(400);

    await teammate.agent.delete(`/api/comments/${comment.body.id}`).expect(200);
    const list = await owner.agent
      .get(`/api/tasks/${task.id}/comments`)
      .expect(200);
    expect(list.body.items).toHaveLength(0);
    const row = await prisma.comment.findUnique({
      where: { id: comment.body.id },
    });
    expect(row!.deletedAt).not.toBeNull();
    // Deleting someone else's comment needs moderation rights.
    const colleague = await addMember(owner, "member");
    const theirs = await colleague.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({ body: "Mine" })
      .expect(201);
    await teammate.agent.delete(`/api/comments/${theirs.body.id}`).expect(403);
  });

  it("interleaves comments and activity in the timeline", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);
    await owner.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({ body: "First" })
      .expect(201);
    await owner.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ priority: "urgent" })
      .expect(200);

    const detail = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
    const kinds = detail.body.timeline.map(
      (entry: { kind: string }) => entry.kind,
    );
    expect(kinds).toEqual(expect.arrayContaining(["activity", "comment"]));
    expect(
      detail.body.timeline.every(
        (entry: { createdAt: string }) => typeof entry.createdAt === "string",
      ),
    ).toBe(true);
    expect(detail.body.project).toMatchObject({
      id: board.projectId,
      name: board.name,
    });
    expect(detail.body.commentCount).toBe(1);

    const feed = await owner.agent
      .get(`/api/tasks/${task.id}/activity`)
      .expect(200);
    expect(feed.body.items).toHaveLength(detail.body.timeline.length);
    expect(feed.body.items[0]).toMatchObject({
      kind: "activity",
      type: "task.created",
      actor: { id: owner.userId },
    });
  });

  it("notifies the people a comment mentions, and nobody else", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const colleague = await addMember(owner, "member");
    const outsider = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    // Both members are named "Team Mate", so the free-text form resolves to the whole pair;
    // the author is never notified about their own comment, leaving the colleague.
    const comment = await teammate.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({
        body: `Heads up @Team Mate, and @[Outsider](${outsider.userId}) is not in this organization`,
      })
      .expect(201);

    expect(
      await prisma.notification.count({
        where: { userId: colleague.userId, type: "comment.mentioned" },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: teammate.userId, type: "comment.mentioned" },
      }),
    ).toBe(0);
    // The id form is honoured only inside the organization: this endpoint is not a ping oracle.
    expect(
      await prisma.notification.count({ where: { userId: outsider.userId } }),
    ).toBe(0);
    expect(
      await prisma.activity.count({
        where: { taskId: task.id as string, type: "comment.mentioned" },
      }),
    ).toBe(1);

    // Re-saving with the same mention must not re-ping.
    await teammate.agent
      .patch(`/api/comments/${comment.body.id}`)
      .send({ body: "Heads up @Team Mate — edited" })
      .expect(200);
    expect(
      await prisma.notification.count({
        where: { userId: colleague.userId, type: "comment.mentioned" },
      }),
    ).toBe(1);

    // Adding a mention in an edit is how people fix a forgotten one, so that one does ping.
    await teammate.agent
      .patch(`/api/comments/${comment.body.id}`)
      .send({ body: `Also @[Test User](${owner.userId})` })
      .expect(200);
    expect(
      await prisma.notification.count({
        where: { userId: owner.userId, type: "comment.mentioned" },
      }),
    ).toBe(1);
  });
});

describe("attachments", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4nGP8z8DwnwEPYMQGZADGJQYE8p7C+QAAAABJRU5ErkJggg==",
    "base64",
  );

  it("uploads, serves and deletes a file", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const uploaded = await teammate.agent
      .post(`/api/tasks/${task.id}/attachments`)
      .attach("file", png, {
        filename: "diagram.png",
        contentType: "image/png",
      })
      .expect(201);

    expect(uploaded.body).toMatchObject({
      filename: "diagram.png",
      mimeType: "image/png",
      size: png.byteLength,
      url: `/api/tasks/${task.id}/attachments/${uploaded.body.id}/download`,
    });
    expect(
      await prisma.activity.count({
        where: { taskId: task.id as string, type: "attachment.added" },
      }),
    ).toBe(1);

    const cardInbox = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`,
      )
      .expect(200);
    expect(cardInbox.body.items[0].attachments).toHaveLength(1);

    const download = await owner.agent
      .get(uploaded.body.url)
      .expect(200)
      .buffer();
    expect(download.body).toBeInstanceOf(Buffer);
    expect(download.body.equals(png)).toBe(true);
    expect(download.headers["content-disposition"]).toContain(
      'attachment; filename="diagram.png"',
    );

    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.body.id },
    });
    await teammate.agent
      .delete(`/api/tasks/${task.id}/attachments/${uploaded.body.id}`)
      .expect(200);
    expect(
      await prisma.attachment.findUnique({ where: { id: uploaded.body.id } }),
    ).toBeNull();
    await expect(
      stat(path.join(TEST_UPLOAD_DIR, row.storageKey)),
    ).rejects.toThrow();

    await owner.agent.get(uploaded.body.url).expect(404);
  });

  it("rejects disallowed types and empty uploads", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const bad = await owner.agent
      .post(`/api/tasks/${task.id}/attachments`)
      .attach("file", Buffer.from("<script>alert(1)</script>"), {
        filename: "page.html",
        contentType: "text/html",
      })
      .expect(400);
    expect(bad.body.error.message).toMatch(/Unsupported file type/);

    await owner.agent.post(`/api/tasks/${task.id}/attachments`).expect(400);
  });

  it("trusts the bytes rather than the label the browser sent", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    // The exact payload the sniffer exists for: markup handed over as a png. Stored as an
    // "image", it would come back with an image content type and a browser that guesses from
    // the bytes would run it.
    for (const disguise of [
      { body: '<svg onload="alert(1)"></svg>', filename: "logo.png" },
      {
        body: "<!doctype html><script>alert(1)</script>",
        filename: "report.pdf",
      },
    ]) {
      const lying = await owner.agent
        .post(`/api/tasks/${task.id}/attachments`)
        .attach("file", Buffer.from(disguise.body), {
          filename: disguise.filename,
          contentType: "image/png",
        })
        .expect(400);
      expect(lying.body.error.message).toMatch(/Unsupported file type/);
    }
    expect(
      await prisma.attachment.count({ where: { taskId: task.id as string } }),
    ).toBe(0);

    // The honest direction also holds: real png bytes win even when the client calls them text.
    const mislabeled = await owner.agent
      .post(`/api/tasks/${task.id}/attachments`)
      .attach("file", png, {
        filename: "diagram.png",
        contentType: "text/plain",
      })
      .expect(201);
    expect(mislabeled.body).toMatchObject({
      mimeType: "image/png",
      filename: "diagram.png",
    });
  });

  it("hides other people uploads from a plain member", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const uploaded = await owner.agent
      .post(`/api/tasks/${task.id}/attachments`)
      .attach("file", Buffer.from("notes"), {
        filename: "notes.txt",
        contentType: "text/plain",
      })
      .expect(201);

    await teammate.agent
      .delete(`/api/tasks/${task.id}/attachments/${uploaded.body.id}`)
      .expect(404);
    await teammate.agent
      .delete(`/api/tasks/${task.id}/attachments/nope`)
      .expect(404);
  });
});

describe("board reads", () => {
  it("caps a column at the requested limit and says how much was left out", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const backlog = sectionNamed(board, "Backlog");
    for (let index = 0; index < 12; index += 1) {
      await createTask(owner, board.projectId, { sectionId: backlog.id });
    }

    const res = await owner.agent
      .get(`/api/projects/${board.projectId}/board?limit=10`)
      .expect(200);
    expect(res.body.limit).toBe(10);
    const column = res.body.sections.find(
      (s: { id: string }) => s.id === backlog.id,
    );
    expect(column.tasks).toHaveLength(10);
    // The cap is honest: the reader can tell 10-of-12 apart from an empty-but-fully-loaded column.
    expect(column.total).toBe(12);
    expect(column.truncated).toBe(true);

    await owner.agent
      .get(`/api/projects/${board.projectId}/board?limit=1`)
      .expect(400);
    await owner.agent
      .get(`/api/projects/${board.projectId}/board?limit=abc`)
      .expect(400);
  });

  it("numbers cards by creation order within the project, and reissues numbers on delete", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const first = await createTask(owner, board.projectId, {
      title: "First in",
    });
    const second = await createTask(owner, board.projectId, {
      title: "Second in",
    });

    const res = await owner.agent
      .get(`/api/projects/${board.projectId}/board`)
      .expect(200);
    const byId = new Map<string, number>(
      res.body.sections
        .flatMap((s: { tasks: Card[] }) => s.tasks)
        .map((t: Card) => [t.id, t.number]),
    );
    expect(byId.get(first.id as string)).toBe(1);
    expect(byId.get(second.id as string)).toBe(2);

    // Display-only numbering: after a delete the remaining cards close the gap, which is why
    // the number is never a stable identifier or a link.
    await owner.agent.delete(`/api/tasks/${first.id}`).expect(200);
    const after = await owner.agent
      .get(`/api/projects/${board.projectId}/board`)
      .expect(200);
    const survivor = after.body.sections
      .flatMap((s: { tasks: Card[] }) => s.tasks)
      .find((t: Card) => t.id === second.id);
    expect(survivor.number).toBe(1);
  });

  it("bounds the task timeline and reports the history it skipped", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);
    const limit = Number(process.env.TIMELINE_ITEM_LIMIT ?? 200);
    const rows = limit + 5;
    await prisma.activity.createMany({
      data: Array.from({ length: rows }, () => ({
        orgId: owner.orgId,
        projectId: board.projectId,
        taskId: task.id as string,
        actorId: owner.userId,
        type: "task.updated",
      })),
    });
    // Creation itself wrote a row too, so the expectation counts the table rather than `rows`.
    const history = await prisma.activity.count({
      where: { taskId: task.id as string },
    });

    const feed = await owner.agent
      .get(`/api/tasks/${task.id}/activity`)
      .expect(200);
    expect(feed.body.limit).toBe(limit);
    expect(feed.body.items).toHaveLength(limit);
    expect(feed.body.hiddenOlder).toBe(history - limit);

    const detail = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
    expect(detail.body.olderHidden).toBe(history - limit);
  });
});

describe("bulk actions", () => {
  const bulk = (agent: Agent, orgId: string, body: Record<string, unknown>) =>
    agent.post(`/api/organizations/${orgId}/tasks/bulk`).send(body);

  it("applies one action to many tasks and files a single summary row", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const a = await createTask(owner, board.projectId);
    const b = await createTask(owner, board.projectId);

    const res = await bulk(owner.agent, owner.orgId, {
      ids: [a.id, b.id],
      action: "status",
      status: "in_progress",
    }).expect(200);
    expect(res.body.failed).toEqual([]);
    expect(new Set(res.body.updated as string[])).toEqual(
      new Set([a.id, b.id]),
    );

    const rows = await prisma.task.findMany({
      where: { id: { in: [a.id as string, b.id as string] } },
    });
    expect(rows.every((row) => row.status === "in_progress")).toBe(true);
    // The batch is an optimisation, not a different code path: each card keeps its own history.
    expect(
      await prisma.activity.count({
        where: { taskId: a.id as string, type: "task.status_changed" },
      }),
    ).toBe(1);
    expect(
      await prisma.activity.count({
        where: { taskId: b.id as string, type: "task.status_changed" },
      }),
    ).toBe(1);
    expect(
      await prisma.activity.count({
        where: { orgId: owner.orgId, type: "task.bulk_updated" },
      }),
    ).toBe(1);
  });

  it("reports a per-id failure instead of discarding the tasks it could edit", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const shared = await createProject(owner);
    const editable = await createTask(owner, shared.projectId, {
      assigneeIds: [teammate.userId],
    });
    const hidden = await createTask(
      owner,
      (await createProject(owner, { visibility: "private" })).projectId,
    );

    const res = await bulk(teammate.agent, owner.orgId, {
      ids: [editable.id, hidden.id],
      action: "priority",
      priority: "high",
    }).expect(200);
    expect(res.body.updated).toEqual([editable.id]);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].id).toBe(hidden.id);

    expect(
      await prisma.task.findUnique({ where: { id: editable.id as string } }),
    ).toMatchObject({ priority: "high" });
    expect(
      await prisma.task.findUnique({ where: { id: hidden.id as string } }),
    ).toMatchObject({ priority: "none" });
  });

  it("refuses to touch another organization tasks and to file history there", async () => {
    const mine = await signUp();
    const theirs = await signUp();
    const board = await createProject(mine);
    const task = await createTask(mine, board.projectId);

    const res = await bulk(theirs.agent, theirs.orgId, {
      ids: [task.id],
      action: "delete",
    }).expect(200);
    expect(res.body.updated).toEqual([]);
    expect(res.body.failed[0]).toMatchObject({
      id: task.id,
      reason: expect.stringContaining("this organization"),
    });
    expect(
      await prisma.task.findUnique({ where: { id: task.id as string } }),
    ).toMatchObject({ deletedAt: null });
    expect(
      await prisma.activity.count({
        where: { orgId: theirs.orgId, type: "task.bulk_updated" },
      }),
    ).toBe(0);

    // A stranger naming someone else's workspace is rejected before any task is read.
    await bulk(theirs.agent, mine.orgId, {
      ids: [task.id],
      action: "delete",
    }).expect(403);
  });

  it("caps the batch size and requires the action payload", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);

    const ids = Array.from({ length: 101 }, () => task.id);
    const tooMany = await bulk(owner.agent, owner.orgId, {
      ids,
      action: "status",
      status: "done",
    }).expect(400);
    // The envelope message is deliberately generic; the zod detail says which field and why.
    expect(tooMany.body.error.details).toContainEqual(
      expect.objectContaining({
        path: "ids",
        message: expect.stringContaining("100"),
      }),
    );

    // A missing payload is refused up front rather than turned into per-id failures.
    const noStatus = await bulk(owner.agent, owner.orgId, {
      ids: [task.id],
      action: "status",
    }).expect(400);
    expect(noStatus.body.error.details).toEqual([
      {
        path: "status",
        message: expect.stringContaining("which status to set"),
      },
    ]);

    await bulk(owner.agent, owner.orgId, { ids: [], action: "delete" }).expect(
      400,
    );
    await bulk(owner.agent, owner.orgId, {
      ids: [task.id],
      action: "teleport",
    }).expect(400);

    // An empty set is still a batch, and `replace` with nobody is how a card gets unassigned.
    await bulk(owner.agent, owner.orgId, {
      ids: [task.id],
      action: "assign",
      assigneeIds: [],
      assignMode: "replace",
    }).expect(200);
  });

  it("moves, assigns and deletes a set in one round trip", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const target = sectionNamed(board, "Done");
    const tasks = [
      await createTask(owner, board.projectId),
      await createTask(owner, board.projectId),
    ];

    await bulk(owner.agent, owner.orgId, {
      ids: tasks.map((t) => t.id),
      action: "move",
      sectionId: target.id,
      inheritSectionStatus: true,
    }).expect(200);
    const moved = await prisma.task.findMany({
      where: { id: { in: tasks.map((t) => t.id as string) } },
    });
    expect(
      moved.every(
        (row) => row.sectionId === target.id && row.status === "done",
      ),
    ).toBe(true);

    await bulk(owner.agent, owner.orgId, {
      ids: tasks.map((t) => t.id),
      action: "assign",
      assigneeIds: [teammate.userId],
      assignMode: "replace",
    }).expect(200);
    expect(
      await prisma.taskAssignee.count({
        where: {
          userId: teammate.userId,
          taskId: { in: tasks.map((t) => t.id as string) },
        },
      }),
    ).toBe(2);

    await bulk(owner.agent, owner.orgId, {
      ids: tasks.map((t) => t.id),
      action: "delete",
    }).expect(200);
    const afterDelete = await prisma.task.findMany({
      where: { id: { in: tasks.map((t) => t.id as string) } },
    });
    // A bulk delete is the same soft delete as the single-card route, so the rows survive.
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.every((row) => row.deletedAt !== null)).toBe(true);
  });
});

describe("deleting a task", () => {
  it("soft-deletes it and keeps the audit trail", async () => {
    const owner = await signUp();
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId);
    await owner.agent
      .post(`/api/tasks/${task.id}/comments`)
      .send({ body: "Keep this" })
      .expect(201);

    await owner.agent.delete(`/api/tasks/${task.id}`).expect(200);

    await owner.agent.get(`/api/tasks/${task.id}`).expect(404);
    const list = await owner.agent
      .get(
        `/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`,
      )
      .expect(200);
    expect(list.body.items).toHaveLength(0);
    const boardAfter = await owner.agent
      .get(`/api/projects/${board.projectId}/board`)
      .expect(200);
    expect(boardAfter.body.sections[0].tasks).toHaveLength(0);

    const row = await prisma.task.findUnique({
      where: { id: task.id as string },
    });
    expect(row!.deletedAt).not.toBeNull();
    expect(
      await prisma.comment.count({ where: { taskId: task.id as string } }),
    ).toBe(1);

    const duplicate = await owner.agent
      .delete(`/api/tasks/${task.id}`)
      .expect(404);
    expect(duplicate.body.error.code).toBe("not_found");
  });

  it("lets a plain assignee edit but not delete someone else task", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner);
    const task = await createTask(owner, board.projectId, {
      assigneeIds: [teammate.userId],
    });

    await teammate.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ title: unique("Reworded") })
      .expect(200);
    await teammate.agent.delete(`/api/tasks/${task.id}`).expect(403);
  });

  it("blocks writes on a private project the actor is not part of", async () => {
    const owner = await signUp();
    const teammate = await addMember(owner, "member");
    const board = await createProject(owner, { visibility: "private" });
    const task = await createTask(owner, board.projectId);

    await teammate.agent
      .patch(`/api/tasks/${task.id}`)
      .send({ title: "Nope" })
      .expect(403);
    await teammate.agent.get(`/api/tasks/${task.id}`).expect(403);
  });
});
