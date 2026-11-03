import type { RequestHandler, Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { Unauthorized, Forbidden } from '../domain/errors.js';
import { tokenFromAuthorizationHeader, verifyAccessToken } from '../lib/tokens.js';
import { ACCESS_COOKIE } from '../services/session.js';
import { atLeastOrgRole, type Access } from '../domain/permissions.js';
import type { OrgRole } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';

function extractToken(req: Request): string | null {
    const fromHeader = tokenFromAuthorizationHeader(req.headers.authorization);
    if (fromHeader) return fromHeader;
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    return fromCookie ?? null;
}

/** Verify the access token and hydrate `req.user`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
    try {
        const token = extractToken(req);
        if (!token) throw new Unauthorized();
        const claims = verifyAccessToken(token);
        const user = await prisma.user.findUnique({
            where: { id: claims.sub },
            select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
        });
        if (!user || !user.isActive) throw new Unauthorized('Account is not available');
        req.user = { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
        return next();
    } catch (error) {
        return next(error);
    }
};

export function currentUser(req: Request): AuthUser {
    if (!req.user) throw new Unauthorized();
    return req.user;
}

/**
 * Ensure the caller belongs to the organization in `:orgId` and expose their role.
 * Accepts an explicit param name for routes nested under a different key.
 */
export function requireOrgRole(required: OrgRole, param = 'orgId'): RequestHandler {
    return async (req, _res, next) => {
        try {
            const orgId = req.params[param];
            const user = currentUser(req);
            if (!orgId) throw new Forbidden('Missing organization context');
            const membership = await prisma.organizationMember.findUnique({
                where: { orgId_userId: { orgId, userId: user.id } },
                select: { role: true },
            });
            if (!membership) throw new Forbidden('You are not a member of this organization');
            if (!atLeastOrgRole(membership.role as OrgRole, required)) {
                throw new Forbidden(`Requires the ${required} role`);
            }
            req.org = { id: orgId, role: membership.role as OrgRole };
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

/** Build the permission snapshot for a project (used by project/task routes). */
export async function buildAccess(
    user: AuthUser,
    orgId: string,
    projectId?: string | null,
): Promise<Access> {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');

    const base: Access = { userId: user.id, orgRole: membership.role as OrgRole, projectRole: null };
    if (!projectId) return base;

    const projectMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
        select: { role: true },
    });
    return { ...base, projectRole: (projectMember?.role as Access['projectRole']) ?? null };
}
