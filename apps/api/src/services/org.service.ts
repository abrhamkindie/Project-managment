import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { hashSecret, randomToken, uniqueSlug } from '../lib/crypto.js';
import { addSeconds } from '../lib/time.js';
import { env } from '../config/env.js';
import { can, type Access } from '../domain/permissions.js';
import type { OrgRole } from '../domain/enums.js';
import { notify, recordActivity } from './activity.js';
import { mails, sendMail } from './mailer.js';
import { presentMember, presentOrganization } from './presenters.js';
import { emitToOrg } from '../realtime/bus.js';
import type { AuthUser } from '../types/express.js';
import type { InviteInput } from '../domain/schemas.js';

/**
 * Organizations, members, invitations, teams and labels.
 *
 * An organization is the billing/scope boundary: everything (teams, projects, tasks,
 * reports) hangs off it, and a user's `role` inside it drives authorization.
 */

const INVITE_TTL_DAYS = 7;

export async function createOrganization(user: AuthUser, name: string) {
    const slug = await uniqueSlug(name, async (candidate) =>
        Boolean(await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })),
    );
    const org = await prisma.organization.create({
        data: { name, slug, ownerId: user.id, members: { create: { userId: user.id, role: 'admin' } } },
    });
    // Same shape as the list item, so the client can append the response without a refetch.
    return { ...presentOrganization(org), role: 'admin' as OrgRole, memberCount: 1 };
}

export async function listOrganizations(user: AuthUser) {
    const memberships = await prisma.organizationMember.findMany({
        where: { userId: user.id },
        include: { org: true },
        orderBy: { createdAt: 'asc' },
    });
    const counts = await prisma.organizationMember.groupBy({
        by: ['orgId'],
        where: { orgId: { in: memberships.map((m) => m.orgId) } },
        _count: { _all: true },
    });
    const countByOrg = new Map(counts.map((c) => [c.orgId, c._count._all]));
    return memberships.map((m) => ({
        ...presentOrganization(m.org),
        role: m.role as OrgRole,
        memberCount: countByOrg.get(m.orgId) ?? 0,
    }));
}

export async function updateOrganization(user: AuthUser, orgId: string, input: { name?: string }) {
    const access = await orgAccess(user, orgId);
    if (!can.manageOrganization(access)) throw new Forbidden('Only an organization admin can change its name');
    const org = await prisma.organization.update({ where: { id: orgId }, data: { name: input.name } });
    const [item] = (await listOrganizations(user)).filter((candidate) => candidate.id === org.id);
    return item ?? presentOrganization(org);
}

export async function orgAccess(user: AuthUser, orgId: string): Promise<Access> {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');
    return { userId: user.id, orgRole: membership.role as OrgRole, projectRole: null };
}

