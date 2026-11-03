import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addMember, createProject, createTask, sectionNamed, signUp, unique } from './helpers.js';
import { TEST_UPLOAD_DIR } from './env.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * The task lifecycle: creation, editing, subtasks, Kanban moves, assignment,
 * discussion, attachments and the "My tasks" read model.
 *
 * These tests double as executable documentation of the response contract: a task
 * mutation answers with the flat card, and `GET /tasks/:id` answers with that card plus
 * its project, subtasks, parent and timeline.
 */

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('creating a task', () => {
    it('applies defaults, lands at the bottom of the first open column and logs the event', async () => {
        const owner = await signUp();
        const board = await createProject(owner);

        const first = await createTask(owner, board.projectId, { title: 'Draft the brief' });
        expect(first).toMatchObject({
            projectId: board.projectId,
            sectionId: sectionNamed(board, 'Backlog').id,
            status: 'todo',
            priority: 'none',
            isMilestone: false,
            completedAt: null,
            position: 1000,
            subtaskCount: 0,
            commentCount: 0,
            assignees: [],
        });
        expect(first.id).toBeTypeOf('string');

        // New cards append, so a drag never has to renumber the column.
        const second = await createTask(owner, board.projectId, { title: 'Collect logos' });
        expect(second.position).toBe(2000);

        const activity = await prisma.activity.findFirst({ where: { taskId: first.id as string, type: 'task.created' } });
        expect(JSON.parse(activity!.meta).title).toBe('Draft the brief');
    });

    it('stamps completedAt when a card is created already done', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { status: 'done' });

        expect(task.completedAt).toBeTypeOf('string');
        expect(task.sectionId).toBe(sectionNamed(board, 'Done').id);
    });

    it('notifies teammates who are assigned, but never the actor', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);

        const task = await createTask(owner, board.projectId, { assigneeIds: [teammate.userId, owner.userId] });
        expect(task.assigneeIds).toEqual(expect.arrayContaining([teammate.userId, owner.userId]));
        // The actor is the primary when they assign themselves, so "my work" sorts first.
        const assignees = task.assignees as { id: string; isPrimary: boolean }[];
        expect(assignees.find((a) => a.id === owner.userId)?.isPrimary).toBe(true);

        expect(await prisma.notification.count({ where: { userId: teammate.userId, type: 'task.assigned' } })).toBe(1);
        expect(await prisma.notification.count({ where: { userId: owner.userId } })).toBe(0);

        const inbox = await teammate.agent.get('/api/notifications').expect(200);
        expect(inbox.body.unread).toBe(1);
        expect(inbox.body.items[0].link).toBe(`/projects/${board.projectId}/tasks/${task.id}`);

        // The card is reachable in the teammate's inbox view.
        const mine = await teammate.agent.get(`/api/organizations/${owner.orgId}/my-tasks`).expect(200);
        expect(mine.body.groups[0].tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    });

    it('refuses assignees from outside the organization', async () => {
        const owner = await signUp();
        const stranger = await signUp();
        const board = await createProject(owner);

        const res = await owner.agent
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .send({ projectId: board.projectId, title: 'Bad assignment', assigneeIds: [stranger.userId] })
            .expect(403);
        expect(res.body.error.details).toEqual({ userIds: [stranger.userId] });
    });

    it('validates the title and the project', async () => {
        const owner = await signUp();
        const board = await createProject(owner);

        await owner.agent
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .send({ projectId: board.projectId, title: '   ' })
            .expect(400);
        await owner.agent
            .post(`/api/organizations/${owner.orgId}/tasks`)
            .send({ projectId: 'missing-project-id', title: 'Orphan' })
            .expect(404);
    });
});

