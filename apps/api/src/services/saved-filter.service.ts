import { prisma } from '../lib/prisma.js';
import { BadRequest, NotFound } from '../domain/errors.js';
import type { CreateSavedFilterInput } from '../domain/schemas.js';
import type { AuthUser } from '../types/express.js';

/**
 * Saved filters.
 *
 * Per-user convenience rows: each stores a JSON snapshot of the task-list query params under a
 * friendly name. They are private to their owner (never shared across the org), and deleting a
 * filter only removes the shortcut — the underlying task query is stateless.
 */

export interface SavedFilterDto {
    id: string;
    userId: string;
    orgId: string;
    projectId: string | null;
    name: string;
    params: Record<string, unknown>;
    createdAt: string;
}

function present(row: {
    id: string;
    userId: string;
    orgId: string;
    projectId: string | null;
    name: string;
    params: string;
    createdAt: Date;
}): SavedFilterDto {
    let params: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(row.params);
        if (parsed && typeof parsed === 'object') params = parsed as Record<string, unknown>;
    } catch {
        params = {};
    }
    return {
        id: row.id,
        userId: row.userId,
        orgId: row.orgId,
        projectId: row.projectId,
        name: row.name,
        params,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listFilters(user: AuthUser, orgId: string): Promise<SavedFilterDto[]> {
    const rows = await prisma.savedFilter.findMany({
        where: { orgId, userId: user.id },
        orderBy: { createdAt: 'desc' },
    });
    return rows.map(present);
}

export async function createFilter(user: AuthUser, orgId: string, input: CreateSavedFilterInput): Promise<SavedFilterDto> {
    if (input.projectId) {
        const project = await prisma.project.findFirst({ where: { id: input.projectId, orgId }, select: { id: true } });
        if (!project) throw new BadRequest('Project does not belong to this organization');
    }
    const row = await prisma.savedFilter.create({
        data: {
            userId: user.id,
            orgId,
            projectId: input.projectId ?? null,
            name: input.name,
            params: JSON.stringify(input.params ?? {}),
        },
    });
    return present(row);
}

export async function deleteFilter(user: AuthUser, orgId: string, filterId: string): Promise<{ id: string }> {
    const row = await prisma.savedFilter.findFirst({ where: { id: filterId, orgId }, select: { id: true, userId: true } });
    if (!row) throw new NotFound('Filter not found');
    // Owners may always remove their own; admins can clear a stray filter for anyone.
    if (row.userId !== user.id) {
        const membership = await prisma.organizationMember.findFirst({ where: { orgId, userId: user.id, role: 'admin' }, select: { id: true } });
        if (!membership) throw new BadRequest('You can only delete your own filters');
    }
    await prisma.savedFilter.delete({ where: { id: filterId } });
    return { id: filterId };
}
