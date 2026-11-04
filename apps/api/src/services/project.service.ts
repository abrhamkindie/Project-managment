import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden } from '../domain/errors.js';
import { DEFAULT_SECTIONS, type OrgRole } from '../domain/enums.js';
import { can, type Access } from '../domain/permissions.js';
import { rankBetween } from '../lib/crypto.js';
import { contains } from '../lib/search.js';
import { loadProjectAccess } from './access.js';
import { notify, recordActivity } from './activity.js';
import { presentProject, presentSection } from './presenters.js';
import { emitToOrg, emitToProject, emitToUser } from '../realtime/bus.js';
import type { AuthUser } from '../types/express.js';
import type { CreateProjectInput, ProjectListQuery, UpdateProjectInput } from '../domain/schemas.js';

/**
 * Projects and their board structure (sections).
 *
 * A new project gets the four default columns and its creator becomes the project lead.
 * Every project endpoint answers with the same `projectDetail` shape, so the client can
 * cache one type for the list, the board header and the settings drawer.
 */

export async function projectDetail(projectId: string, access: Access) {
    const [project, members, sections, counts] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
        prisma.projectMember.findMany({ where: { projectId }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
        prisma.section.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
        prisma.task.groupBy({ by: ['status'], where: { projectId, deletedAt: null }, _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const completed = (byStatus.done ?? 0) + (byStatus.canceled ?? 0);

    return {
        ...presentProject({ ...project, members, _count: { tasks: total } }),
        completedTasks: completed,
        progress: total === 0 ? 0 : Math.round((completed / total) * 100),
        canEdit: can.editProject(access),
        canManageMembers: can.manageProjectMembers(access),
        byStatus,
        sections: sections.map(presentSection),
    };
}

export async function createProject(actor: AuthUser, orgId: string, input: CreateProjectInput) {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: actor.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');
    if (!can.createProject({ userId: actor.id, orgRole: membership.role as OrgRole, projectRole: null })) {
        throw new Forbidden('Requires the manager role to create projects');
    }

    const memberIds = [...new Set([actor.id, ...(input.memberIds ?? [])])];
    await assertOrgMembers(orgId, memberIds);

    if (input.teamId) {
        const team = await prisma.team.findFirst({ where: { id: input.teamId, orgId } });
        if (!team) throw new BadRequest('Team does not belong to this organization');
    }

    const project = await prisma.project.create({
        data: {
            orgId,
            teamId: input.teamId ?? null,
            name: input.name,
            description: input.description ?? null,
            color: input.color,
            visibility: input.visibility,
            startDate: input.startDate ?? null,
            dueDate: input.dueDate ?? null,
            createdById: actor.id,
            members: {
                create: memberIds.map((userId) => ({ userId, role: userId === actor.id ? 'lead' : 'member' })),
            },
            sections: {
                create: DEFAULT_SECTIONS.map((section, index) => ({
                    name: section.name,
                    position: (index + 1) * 1000,
                    isDone: section.isDone,
                })),
            },
        },
        include: { members: { include: { user: true } }, _count: { select: { tasks: true } } },
    });

    await recordActivity({
        orgId,
        actorId: actor.id,
        projectId: project.id,
        type: 'project.created',
        meta: { name: project.name },
    });
    if (memberIds.length > 1) {
        await notify({
            orgId,
            userIds: memberIds.filter((id) => id !== actor.id),
            type: 'project.member_added',
            title: `You were added to ${project.name}`,
            body: `${actor.firstName} ${actor.lastName} added you to the project ${project.name}.`,
            link: `/projects/${project.id}`,
        });
    }
    emitToOrg(orgId, 'project:updated', { projectId: project.id });
    return projectDetail(project.id, {
        userId: actor.id,
        orgRole: membership.role as OrgRole,
        projectRole: 'lead',
    });
}

async function assertOrgMembers(orgId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const count = await prisma.organizationMember.count({ where: { orgId, userId: { in: userIds } } });
    if (count !== new Set(userIds).size) throw new BadRequest('All project members must belong to the organization');
}

export async function listProjects(user: AuthUser, orgId: string, query: ProjectListQuery) {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');

    const managerPlus = membership.role === 'admin' || membership.role === 'manager';
    const where: Prisma.ProjectWhereInput = { orgId, status: query.status };
    if (!managerPlus) {
        where.OR = [{ visibility: 'organization' }, { members: { some: { userId: user.id } } }, { createdById: user.id }];
    }
    if (query.teamId) where.teamId = query.teamId;
    if (query.memberId) where.members = { some: { userId: query.memberId } };
    if (query.search) where.name = contains(query.search);

    const [rows, total] = await Promise.all([
        prisma.project.findMany({
            where,
            include: { members: { include: { user: true } }, _count: { select: { tasks: true } } },
            orderBy: { updatedAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
        }),
        prisma.project.count({ where }),
    ]);

    // Progress is cheap to compute and central enough to return with the list view.
    const counts = await prisma.task.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: rows.map((r) => r.id) }, deletedAt: null },
        _count: { _all: true },
    });
    const progress = new Map<string, { total: number; done: number }>();
    for (const row of counts) {
        const entry = progress.get(row.projectId) ?? { total: 0, done: 0 };
        entry.total += row._count._all;
        if (row.status === 'done' || row.status === 'canceled') entry.done += row._count._all;
        progress.set(row.projectId, entry);
    }

    return {
        items: rows.map((row) => {
            const p = progress.get(row.id) ?? { total: 0, done: 0 };
            // Mirrors the rules in `domain/permissions.ts` so the list page can decide whether
            // to render Archive / Delete affordances without a round-trip to `getProject`.
            const isLead = row.members.some((m) => m.userId === user.id && m.role === 'lead');
            const isCreator = row.createdById === user.id;
            return {
                ...presentProject(row),
                completedTasks: p.done,
                progress: p.total === 0 ? 0 : Math.round((p.done / p.total) * 100),
                canEdit: managerPlus || isLead || isCreator,
                canDelete: managerPlus || isCreator,
            };
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
        pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
}

export async function getProject(user: AuthUser, projectId: string) {
    const { access } = await loadProjectAccess(user, projectId);
    return projectDetail(projectId, access);
}

export async function updateProject(user: AuthUser, projectId: string, input: UpdateProjectInput) {
    const { project, access } = await loadProjectAccess(user, projectId);
    if (!can.editProject(access)) throw new Forbidden('You cannot edit this project');

    if (input.memberIds) {
        const wanted = [...new Set(input.memberIds)];
        await assertOrgMembers(project.orgId, wanted);
        const current = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
        const currentIds = current.map((c) => c.userId);
        const toAdd = wanted.filter((id) => !currentIds.includes(id));
        const toRemove = currentIds.filter((id) => !wanted.includes(id));
        await prisma.$transaction([
            ...(toRemove.length ? [prisma.projectMember.deleteMany({ where: { projectId, userId: { in: toRemove } } })] : []),
            ...toAdd.map((userId) => prisma.projectMember.create({ data: { projectId, userId } })),
        ]);
        if (toAdd.length) {
            await notify({
                orgId: project.orgId,
                userIds: toAdd,
                type: 'project.member_added',
                title: `You were added to ${project.name}`,
                body: `${user.firstName} ${user.lastName} added you to the project ${project.name}.`,
                link: `/projects/${projectId}`,
            });
        }
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId,
            type: 'project.member_added',
            meta: { added: toAdd, removed: toRemove },
        });
    }

    const updated = await prisma.project.update({
        where: { id: projectId },
        data: {
            name: input.name,
            description: input.description,
            color: input.color,
            visibility: input.visibility,
            status: input.status,
            teamId: input.teamId,
            startDate: input.startDate,
            dueDate: input.dueDate,
        },
    });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId,
        type: 'project.updated',
        meta: { changed: Object.keys(input).filter((k) => k !== 'memberIds') },
    });
    emitToProject(projectId, 'project:updated', { projectId, name: updated.name, status: updated.status });
    return projectDetail(projectId, access);
}

