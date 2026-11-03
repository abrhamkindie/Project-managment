import { prisma } from '../lib/prisma.js';
import { Conflict, Unauthorized } from '../domain/errors.js';
import { hashPassword, uniqueSlug, verifyPassword } from '../lib/crypto.js';
import { createSession, revokeAllSessions, type SessionTokens } from './session.js';
import { presentUser } from './presenters.js';
import type { LoginInput, RegisterInput, UpdateProfileInput } from '../domain/schemas.js';
import type { OrgRole } from '../domain/enums.js';

/**
 * Account creation and sign-in. Registering also bootstraps the first organization so a
 * new user lands in a working workspace instead of an empty screen.
 */

export interface SessionMeta {
    userAgent?: string;
    ip?: string;
}

export interface Authenticated {
    userId: string;
    tokens: SessionTokens;
}

export async function register(input: RegisterInput, meta: SessionMeta): Promise<Authenticated> {
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Conflict('An account with this email already exists');

    const user = await prisma.user.create({
        data: {
            email,
            passwordHash: await hashPassword(input.password),
            firstName: input.firstName,
            lastName: input.lastName,
        },
    });

    const orgName = input.organizationName?.trim() || `${input.firstName}'s workspace`;
    const slug = await uniqueSlug(orgName, async (candidate) =>
        Boolean(await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })),
    );

    await prisma.organization.create({
        data: {
            name: orgName,
            slug,
            ownerId: user.id,
            members: { create: { userId: user.id, role: 'admin' } },
        },
    });

    const tokens = await createSession(user.id, meta);
    return { userId: user.id, tokens };
}

export async function login(input: LoginInput, meta: SessionMeta): Promise<Authenticated> {
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    // Same message and a constant-ish path for unknown vs wrong password: no user enumeration.
    if (!user) {
        await verifyPassword(input.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
        throw new Unauthorized('Incorrect email or password');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
        throw new Unauthorized('Incorrect email or password');
    }
    if (!user.isActive) throw new Unauthorized('This account has been deactivated');

    const tokens = await createSession(user.id, meta);
    return { userId: user.id, tokens };
}

export async function profile(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
            memberships: {
                include: { org: { select: { id: true, name: true, slug: true, ownerId: true, createdAt: true } } },
                orderBy: { createdAt: 'asc' },
            },
        },
    });

    const orgIds = user.memberships.map((m) => m.orgId);
    const counts = orgIds.length
        ? await prisma.organizationMember.groupBy({ by: ['orgId'], where: { orgId: { in: orgIds } }, _count: { _all: true } })
        : [];
    const countByOrg = new Map(counts.map((c) => [c.orgId, c._count._all]));

    return {
        user: {
            ...presentUser(user),
            prefs: safePrefs(user.prefs),
        },
        organizations: user.memberships.map((m) => ({
            ...m.org,
            role: m.role as OrgRole,
            memberCount: countByOrg.get(m.orgId) ?? 0,
        })),
        unreadNotifications: await prisma.notification.count({ where: { userId, readAt: null } }),
    };
}

function safePrefs(raw: string): Record<string, boolean> {
    try {
        return JSON.parse(raw) as Record<string, boolean>;
    } catch {
        return {};
    }
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
    const { prefs, ...rest } = input;
    const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await prisma.user.update({
        where: { id: userId },
        data: {
            ...rest,
            // Merged, so a client can PATCH a single preference without wiping the others.
            ...(prefs ? { prefs: JSON.stringify({ ...safePrefs(current.prefs), ...prefs }) } : {}),
        },
    });
    return presentUser(user);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new Unauthorized('Current password is incorrect');
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    // Rotating the password invalidates every existing session.
    await revokeAllSessions(userId);
}