describe('editing a task', () => {
    it('records a status change, mirrors completedAt and can reopen', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });

        const done = await owner.agent.patch(`/api/tasks/${task.id}`).send({ status: 'done' }).expect(200);
        expect(done.body).toMatchObject({ id: task.id, status: 'done' });
        expect(done.body.completedAt).toBeTypeOf('string');

        const reopened = await owner.agent.patch(`/api/tasks/${task.id}`).send({ status: 'in_progress' }).expect(200);
        expect(reopened.body.completedAt).toBeNull();

        const types = (
            await prisma.activity.findMany({ where: { taskId: task.id as string }, select: { type: true } })
        ).map((row) => row.type);
        expect(types).toEqual(
            expect.arrayContaining(['task.created', 'task.assigned', 'task.status_changed', 'task.completed', 'task.reopened']),
        );

        // The assignee hears about the movement even though they did not cause it.
        expect(await prisma.notification.count({ where: { userId: teammate.userId, type: 'task.status_changed' } })).toBe(2);
    });

    it('answers a no-op patch without writing history', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { priority: 'high' });

        await owner.agent.patch(`/api/tasks/${task.id}`).send({ priority: 'high' }).expect(200);
        expect(await prisma.activity.count({ where: { taskId: task.id as string } })).toBe(1);
    });

    it('quick-completes from the board action', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const res = await owner.agent.post(`/api/tasks/${task.id}/complete`).expect(200);
        expect(res.body).toMatchObject({ id: task.id, status: 'done' });
    });

    it('keeps the card in a section that matches the status it was moved to', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { sectionId: sectionNamed(board, 'Backlog').id });

        const res = await owner.agent
            .patch(`/api/tasks/${task.id}`)
            .send({ status: 'done', sectionId: sectionNamed(board, 'Done').id })
            .expect(200);
        expect(res.body.sectionId).toBe(sectionNamed(board, 'Done').id);

        // A section from another project is not a valid target.
        const other = await createProject(owner);
        await owner.agent.patch(`/api/tasks/${task.id}`).send({ sectionId: sectionNamed(other, 'Backlog').id }).expect(400);
    });
});

describe('subtasks', () => {
    it('creates children, counts them and shows them on the parent', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const parent = await createTask(owner, board.projectId, { title: 'Ship release' });
        const child = await createTask(owner, board.projectId, { title: 'Write notes', parentTaskId: parent.id });

        expect(child.parentTaskId).toBe(parent.id);
        expect(await prisma.activity.count({ where: { taskId: child.id as string, type: 'subtask.created' } })).toBe(1);

        const detail = await owner.agent.get(`/api/tasks/${parent.id}`).expect(200);
        expect(detail.body.subtasks.map((t: { id: string }) => t.id)).toEqual([child.id]);
        expect(detail.body.subtaskCount).toBe(1);

        const childDetail = await owner.agent.get(`/api/tasks/${child.id}`).expect(200);
        expect(childDetail.body.parent.id).toBe(parent.id);
    });

    it('refuses to nest a task below itself, below another project, or in a cycle', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const other = await createProject(owner);
        const parent = await createTask(owner, board.projectId);
        const child = await createTask(owner, board.projectId, { parentTaskId: parent.id });
        const foreign = await createTask(owner, other.projectId);

        await owner.agent.patch(`/api/tasks/${parent.id}`).send({ parentTaskId: parent.id }).expect(400);
        await owner.agent.patch(`/api/tasks/${parent.id}`).send({ parentTaskId: foreign.id }).expect(400);
        await owner.agent.patch(`/api/tasks/${parent.id}`).send({ parentTaskId: 'nope' }).expect(404);

        const cycle = await owner.agent.patch(`/api/tasks/${parent.id}`).send({ parentTaskId: child.id }).expect(409);
        expect(cycle.body.error.message).toMatch(/circular/);
    });
});

