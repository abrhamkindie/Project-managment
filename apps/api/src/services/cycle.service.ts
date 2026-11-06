import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import { OPEN_STATUSES, type CycleStatus } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import type { CreateCycleInput, UpdateCycleInput } from '../domain/schemas.js';
import { loadProjectAccess } from './access.js';
import { recordActivity } from './activity.js';

/**
 * Cycles (Linear "sprints"): time-boxed slices of a project's backlog.
 *
 * Scope semantics mirror Linear: closing a cycle moves still-open work back to the
 * project backlog and detaches the cycle, so nothing silently disappears into a
 * finished time box. Only one cycle is `active` per project at a time.
 */

const present = (cycle: {
    id: string;
    projectId: string;
    name: string;
    number: number;
    startsAt: Date;
    endsAt: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}) => ({
    id: cycle.id,
    projectId: cycle.projectId,
    name: cycle.name,
    number: cycle.number,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    status: cycle.status,
    createdAt: cycle.createdAt.toISOString(),
    updatedAt: cycle.updatedAt.toISOString(),
});

export async function listCycles(user: AuthUser, projectId: string, status?: CycleStatus) {
    await loadProjectAccess(user, projectId);
    const rows = await prisma.cycle.findMany({
        where: { projectId, ...(status ? { status } : {}) },
        orderBy: [{ number: 'desc' }],
    });
    // Task counts per cycle ride along so the board chip can show scope without a second call.
    const counts = await prisma.task.groupBy({
        by: ['cycleId'],
        where: { projectId, cycleId: { in: rows.map((r) => r.id) }, deletedAt: null },
        _count: { _all: true },
    });
    const totalByCycle = new Map(counts.map((c) => [c.cycleId, c._count._all]));
    const doneCounts = await prisma.task.groupBy({
        by: ['cycleId'],
        where: { projectId, cycleId: { in: rows.map((r) => r.id) }, deletedAt: null, status: 'done' },
        _count: { _all: true },
    });
    const doneByCycle = new Map(doneCounts.map((c) => [c.cycleId, c._count._all]));
    return {
        items: rows.map((cycle) => ({
            ...present(cycle),
            taskCount: totalByCycle.get(cycle.id) ?? 0,
            doneCount: doneByCycle.get(cycle.id) ?? 0,
        })),
    };
}

export async function createCycle(user: AuthUser, projectId: string, input: CreateCycleInput) {
    const { project, access } = await loadProjectAccess(user, projectId);
    if (!can.editProject(access)) throw new BadRequest('You cannot manage cycles in this project');

    const top = await prisma.cycle.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: { number: true } });
    const number = (top?.number ?? 0) + 1;
    const cycle = await prisma.cycle.create({
        data: { projectId, name: input.name, number, startsAt: input.startsAt, endsAt: input.endsAt, status: 'draft' },
    });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId,
        type: 'cycle.created',
        meta: { name: cycle.name, number: cycle.number },
    });
    return present(cycle);
}

export async function updateCycle(user: AuthUser, cycleId: string, patch: UpdateCycleInput) {
    const existing = await prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!existing) throw new NotFound('Cycle not found');
    const { project, access } = await loadProjectAccess(user, existing.projectId);
    if (!can.editProject(access)) throw new BadRequest('You cannot manage cycles in this project');

    // Activating closes any other active cycle in the project first (single-active rule).
    if (patch.status === 'active' && existing.status !== 'active') {
        await prisma.cycle.updateMany({
            where: { projectId: existing.projectId, status: 'active', id: { not: cycleId } },
            data: { status: 'closed' },
        });
    }

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;
    if (patch.status !== undefined) data.status = patch.status;
    if (Object.keys(data).length === 0) return present(existing);

    const updated = await prisma.cycle.update({ where: { id: cycleId }, data });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: existing.projectId,
        type: 'cycle.updated',
        meta: { cycleId, name: updated.name, fields: Object.keys(data) },
    });
    return present(updated);
}

/**
 * Close a cycle: still-open work returns to the backlog column and loses its cycle
 * assignment, so the completed scope is a frozen snapshot and carry-over is explicit.
 */
export async function closeCycle(user: AuthUser, cycleId: string) {
    const cycle = await prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!cycle) throw new NotFound('Cycle not found');
    const { project, access } = await loadProjectAccess(user, cycle.projectId);
    if (!can.editProject(access)) throw new BadRequest('You cannot manage cycles in this project');

    const backlog = await prisma.section.findFirst({
        where: { projectId: cycle.projectId, isDone: false },
        orderBy: { position: 'asc' },
    });

    const result = await prisma.$transaction(async (tx) => {
        const carried = await tx.task.updateMany({
            where: { cycleId, deletedAt: null, status: { in: OPEN_STATUSES } },
            data: { cycleId: null, ...(backlog ? { sectionId: backlog.id } : {}) },
        });
        const closed = await tx.cycle.update({ where: { id: cycleId }, data: { status: 'closed' } });
        return { carried: carried.count, closed };
    });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: cycle.projectId,
        type: 'cycle.closed',
        meta: { cycleId, name: cycle.name, carried: result.carried },
    });
    return { ...present(result.closed), carried: result.carried };
}

export async function deleteCycle(user: AuthUser, cycleId: string) {
    const cycle = await prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!cycle) throw new NotFound('Cycle not found');
    const { access } = await loadProjectAccess(user, cycle.projectId);
    if (!can.editProject(access)) throw new BadRequest('You cannot manage cycles in this project');
    // Tasks keep existing; `cycleId` is SetNull on the relation, so deletion detaches them.
    await prisma.cycle.delete({ where: { id: cycleId } });
    return { id: cycleId };
}

/** Guard against the empty-window case slipping past the Zod refine on multi-edit. */
export function assertWindow(startsAt: Date, endsAt: Date): void {
    if (endsAt.getTime() <= startsAt.getTime()) throw new Conflict('Cycle must end after it starts');
}