export async function deleteProject(user: AuthUser, projectId: string) {
    const { project, access } = await loadProjectAccess(user, projectId);
    if (!can.deleteProject(access)) throw new Forbidden('You cannot delete this project');
    await prisma.project.delete({ where: { id: projectId } });
    emitToOrg(project.orgId, 'project:updated', { projectId, deleted: true });
    return { id: projectId };
}

// ---------------------------------------------------------------------- members

export async function addProjectMembers(actor: AuthUser, projectId: string, userIds: string[], role: 'lead' | 'member') {
    const { project, access } = await loadProjectAccess(actor, projectId);
    if (!can.manageProjectMembers(access)) throw new Forbidden('You cannot manage members of this project');
    const unique = [...new Set(userIds)];
    await assertOrgMembers(project.orgId, unique);

    for (const userId of unique) {
        await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId, userId } },
            create: { projectId, userId, role },
            update: { role },
        });
    }
    await notify({
        orgId: project.orgId,
        userIds: unique.filter((id) => id !== actor.id),
        type: 'project.member_added',
        title: `You were added to ${project.name}`,
        body: `${actor.firstName} ${actor.lastName} added you to ${project.name}.`,
        link: `/projects/${projectId}`,
    });
    await recordActivity({
        orgId: project.orgId,
        actorId: actor.id,
        projectId,
        type: 'project.member_added',
        meta: { userIds: unique, role },
    });
    emitToProject(projectId, 'members:changed', { projectId });
    // They cannot receive `members:changed` — not being in the room is the whole problem —
    // so each new member gets a direct nudge to re-subscribe.
    for (const userId of unique) emitToUser(userId, 'rooms:refresh', { projectId });
    return { projectId, added: unique };
}