export async function listMembers(orgId: string) {
    const members = await prisma.organizationMember.findMany({
        where: { orgId },
        include: { user: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const teams = await prisma.teamMember.findMany({
        where: { team: { orgId }, userId: { in: members.map((m) => m.userId) } },
        include: { team: { select: { id: true, name: true } } },
    });
    return members.map((m) => ({
        ...presentMember(m),
        teams: teams.filter((t) => t.userId === m.userId).map((t) => t.team),
    }));
}

export async function inviteMembers(user: AuthUser, orgId: string, input: InviteInput) {
    const access = await orgAccess(user, orgId);
    if (!can.manageOrganization(access)) throw new Forbidden('Only an organization admin can invite people');

    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    const created: { email: string; status: 'invited' | 'joined' }[] = [];

    for (const email of input.emails) {
        const existingMember = await prisma.user.findUnique({ where: { email } });

        if (existingMember) {
            const membership = await prisma.organizationMember.findUnique({
                where: { orgId_userId: { orgId, userId: existingMember.id } },
            });
            if (membership) {
                created.push({ email, status: 'joined' });
                continue;
            }
            await prisma.organizationMember.create({ data: { orgId, userId: existingMember.id, role: input.role } });
            await ensureMemberships(input.teamIds ?? [], input.projectIds ?? [], existingMember.id);
            await notify({
                orgId,
                userIds: [existingMember.id],
                type: 'project.member_added',
                title: `You were added to ${org.name}`,
                body: `${inviter.firstName} ${inviter.lastName} added you as ${input.role}.`,
                link: '/dashboard',
            });
            // Existing account auto-joins, so there is no invitation to accept — tell them by
            // email directly that they have been added, otherwise the action would be silent.
            await sendMail(
                mails.addedToWorkspace({
                    to: email,
                    firstName: existingMember.firstName,
                    orgName: org.name,
                    inviterName: `${inviter.firstName} ${inviter.lastName}`,
                    role: input.role,
                    link: `${env.WEB_URL}/w/${org.slug}/dashboard`,
                }),
            );
            await recordActivity({
                orgId,
                actorId: user.id,
                type: 'member.invited',
                meta: { email, role: input.role, autoJoined: true },
            });
            created.push({ email, status: 'joined' });
            continue;
        }

        const pending = await prisma.invitation.findFirst({
            where: { orgId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
        });
        if (pending) {
            created.push({ email, status: 'invited' });
            continue;
        }

        const token = randomToken(32);
        await prisma.invitation.create({
            data: {
                orgId,
                email,
                role: input.role,
                tokenHash: hashSecret(token),
                invitedById: user.id,
                expiresAt: addSeconds(new Date(), INVITE_TTL_DAYS * 86_400),
                // Persist project/team context so a first-time invitee lands in the right places
                // on acceptance, not just in the workspace.
                teamIds: JSON.stringify(input.teamIds ?? []),
                projectIds: JSON.stringify(input.projectIds ?? []),
            },
        });
        await recordActivity({ orgId, actorId: user.id, type: 'member.invited', meta: { email, role: input.role } });
        await sendMail(
            mails.invitation({
                to: email,
                orgName: org.name,
                inviterName: `${inviter.firstName} ${inviter.lastName}`,
                role: input.role,
                link: `${env.WEB_URL}/invite?token=${token}&email=${encodeURIComponent(email)}`,
            }),
        );
        created.push({ email, status: 'invited' });
    }

    emitToOrg(orgId, 'members:changed', { orgId });
    return created;
}

export async function revokeInvitation(user: AuthUser, orgId: string, invitationId: string) {
    const access = await orgAccess(user, orgId);
    if (!can.manageOrganization(access)) throw new Forbidden('Only an organization admin can revoke invitations');
    await prisma.invitation.delete({ where: { id: invitationId, orgId } });
    return { id: invitationId };
}

export async function listInvitations(orgId: string) {
    return prisma.invitation.findMany({
        where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        include: { invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
}

/** Accept an invitation token. The signed-in e-mail must match the invited address. */
export async function acceptInvitation(user: AuthUser, token: string) {
    const invitation = await prisma.invitation.findUnique({
        where: { tokenHash: hashSecret(token) },
        include: { org: true },
    });
    if (!invitation) throw new NotFound('This invitation is not valid');
    if (invitation.acceptedAt) throw new Conflict('This invitation was already used');
    if (invitation.expiresAt.getTime() < Date.now()) throw new BadRequest('This invitation has expired');
    if (invitation.email !== user.email) {
        throw new Forbidden(`This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`);
    }

    await prisma.$transaction([
        prisma.organizationMember.upsert({
            where: { orgId_userId: { orgId: invitation.orgId, userId: user.id } },
            create: { orgId: invitation.orgId, userId: user.id, role: invitation.role },
            update: {},
        }),
        prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);

    // Carry the invitee into any projects/teams the inviter attached. Ids are stored as JSON; a
    // corrupt row must not block the join, so parse defensively.
    const parseIds = (raw: string | null): string[] => {
        try {
            const value = JSON.parse(raw ?? '[]');
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
        } catch {
            return [];
        }
    };
    await ensureMemberships(parseIds(invitation.teamIds), parseIds(invitation.projectIds), user.id);

    await recordActivity({
        orgId: invitation.orgId,
        actorId: user.id,
        type: 'member.role_changed',
        meta: { email: user.email, role: invitation.role, self: true },
    });
    emitToOrg(invitation.orgId, 'members:changed', { orgId: invitation.orgId });
    return { orgId: invitation.orgId, name: invitation.org.name, role: invitation.role };
}

export async function updateMemberRole(actor: AuthUser, orgId: string, userId: string, role: OrgRole) {
    const access = await orgAccess(actor, orgId);
    if (!can.manageOrganization(access)) throw new Forbidden('Only an organization admin can change roles');

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.ownerId === userId && role !== 'admin') throw new Conflict('The organization owner must stay an admin');
    if (actor.id === userId && role !== 'admin') throw new Conflict('You cannot demote yourself');

    await prisma.organizationMember.update({ where: { orgId_userId: { orgId, userId } }, data: { role } });
    await recordActivity({ orgId, actorId: actor.id, type: 'member.role_changed', meta: { userId, role } });
    emitToOrg(orgId, 'members:changed', { orgId });
    return { userId, role };
}

/** Deactivating keeps history intact but blocks sign-in and assignment. */
export async function setMemberActive(actor: AuthUser, orgId: string, userId: string, isActive: boolean) {
    const access = await orgAccess(actor, orgId);
    if (!can.manageOrganization(access)) throw new Forbidden('Only an organization admin can remove members');
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.ownerId === userId) throw new Conflict('The organization owner cannot be removed');

    await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { isActive } }),
        ...(isActive ? [] : [prisma.organizationMember.deleteMany({ where: { orgId, userId } })]),
        ...(isActive ? [] : [prisma.taskAssignee.deleteMany({ where: { userId, task: { project: { orgId } } } })]),
    ]);
    await recordActivity({
        orgId,
        actorId: actor.id,
        type: 'member.role_changed',
        meta: { userId, removed: !isActive },
    });
    emitToOrg(orgId, 'members:changed', { orgId });
    return { userId, isActive };
}

// --------------------------------------------------------------------------- teams

export async function createTeam(actor: AuthUser, orgId: string, name: string, memberIds: string[] = []) {
    const access = await orgAccess(actor, orgId);
    if (!can.createProject(access)) throw new Forbidden('Requires the manager role to create teams');
    const slug = await uniqueSlug(name, async (candidate) =>
        Boolean(await prisma.team.findFirst({ where: { orgId, slug: candidate }, select: { id: true } })),
    );
    const team = await prisma.team.create({
        data: {
            orgId,
            name,
            slug,
            members: { create: [...new Set(memberIds)].map((userId) => ({ userId })) },
        },
    });
    emitToOrg(orgId, 'members:changed', { orgId });
    return team;
}

export async function listTeams(orgId: string) {
    return prisma.team.findMany({
        where: { orgId },
        orderBy: { name: 'asc' },
        include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true } } } }, _count: { select: { projects: true } } },
    });
}