describe('assignment', () => {
    it('replaces, adds and removes assignees, telling only who changed', async () => {
        const owner = await signUp();
        const a = await addMember(owner, 'member');
        const b = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const replaced = await owner.agent.put(`/api/tasks/${task.id}/assignees`).send({ userIds: [a.userId] }).expect(200);
        expect(replaced.body.assigneeIds).toEqual([a.userId]);
        // The very first assignee becomes the owner of the card.
        expect(replaced.body.assignees[0]).toMatchObject({ id: a.userId, isPrimary: true });

        const added = await owner.agent
            .put(`/api/tasks/${task.id}/assignees`)
            .send({ userIds: [b.userId], mode: 'add' })
            .expect(200);
        expect(added.body.assigneeIds).toEqual(expect.arrayContaining([a.userId, b.userId]));

        const removed = await owner.agent
            .put(`/api/tasks/${task.id}/assignees`)
            .send({ userIds: [a.userId], mode: 'remove' })
            .expect(200);
        expect(removed.body.assigneeIds).toEqual([b.userId]);

        const types = (await prisma.activity.findMany({ where: { taskId: task.id }, select: { type: true } })).map(
            (row) => row.type,
        );
        expect(types).toEqual(expect.arrayContaining(['task.assigned', 'task.unassigned']));
        expect(await prisma.notification.count({ where: { userId: b.userId, type: 'task.assigned' } })).toBe(1);
        expect(await prisma.notification.count({ where: { userId: a.userId, type: 'task.assigned' } })).toBe(1);

        await owner.agent.put(`/api/tasks/${task.id}/assignees`).send({ userIds: ['ghost'], mode: 'add' }).expect(403);
    });
});

describe('moving on the board', () => {
    it('inherits the column status and slots between neighbours', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const backlog = sectionNamed(board, 'Backlog');
        const done = sectionNamed(board, 'Done');

        const one = await createTask(owner, board.projectId, { title: 'One' });
        const two = await createTask(owner, board.projectId, { title: 'Two' });

        const moved = await owner.agent
            .post(`/api/tasks/${one.id}/move`)
            .send({ sectionId: done.id, beforeTaskId: null, afterTaskId: null })
            .expect(200);
        // Dropping into a done column completes the card, and vice versa.
        expect(moved.body).toMatchObject({ sectionId: done.id, status: 'done' });
        expect(moved.body.completedAt).toBeTypeOf('string');

        const back = await owner.agent
            .post(`/api/tasks/${one.id}/move`)
            .send({ sectionId: backlog.id, afterTaskId: two.id })
            .expect(200);
        expect(back.body).toMatchObject({ sectionId: backlog.id, status: 'in_progress' });
        expect(back.body.completedAt).toBeNull();
        expect(back.body.position).toBeGreaterThan(two.position as number);

        const types = (await prisma.activity.findMany({ where: { taskId: one.id as string }, select: { type: true } })).map(
            (row) => row.type,
        );
        expect(types).toEqual(expect.arrayContaining(['task.moved', 'task.completed', 'task.reopened']));

        // Opting out of inheritance leaves the status alone.
        const held = await owner.agent
            .post(`/api/tasks/${two.id}/move`)
            .send({ sectionId: done.id, inheritSectionStatus: false })
            .expect(200);
        expect(held.body.status).toBe('todo');
    });

    it('rejects a column from another project', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const other = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        await owner.agent.post(`/api/tasks/${task.id}/move`).send({ sectionId: sectionNamed(other, 'Done').id }).expect(400);
    });
});

