import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser, requireOrgRole } from '../middleware/auth.js';
import * as org from '../services/org.service.js';
import {
    acceptInviteSchema,
    createLabelSchema,
    createOrganizationSchema,
    createTeamSchema,
    inviteSchema,
    memberRoleSchema,
    teamMembersSchema,
    updateOrganizationSchema,
    type AcceptInviteInput,
    type CreateLabelInput,
    type CreateOrganizationInput,
    type CreateTeamInput,
    type InviteInput,
    type MemberRoleInput,
    type TeamMembersInput,
    type UpdateOrganizationInput,
} from '../domain/schemas.js';
import { NotFound } from '../domain/errors.js';
import { prisma } from '../lib/prisma.js';
import { presentActivity } from '../services/presenters.js';

/**
 * Organization surface: workspaces, members, invitations, teams, labels and the
 * organization-wide activity feed.
 *
 * `/organizations` (plural) is the user's own list; everything under `/:orgId`
 * requires membership, with role floors applied per route.
 */
export const organizationRouter = Router();

organizationRouter.use(authenticate);

/** Accepting an invitation only needs a signed-in user whose e-mail matches (POST /api/organizations/invitations/accept). */
organizationRouter.post('/invitations/accept', validate(acceptInviteSchema), asyncHandler(async (req, res) => {
    res.json(await org.acceptInvitation(currentUser(req), input<AcceptInviteInput>(req).token));
}));

organizationRouter.get('/', asyncHandler(async (req, res) => {
    res.json({ items: await org.listOrganizations(currentUser(req)) });
}));

organizationRouter.post('/', validate(createOrganizationSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await org.createOrganization(currentUser(req), input<CreateOrganizationInput>(req).name));
}));

organizationRouter.get('/:orgId', requireOrgRole('member'), asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
    if (!organization) throw new NotFound('Organization not found');
    const memberships = await prisma.organizationMember.findMany({ where: { orgId: organization.id }, select: { userId: true } });
    res.json({
        organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            ownerId: organization.ownerId,
            createdAt: organization.createdAt.toISOString(),
        },
        me: { role: req.org!.role, userId: currentUser(req).id },
        memberCount: memberships.length,
    });
}));

organizationRouter.patch('/:orgId', requireOrgRole('admin'), validate(updateOrganizationSchema), asyncHandler(async (req, res) => {
    res.json(await org.updateOrganization(currentUser(req), req.params.orgId, input<UpdateOrganizationInput>(req)));
}));

// ------------------------------------------------------------------------ members

organizationRouter.get('/:orgId/members', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json({ items: await org.listMembers(req.params.orgId) });
}));

organizationRouter.post('/:orgId/invitations', requireOrgRole('admin'), validate(inviteSchema), asyncHandler(async (req, res) => {
    res.status(201).json({ items: await org.inviteMembers(currentUser(req), req.params.orgId, input<InviteInput>(req)) });
}));

organizationRouter.get('/:orgId/invitations', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    const items = await org.listInvitations(req.params.orgId);
    res.json({
        items: items.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            invitedBy: i.invitedBy,
            expiresAt: i.expiresAt.toISOString(),
            createdAt: i.createdAt.toISOString(),
        })),
    });
}));

organizationRouter.delete('/:orgId/invitations/:invitationId', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    res.json(await org.revokeInvitation(currentUser(req), req.params.orgId, req.params.invitationId));
}));

/** Role changes and removals are admin-only. */
organizationRouter.patch('/:orgId/members/:userId', requireOrgRole('admin'), validate(memberRoleSchema), asyncHandler(async (req, res) => {
    res.json(await org.updateMemberRole(currentUser(req), req.params.orgId, req.params.userId, input<MemberRoleInput>(req).role));
}));

organizationRouter.delete('/:orgId/members/:userId', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    res.json(await org.setMemberActive(currentUser(req), req.params.orgId, req.params.userId, false));
}));

// -------------------------------------------------------------------------- teams

organizationRouter.get('/:orgId/teams', requireOrgRole('member'), asyncHandler(async (req, res) => {
    const items = await org.listTeams(req.params.orgId);
    res.json({
        items: items.map((team) => ({
            id: team.id,
            name: team.name,
            slug: team.slug,
            projectCount: team._count.projects,
            members: team.members.map((m) => ({ id: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName })),
        })),
    });
}));

organizationRouter.post('/:orgId/teams', requireOrgRole('manager'), validate(createTeamSchema), asyncHandler(async (req, res) => {
    const body = input<CreateTeamInput>(req);
    res.status(201).json(await org.createTeam(currentUser(req), req.params.orgId, body.name, body.memberIds));
}));

organizationRouter.put('/:orgId/teams/:teamId/members', requireOrgRole('manager'), validate(teamMembersSchema), asyncHandler(async (req, res) => {
    res.json(await org.setTeamMembers(currentUser(req), req.params.teamId, input<TeamMembersInput>(req).userIds));
}));

// ------------------------------------------------------------------------- labels

organizationRouter.get('/:orgId/labels', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json({ items: await org.listLabels(req.params.orgId) });
}));

organizationRouter.post('/:orgId/labels', requireOrgRole('member'), validate(createLabelSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await org.createLabel(currentUser(req), req.params.orgId, input<CreateLabelInput>(req)));
}));

organizationRouter.delete('/:orgId/labels/:labelId', requireOrgRole('manager'), asyncHandler(async (req, res) => {
    res.json(await org.deleteLabel(currentUser(req), req.params.orgId, req.params.labelId));
}));

// ----------------------------------------------------------------------- activity

organizationRouter.get('/:orgId/activity', requireOrgRole('member'), asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const items = await prisma.activity.findMany({
        where: { orgId: req.params.orgId },
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
    res.json({ items: items.map(presentActivity) });
}));
