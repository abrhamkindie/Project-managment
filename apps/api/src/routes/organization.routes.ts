import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser, requireOrgRole } from '../middleware/auth.js';
import * as org from '../services/org.service.js';
import { visibleProjectIds } from '../services/task.service.js';
import * as filters from '../services/saved-filter.service.js';
import { activityCsv } from '../services/export.service.js';
import {
    acceptInviteSchema,
    activityFeedQuerySchema,
    createLabelSchema,
    createOrganizationSchema,
    createSavedFilterSchema,
    createTeamSchema,
    inviteSchema,
    memberRoleSchema,
    teamMembersSchema,
    updateOrganizationSchema,
    type AcceptInviteInput,
    type ActivityFeedQuery,
    type CreateLabelInput,
    type CreateOrganizationInput,
    type CreateSavedFilterInput,
    type CreateTeamInput,
    type InviteInput,
    type MemberRoleInput,
    type TeamMembersInput,
    type UpdateOrganizationInput,
} from '../domain/schemas.js';
import { NotFound } from '../domain/errors.js';
import { prisma } from '../lib/prisma.js';
import { presenceFor } from '../realtime/presence.js';
import { presentActivity } from '../services/presenters.js';
import type { AuthUser } from '../types/express.js';

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

// ------------------------------------------------------------------ saved filters

/** Per-user saved task-list filters. Membership-only to read/write; each user sees just their own. */
organizationRouter.get('/:orgId/filters', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json({ items: await filters.listFilters(currentUser(req), req.params.orgId) });
}));

organizationRouter.post('/:orgId/filters', requireOrgRole('member'), validate(createSavedFilterSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await filters.createFilter(currentUser(req), req.params.orgId, input<CreateSavedFilterInput>(req)));
}));

organizationRouter.delete('/:orgId/filters/:filterId', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json(await filters.deleteFilter(currentUser(req), req.params.orgId, req.params.filterId));
}));

// ----------------------------------------------------------------------- activity

/** Rows a single audit export may contain; newest first, so the trimmed tail is the oldest history. */
const ACTIVITY_EXPORT_LIMIT = 5_000;

/**
 * Conditions for one audit read, shared by the feed and the CSV export.
 *
 * Two things a naive `findMany({ orgId })` gets wrong and this does not:
 *  - private project history is filtered out for ordinary members (org-level rows, which
 *    have no project, stay visible); and
 *  - every filter is ANDed, so `type` + `userId` + a date range narrows instead of widening.
 */
async function activityConditions(user: AuthUser, orgId: string, query: ActivityFeedQuery): Promise<Prisma.ActivityWhereInput[]> {
    const conditions: Prisma.ActivityWhereInput[] = [{ orgId }];
    const visible = await visibleProjectIds(user, orgId);
    if (visible !== 'all') {
        conditions.push({ OR: [{ projectId: null }, { projectId: { in: visible } }] });
    }
    if (query.userId) conditions.push({ actorId: query.userId });
    if (query.type) conditions.push({ type: query.type });
    if (query.from || query.to) {
        conditions.push({ createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } });
    }
    return conditions;
}

/**
 * Organization-wide audit feed.
 *
 * `before` walks a keyset cursor instead of `skip`, so new rows appearing at the top of
 * the feed while someone scrolls cannot shift the page they are reading.
 */
organizationRouter.get('/:orgId/activity', requireOrgRole('member'), validate(activityFeedQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const query = input<ActivityFeedQuery>(req, 'query');
    const { limit, before } = query;

    const filters = await activityConditions(user, req.params.orgId, query);
    if (before) {
        const cursor = await prisma.activity.findFirst({ where: { id: before, orgId: req.params.orgId }, select: { createdAt: true, id: true } });
        if (!cursor) throw new NotFound('Activity cursor not found');
        filters.push({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] });
    }

    const rows = await prisma.activity.findMany({
        where: { AND: filters },
        include: { actor: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
    });
    const items = rows.slice(0, limit);
    res.json({
        items: items.map(presentActivity),
        /** Pass back as `before` for the next, older page; absent once the feed is exhausted. */
        nextCursor: rows.length > limit ? items[items.length - 1]?.id ?? null : null,
    });
}));

/**
 * The audit log as CSV (Settings → Audit), with exactly the feed's filters.
 *
 * Admin-only on purpose: a member's feed already hides private-project history, but a downloadable
 * record of everything that happened is an accountability tool, and accountability belongs to the
 * role that owns it. `limit` is ignored and the window capped instead — a file that silently
 * stopped at 200 rows would misrepresent the history it claims to hand over.
 */
organizationRouter.get('/:orgId/activity/export', requireOrgRole('admin'), validate(activityFeedQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const query = input<ActivityFeedQuery>(req, 'query');
    const conditions = await activityConditions(user, req.params.orgId, query);

    const rows = await prisma.activity.findMany({
        where: { AND: conditions },
        include: { actor: { select: { firstName: true, lastName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_EXPORT_LIMIT,
    });

    // `Activity` relates to the actor, not to the project: one extra read names the projects that
    // appear, which beats a join Prisma cannot express here.
    const projectIds = [...new Set(rows.flatMap((row) => (row.projectId ? [row.projectId] : [])))];
    const named = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } });
    const projectNames = new Map(named.map((project) => [project.id, project.name]));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.orgId}.csv"`);
    res.send(
        activityCsv(
            rows.map((row) => ({
                id: row.id,
                createdAt: row.createdAt,
                type: row.type,
                actorName: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
                projectName: row.projectId ? projectNames.get(row.projectId) ?? null : null,
                taskId: row.taskId,
            })),
        ),
    );
}));

/**
 * Who is around in this workspace, and when the others were.
 *
 * Its own endpoint rather than a field on `/members`: the directory is a heavy read that
 * changes rarely, presence changes every minute and is only ever wanted next to a name. Keeping
 * them apart also means the member service does not have to know that sockets exist.
 *
 * Scoped strictly to this organization's roster, so it cannot be used to watch when a person
 * from another workspace was last active.
 */
organizationRouter.get('/:orgId/presence', requireOrgRole('member'), asyncHandler(async (req, res) => {
    const roster = await prisma.organizationMember.findMany({
        where: { orgId: req.params.orgId },
        select: { userId: true },
    });
    res.json({ items: await presenceFor(roster.map((row) => row.userId)) });
}));