describe('listing and filtering', () => {
    it('filters by status, overdue flag, assignee and text', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);

        const todo = await createTask(owner, board.projectId, { title: 'Zebra migration', assigneeIds: [owner.userId] });
        const done = await createTask(owner, board.projectId, { status: 'done' });
        const late = await createTask(owner, board.projectId, {
            title: 'Paying audit',
            dueDate: hoursFromNow(-24),
            assigneeIds: [owner.userId],
        });
        await createTask(owner, board.projectId, { title: 'Assigned away', assigneeIds: [teammate.userId] });

        const byStatus = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&status=done`)
            .expect(200);
        expect(byStatus.body.items.map((t: { id: string }) => t.id)).toEqual([done.id]);

        const overdue = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&overdue=true`)
            .expect(200);
        expect(overdue.body.items.map((t: { id: string }) => t.id)).toEqual([late.id]);
        expect(overdue.body.items[0].isOverdue).toBe(true);

        const mine = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?assigneeId=me&projectId=${board.projectId}`)
            .expect(200);
        expect(mine.body.items.map((t: { id: string }) => t.id)).toEqual(
            expect.arrayContaining([todo.id, late.id]),
        );

        const searched = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&search=zebra`)
            .expect(200);
        expect(searched.body.items.map((t: { id: string }) => t.id)).toEqual([todo.id]);

        const paged = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&pageSize=2&page=2`)
            .expect(200);
        expect(paged.body).toMatchObject({ total: 4, page: 2, pageSize: 2, pages: 2 });
        expect(paged.body.items).toHaveLength(2);

        // Rejected filters fail loudly instead of silently widening the result set.
        await owner.agent.get(`/api/organizations/${owner.orgId}/tasks?status=parked`).expect(400);
    });

    it('reads a bare due date as the whole day, so work due today is not late yet', async () => {
        const owner = await signUp();
        const board = await createProject(owner);

        // What a date picker sends: no time, no offset. `z.coerce.date()` lands it on UTC midnight.
        const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

        const dueToday = await createTask(owner, board.projectId, { title: 'Due today', dueDate: utcDay(0) });
        const dueYesterday = await createTask(owner, board.projectId, { title: 'Slipped', dueDate: utcDay(-1) });

        const late = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&overdue=true`)
            .expect(200);
        expect(late.body.items.map((t: { id: string }) => t.id)).toEqual([dueYesterday.id]);

        // The row keeps the calendar day the picker sent, and lateness is judged on that day only.
        expect(String(dueToday.dueDate).startsWith(utcDay(0))).toBe(true);
        expect(dueToday.isOverdue).toBe(false);
    });

    it('orders by due date with undated cards last', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        await createTask(owner, board.projectId, { title: 'No date' });
        const soon = await createTask(owner, board.projectId, { title: 'Soon', dueDate: hoursFromNow(2) });
        const later = await createTask(owner, board.projectId, { title: 'Later', dueDate: hoursFromNow(48) });

        const res = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&orderBy=dueDate`)
            .expect(200);
        expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([soon.id, later.id, expect.anything()]);

        const reversed = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&orderBy=createdAt&order=desc`)
            .expect(200);
        expect(reversed.body.items[0].id).toBe(later.id);
    });

    it('hides subtasks from a plain board listing unless asked', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const parent = await createTask(owner, board.projectId);
        const child = await createTask(owner, board.projectId, { parentTaskId: parent.id });

        const top = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&includeSubtasks=false`)
            .expect(200);
        expect(top.body.items.map((t: { id: string }) => t.id)).toEqual([parent.id]);
        expect(top.body.total).toBe(1);

        const all = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`)
            .expect(200);
        expect(all.body.items.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([parent.id, child.id]));
    });

    it('groups open work by project in My tasks', async () => {
        const owner = await signUp();
        const board = await createProject(owner, { name: 'Atlas Web' });
        const other = await createProject(owner, { name: 'Atlas Docs' });
        const kept = await createTask(owner, board.projectId, { assigneeIds: [owner.userId] });
        await createTask(owner, other.projectId, { assigneeIds: [owner.userId] });
        const finished = await createTask(owner, board.projectId, { assigneeIds: [owner.userId], status: 'done' });

        const res = await owner.agent.get(`/api/organizations/${owner.orgId}/my-tasks`).expect(200);
        expect(res.body.groups.map((g: { project: { name: string } }) => g.project.name)).toEqual(
            expect.arrayContaining(['Atlas Web', 'Atlas Docs']),
        );
        const ids = res.body.groups.flatMap((g: { tasks: { id: string }[] }) => g.tasks.map((t: { id: string }) => t.id));
        expect(ids).toContain(kept.id);
        expect(ids).not.toContain(finished.id);
    });
});

