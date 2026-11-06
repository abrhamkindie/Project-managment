import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { signUp, type Workspace } from './helpers.js';
import { nextOccurrence, materializeRecurrences, parseRecurrence } from '../src/services/recurrence.service.js';

describe('recurrence.nextOccurrence (pure)', () => {
    it('daily advances by the interval in real 24h steps', () => {
        const from = new Date('2026-03-10T09:00:00Z');
        expect(nextOccurrence({ freq: 'daily', interval: 1 }, from).toISOString()).toBe('2026-03-11T09:00:00.000Z');
        expect(nextOccurrence({ freq: 'daily', interval: 3 }, from).toISOString()).toBe('2026-03-13T09:00:00.000Z');
    });

    it('weekly without byDays is a plain 7-day step', () => {
        const from = new Date('2026-01-05T12:00:00Z'); // a Monday
        expect(nextOccurrence({ freq: 'weekly', interval: 1 }, from).getUTCDate()).toBe(12);
    });

    it('weekly byDays lands on the next allowed weekday, keeping time-of-day', () => {
        const monday = new Date('2026-01-05T15:30:00Z'); // ISO weekday 1
        // Allowed {Wed(3), Fri(5)}: from Monday the next is Wednesday the same week.
        const wed = nextOccurrence({ freq: 'weekly', interval: 1, byDays: [3, 5] }, monday);
        expect(wed.toISOString()).toBe('2026-01-07T15:30:00.000Z');
        // From that Wednesday the next allowed is Friday.
        const fri = nextOccurrence({ freq: 'weekly', interval: 1, byDays: [3, 5] }, wed);
        expect(fri.toISOString()).toBe('2026-01-09T15:30:00.000Z');
    });

    it('monthly clamps to the last valid day of shorter months (leap-aware)', () => {
        const jan31 = new Date('2026-01-31T00:00:00Z');
        // 2026 is not a leap year → Feb has 28 days.
        expect(nextOccurrence({ freq: 'monthly', interval: 1 }, jan31).toISOString()).toBe('2026-02-28T00:00:00.000Z');
        // 2028 is a leap year → Feb has 29.
        const jan31_2028 = new Date('2028-01-31T00:00:00Z');
        expect(nextOccurrence({ freq: 'monthly', interval: 1 }, jan31_2028).toISOString()).toBe('2028-02-29T00:00:00.000Z');
        // Normal day carries through unchanged.
        const mar10 = new Date('2026-03-10T08:00:00Z');
        expect(nextOccurrence({ freq: 'monthly', interval: 2 }, mar10).toISOString()).toBe('2026-05-10T08:00:00.000Z');
    });

    it('parseRecurrence tolerates null and malformed JSON', () => {
        expect(parseRecurrence(null)).toBeNull();
        expect(parseRecurrence('not json')).toBeNull();
        expect(parseRecurrence('{"freq":"nope"}')).toBeNull();
        expect(parseRecurrence('{"freq":"daily","interval":2}')).toEqual({ freq: 'daily', interval: 2 });
    });
});

describe('recurrence.materializeRecurrences (job)', () => {
    let ctx: Workspace;

    beforeAll(async () => {
        ctx = await signUp();
    });

    const newProject = () =>
        prisma.project.create({
            data: {
                name: 'proj',
                orgId: ctx.orgId,
                createdById: ctx.userId,
                sections: { create: [{ name: 'Backlog', position: 1 }, { name: 'Done', position: 2, isDone: true }] },
            },
            include: { sections: true },
        });

    const openSection = (project: { sections: { id: string; name: string; isDone: boolean }[] }) =>
        project.sections.find((s) => !s.isDone)!;

    // The sweep is a global cron, so assert per-project clone counts to stay isolated from other rows.
    const cloneCount = (projectId: string) =>
        prisma.task.count({ where: { projectId, recurrenceSourceId: { not: null } } });

    it('clones the next instance when a recurring task is completed', async () => {
        const project = await newProject();
        const todo = openSection(project);
        const source = await prisma.task.create({
            data: {
                projectId: project.id,
                sectionId: todo.id,
                createdById: ctx.userId,
                title: 'Weekly review',
                status: 'done',
                completedAt: new Date(),
                dueDate: new Date('2026-01-05T00:00:00Z'),
                recurrence: JSON.stringify({ freq: 'weekly', interval: 1 }),
            },
        });

        await materializeRecurrences(new Date('2026-01-06T00:00:00Z'));
        expect(await cloneCount(project.id)).toBe(1);

        const clone = await prisma.task.findFirst({ where: { recurrenceSourceId: source.id } });
        expect(clone).not.toBeNull();
        expect(clone!.status).toBe('todo');
        expect(clone!.completedAt).toBeNull();
        expect(clone!.dueDate!.toISOString()).toBe('2026-01-12T00:00:00.000Z');
        expect(clone!.recurrence).toBe(source.recurrence);

        // Idempotent: a second sweep must not fork another successor for the same source.
        await materializeRecurrences(new Date('2026-01-06T00:00:00Z'));
        expect(await cloneCount(project.id)).toBe(1);
    });

    it('spawns when the due window passes even though the task is still open', async () => {
        const project = await newProject();
        const todo = openSection(project);
        const source = await prisma.task.create({
            data: {
                projectId: project.id,
                sectionId: todo.id,
                createdById: ctx.userId,
                title: 'Standup',
                status: 'todo',
                dueDate: new Date('2026-02-01T00:00:00Z'),
                recurrence: JSON.stringify({ freq: 'daily', interval: 1 }),
            },
        });

        await materializeRecurrences(new Date('2026-02-03T00:00:00Z'));
        const clone = await prisma.task.findFirst({ where: { recurrenceSourceId: source.id } });
        expect(clone).not.toBeNull();
        // Rolled forward strictly past `now`, not stuck at the missed 2026-02-02.
        expect(clone!.dueDate!.getTime()).toBeGreaterThan(new Date('2026-02-03T00:00:00Z').getTime());
    });

    it('leaves non-recurring tasks untouched', async () => {
        const project = await newProject();
        const todo = openSection(project);
        await prisma.task.create({
            data: { projectId: project.id, sectionId: todo.id, createdById: ctx.userId, title: 'plain', status: 'done', completedAt: new Date() },
        });
        await materializeRecurrences(new Date());
        expect(await cloneCount(project.id)).toBe(0);
    });
});