export async function removeProjectMember(actor: AuthUser, projectId: string, userId: string) {
    const { project, access } = await loadProjectAccess(actor, projectId);
    if (!can.manageProjectMembers(access)) throw new Forbidden('You cannot manage members of this project');
    if (project.createdById === userId) throw new Conflict('The project creator cannot be removed');
    await prisma.projectMember.deleteMany({ where: { projectId, userId } });
    await recordActivity({
        orgId: project.orgId,
        actorId: actor.id,
        projectId,
        type: 'project.member_removed',
        meta: { userId },
    });
    emitToProject(projectId, 'members:changed', { projectId });
    emitToUser(userId, 'rooms:refresh', { projectId });
    return { projectId, removed: userId };
}

// --------------------------------------------------------------------- sections

export async function createSection(actor: AuthUser, projectId: string, input: { name: string; afterSectionId?: string | null; isDone: boolean }) {
    const { access } = await loadProjectAccess(actor, projectId);
    if (!can.editProject(access)) throw new Forbidden('You cannot change this board');
    const before = input.afterSectionId
        ? await prisma.section.findFirst({ where: { id: input.afterSectionId, projectId }, select: { position: true } })
        : await prisma.section.findFirst({ where: { projectId }, orderBy: { position: 'desc' }, select: { position: true } });
    const section = await prisma.section.create({
        data: { projectId, name: input.name, isDone: input.isDone, position: (before?.position ?? 0) + 1000 },
    });
    emitToProject(projectId, 'project:updated', { projectId });
    return presentSection(section);
}

export async function updateSection(actor: AuthUser, sectionId: string, input: { name?: string; isDone?: boolean }) {
    const section = await prisma.section.findUniqueOrThrow({ where: { id: sectionId } });
    const { access } = await loadProjectAccess(actor, section.projectId);
    if (!can.editProject(access)) throw new Forbidden('You cannot change this board');
    const updated = await prisma.section.update({ where: { id: sectionId }, data: input });
    emitToProject(section.projectId, 'project:updated', { projectId: section.projectId });
    return presentSection(updated);
}

/** Deleting a column keeps the cards: they move to the first remaining section. */
export async function deleteSection(actor: AuthUser, sectionId: string) {
    const section = await prisma.section.findUniqueOrThrow({ where: { id: sectionId }, include: { project: true } });
    const { access } = await loadProjectAccess(actor, section.projectId);
    if (!can.editProject(access)) throw new Forbidden('You cannot change this board');
    const fallback = await prisma.section.findFirst({
        where: { projectId: section.projectId, id: { not: sectionId } },
        orderBy: { position: 'asc' },
    });
    if (!fallback) throw new Conflict('A project needs at least one column');
    await prisma.$transaction([
        prisma.task.updateMany({ where: { sectionId }, data: { sectionId: fallback.id } }),
        prisma.section.delete({ where: { id: sectionId } }),
    ]);
    emitToProject(section.projectId, 'project:updated', { projectId: section.projectId });
    return { id: sectionId };
}

export async function reorderSections(actor: AuthUser, projectId: string, orderedIds: string[]) {
    const { access } = await loadProjectAccess(actor, projectId);
    if (!can.editProject(access)) throw new Forbidden('You cannot change this board');
    const sections = await prisma.section.findMany({ where: { projectId }, select: { id: true, position: true } });
    if (orderedIds.length !== sections.length || orderedIds.some((id) => !sections.some((s) => s.id === id))) {
        throw new BadRequest('Provide every section id exactly once');
    }
    let previous: number | null = null;
    const updates = orderedIds.map((id) => {
        const position = rankBetween(previous, null);
        previous = position;
        return prisma.section.update({ where: { id }, data: { position } });
    });
    await prisma.$transaction(updates);
    emitToProject(projectId, 'project:updated', { projectId });
    return { projectId };
}