describe('labels', () => {
    it('attaches org labels and rejects unknown ones', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const label = await owner.agent
            .post(`/api/organizations/${owner.orgId}/labels`)
            .send({ name: 'Bug', color: '#dc2626' })
            .expect(201);

        const tagged = await owner.agent.put(`/api/tasks/${task.id}/labels`).send({ labelIds: [label.body.id] }).expect(200);
        expect(tagged.body.labels).toEqual([{ id: label.body.id, name: 'Bug', color: '#dc2626' }]);

        await owner.agent.put(`/api/tasks/${task.id}/labels`).send({ labelIds: ['not-a-label'] }).expect(400);

        const byLabel = await owner.agent
            .get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}&labelId=${label.body.id}`)
            .expect(200);
        expect(byLabel.body.items).toHaveLength(1);

        const cleared = await owner.agent.put(`/api/tasks/${task.id}/labels`).send({ labelIds: [] }).expect(200);
        expect(cleared.body.labels).toEqual([]);
    });
});

describe('discussion', () => {
    it('adds, edits and soft-deletes comments, notifying watchers', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });

        const comment = await teammate.agent
            .post(`/api/tasks/${task.id}/comments`)
            .send({ body: 'Blocked on the API contract.' })
            .expect(201);
        expect(comment.body).toMatchObject({
            taskId: task.id,
            body: 'Blocked on the API contract.',
            author: { id: teammate.userId },
        });

        // The creator watches their own task.
        expect(await prisma.notification.count({ where: { userId: owner.userId, type: 'comment.added' } })).toBe(1);
        expect(await prisma.activity.count({ where: { taskId: task.id as string, type: 'comment.added' } })).toBe(1);

        const edited = await teammate.agent.patch(`/api/comments/${comment.body.id}`).send({ body: 'Unblocked now.' }).expect(200);
        expect(edited.body.body).toBe('Unblocked now.');
        await owner.agent.patch(`/api/comments/${comment.body.id}`).send({ body: 'Not mine' }).expect(403);

        await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: '' }).expect(400);

        await teammate.agent.delete(`/api/comments/${comment.body.id}`).expect(200);
        const list = await owner.agent.get(`/api/tasks/${task.id}/comments`).expect(200);
        expect(list.body.items).toHaveLength(0);
        const row = await prisma.comment.findUnique({ where: { id: comment.body.id } });
        expect(row!.deletedAt).not.toBeNull();
        // Deleting someone else's comment needs moderation rights.
        const colleague = await addMember(owner, 'member');
        const theirs = await colleague.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Mine' }).expect(201);
        await teammate.agent.delete(`/api/comments/${theirs.body.id}`).expect(403);
    });

    it('interleaves comments and activity in the timeline', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);
        await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'First' }).expect(201);
        await owner.agent.patch(`/api/tasks/${task.id}`).send({ priority: 'urgent' }).expect(200);

        const detail = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
        const kinds = detail.body.timeline.map((entry: { kind: string }) => entry.kind);
        expect(kinds).toEqual(expect.arrayContaining(['activity', 'comment']));
        expect(detail.body.timeline.every((entry: { createdAt: string }) => typeof entry.createdAt === 'string')).toBe(true);
        expect(detail.body.project).toMatchObject({ id: board.projectId, name: board.name });
        expect(detail.body.commentCount).toBe(1);

        const feed = await owner.agent.get(`/api/tasks/${task.id}/activity`).expect(200);
        expect(feed.body.items).toHaveLength(detail.body.timeline.length);
        expect(feed.body.items[0]).toMatchObject({ kind: 'activity', type: 'task.created', actor: { id: owner.userId } });
    });
});

describe('attachments', () => {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4nGP8z8DwnwEPYMQGZADGJQYE8p7C+QAAAABJRU5ErkJggg==',
        'base64',
    );

    it('uploads, serves and deletes a file', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const uploaded = await teammate.agent
            .post(`/api/tasks/${task.id}/attachments`)
            .attach('file', png, { filename: 'diagram.png', contentType: 'image/png' })
            .expect(201);

        expect(uploaded.body).toMatchObject({
            filename: 'diagram.png',
            mimeType: 'image/png',
            size: png.byteLength,
            url: `/api/tasks/${task.id}/attachments/${uploaded.body.id}/download`,
        });
        expect(await prisma.activity.count({ where: { taskId: task.id as string, type: 'attachment.added' } })).toBe(1);

        const cardInbox = await owner.agent.get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`).expect(200);
        expect(cardInbox.body.items[0].attachments).toHaveLength(1);

        const download = await owner.agent.get(uploaded.body.url).expect(200).buffer();
        expect(download.body).toBeInstanceOf(Buffer);
        expect(download.body.equals(png)).toBe(true);
        expect(download.headers['content-disposition']).toContain('attachment; filename="diagram.png"');

        const row = await prisma.attachment.findUniqueOrThrow({ where: { id: uploaded.body.id } });
        await teammate.agent.delete(`/api/tasks/${task.id}/attachments/${uploaded.body.id}`).expect(200);
        expect(await prisma.attachment.findUnique({ where: { id: uploaded.body.id } })).toBeNull();
        await expect(stat(path.join(TEST_UPLOAD_DIR, row.storageKey))).rejects.toThrow();

        await owner.agent.get(uploaded.body.url).expect(404);
    });

    it('rejects disallowed types and empty uploads', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const bad = await owner.agent
            .post(`/api/tasks/${task.id}/attachments`)
            .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'page.html', contentType: 'text/html' })
            .expect(400);
        expect(bad.body.error.message).toMatch(/Unsupported file type/);

        await owner.agent.post(`/api/tasks/${task.id}/attachments`).expect(400);
    });

    it('hides other people uploads from a plain member', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);

        const uploaded = await owner.agent
            .post(`/api/tasks/${task.id}/attachments`)
            .attach('file', Buffer.from('notes'), { filename: 'notes.txt', contentType: 'text/plain' })
            .expect(201);

        await teammate.agent.delete(`/api/tasks/${task.id}/attachments/${uploaded.body.id}`).expect(404);
        await teammate.agent.delete(`/api/tasks/${task.id}/attachments/nope`).expect(404);
    });
});

