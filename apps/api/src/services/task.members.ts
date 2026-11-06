import { prisma } from '../lib/prisma.js';
import { BadRequest, Forbidden } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import type { AuthUser } from '../types/express.js';
import { assertAssignable, loadTaskAccess } from './access.js';
import { recordActivity } from './activity.js';
import { presentTask } from './presenters.js';
import { emitToProject } from '../realtime/bus.js';
import type { AssignInput } from '../domain/schemas.js';
import { announceAssignment, taskSelectIncludes } from './task.internal.js';

/**
 * The "who does this work and how is it tagged" side of tasks: assignee sets and
 * label sets. Both own their activity/notification semantics so the audit trail
 * reads the same no matter which screen triggered the change.
 */

export async function setAssignees(user: AuthUser, taskId: string, input: AssignInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot change assignment on this task');
    const requested = await assertAssignable(project.orgId, input.userIds);

    const current = await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } });
    const currentIds = current.map((c) => c.userId);

    let nextIds: string[];
    if (input.mode === 'replace') nextIds = requested;
    else if (input.mode === 'add') nextIds = [...new Set([...currentIds, ...requested])];
    else nextIds = currentIds.filter((id) => !requested.includes(id));

    const toAdd = nextIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !nextIds.includes(id));

    await prisma.$transaction([
        ...(toRemove.length ? [prisma.taskAssignee.deleteMany({ where: { taskId, userId: { in: toRemove } } })] : []),
        ...toAdd.map((userId) =>
            prisma.taskAssignee.create({ data: { taskId, userId, isPrimary: toAdd.length === 1 && currentIds.length === 0 } }),
        ),
    ]);

    if (toAdd.length) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: 'task.assigned',
            meta: { userIds: toAdd, title: task.title },
        });
        await announceAssignment({ orgId: project.orgId, project, task, assigneeIds: toAdd, actor: user, isNew: false });
    }
    if (toRemove.length) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: 'task.unassigned',
            meta: { userIds: toRemove, title: task.title },
        });
    }

    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    emitToProject(project.id, 'task:updated', presentTask(fresh));
    return presentTask(fresh);
}

export async function setLabels(user: AuthUser, taskId: string, labelIds: string[]) {
    const { project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    const labels = labelIds.length
        ? await prisma.label.findMany({ where: { id: { in: labelIds }, OR: [{ orgId: project.orgId }, { project: { orgId: project.orgId } }] } })
        : [];
    if (labels.length !== new Set(labelIds).size) throw new BadRequest('One or more labels are not available in this organization');

    await prisma.$transaction([
        prisma.taskLabel.deleteMany({ where: { taskId } }),
        prisma.taskLabel.createMany({ data: labels.map((label) => ({ taskId, labelId: label.id })) }),
    ]);
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'label.attached',
        meta: { labelIds: labels.map((l) => l.id) },
    });
    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskSelectIncludes });
    return presentTask(fresh);
}