export async function setTeamMembers(actor: AuthUser, teamId: string, userIds: string[]) {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const access = await orgAccess(actor, team.orgId);
    if (!can.createProject(access)) throw new Forbidden('Requires the manager role');
    await assertTeamMembersAreInOrg(team.orgId, userIds);
    await prisma.$transaction([
        prisma.teamMember.deleteMany({ where: { teamId } }),
        prisma.teamMember.createMany({ data: [...new Set(userIds)].map((userId) => ({ teamId, userId })) }),
    ]);
    return { id: teamId };
}

async function assertTeamMembersAreInOrg(orgId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const count = await prisma.organizationMember.count({ where: { orgId, userId: { in: userIds } } });
    if (count !== new Set(userIds).size) throw new BadRequest('Every teammate must be a member of the organization');
}

// -------------------------------------------------------------------------- labels

export async function createLabel(actor: AuthUser, orgId: string, input: { name: string; color: string; projectId?: string | null }) {
    const access = await orgAccess(actor, orgId);
    if (!can.viewProject(access)) throw new Forbidden('No access to this organization');
    const existing = await prisma.label.findFirst({ where: { orgId, name: input.name } });
    if (existing) throw new Conflict('A label with that name already exists');
    return prisma.label.create({ data: { ...input, orgId } });
}

export async function listLabels(orgId: string) {
    return prisma.label.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
}

export async function deleteLabel(actor: AuthUser, orgId: string, labelId: string) {
    const access = await orgAccess(actor, orgId);
    if (!can.manageOrganization(access) && !can.createProject(access)) {
        throw new Forbidden('Requires the manager role to delete labels');
    }
    await prisma.label.delete({ where: { id: labelId, orgId } });
    return { id: labelId };
}

/** Idempotent team/project membership adds (SQLite has no `skipDuplicates`). */
async function ensureMemberships(teamIds: string[], projectIds: string[], userId: string): Promise<void> {
    for (const teamId of new Set(teamIds)) {
        await prisma.teamMember.upsert({
            where: { teamId_userId: { teamId, userId } },
            create: { teamId, userId },
            update: {},
        });
    }
    for (const projectId of new Set(projectIds)) {
        await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId, userId } },
            create: { projectId, userId },
            update: {},
        });
    }
}