describe('deleting a task', () => {
    it('soft-deletes it and keeps the audit trail', async () => {
        const owner = await signUp();
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId);
        await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Keep this' }).expect(201);

        await owner.agent.delete(`/api/tasks/${task.id}`).expect(200);

        await owner.agent.get(`/api/tasks/${task.id}`).expect(404);
        const list = await owner.agent.get(`/api/organizations/${owner.orgId}/tasks?projectId=${board.projectId}`).expect(200);
        expect(list.body.items).toHaveLength(0);
        const boardAfter = await owner.agent.get(`/api/projects/${board.projectId}/board`).expect(200);
        expect(boardAfter.body.sections[0].tasks).toHaveLength(0);

        const row = await prisma.task.findUnique({ where: { id: task.id as string } });
        expect(row!.deletedAt).not.toBeNull();
        expect(await prisma.comment.count({ where: { taskId: task.id as string } })).toBe(1);

        const duplicate = await owner.agent.delete(`/api/tasks/${task.id}`).expect(404);
        expect(duplicate.body.error.code).toBe('not_found');
    });

    it('lets a plain assignee edit but not delete someone else task', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner);
        const task = await createTask(owner, board.projectId, { assigneeIds: [teammate.userId] });

        await teammate.agent.patch(`/api/tasks/${task.id}`).send({ title: unique('Reworded') }).expect(200);
        await teammate.agent.delete(`/api/tasks/${task.id}`).expect(403);
    });

    it('blocks writes on a private project the actor is not part of', async () => {
        const owner = await signUp();
        const teammate = await addMember(owner, 'member');
        const board = await createProject(owner, { visibility: 'private' });
        const task = await createTask(owner, board.projectId);

        await teammate.agent.patch(`/api/tasks/${task.id}`).send({ title: 'Nope' }).expect(403);
        await teammate.agent.get(`/api/tasks/${task.id}`).expect(403);
    });
});
