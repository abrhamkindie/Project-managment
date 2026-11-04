import { prisma } from '../lib/prisma.js';
import { Forbidden, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import { loadTaskAccess, taskWatchers } from './access.js';
import { notify, recordActivity } from './activity.js';
import { mails } from './mailer.js';
import { presentComment } from './presenters.js';
import { env } from '../config/env.js';
import type { AuthUser } from '../types/express.js';

/** Discussion on a task. Commenters become watchers of that task. */

// --------------------------------------------------------------------------- mentions

/** Composer format: `@[Ada Lovelace](cuid)`. */
const LINK_MENTION = /@\[[^\]]+\]\(([^)\s]+)\)/g;
/** Hand-typed format: `@Ada Lovelace`. Two tokens keeps it from eating `@handle`. */
const NAME_MENTION = /@([\p{L}][\p{L}'.-]{1,30})\s+([\p{L}][\p{L}'.-]{1,30})/gu;

interface Mentioned {
    id: string;
    firstName: string;
    lastName: string;
}

/**
 * Resolve the people a comment body mentions.
 *
 * Two rules make this safe rather than a notification oracle: ids from the composer are
 * only honoured when that user is a member of this organization, and names are matched
 * against the same roster in memory — a case-insensitive `LIKE` would be the portable
 * alternative and SQLite/Postgres disagree about it. Free-text matching is therefore
 * exact (case-folded) on `First Last` and `Last First`, never a prefix.
 */
export async function resolveMentions(body: string, orgId: string, authorId: string): Promise<Mentioned[]> {
    const explicitIds = new Set<string>();
    const names = new Set<string>();
    for (const match of body.matchAll(LINK_MENTION)) explicitIds.add(match[1]);
    for (const match of body.matchAll(NAME_MENTION)) {
        const first = match[1].toLowerCase();
        const last = match[2].toLowerCase();
        names.add(`${first} ${last}`);
        names.add(`${last} ${first}`);
    }
    if (explicitIds.size === 0 && names.size === 0) return [];

    const members = await prisma.organizationMember.findMany({
        where: { orgId },
        select: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    const out: Mentioned[] = [];
    for (const { user } of members) {
        if (user.id === authorId) continue;
        const full = `${user.firstName} ${user.lastName}`.toLowerCase();
        const flipped = `${user.lastName} ${user.firstName}`.toLowerCase();
        if (explicitIds.has(user.id) || names.has(full) || names.has(flipped)) out.push(user);
    }
    return out;
}

export async function addComment(user: AuthUser, taskId: string, body: string) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.comment(access)) throw new Forbidden('You cannot comment on this task');

    const comment = await prisma.comment.create({
        data: { taskId, authorId: user.id, body },
        include: { author: true },
    });

    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId,
        type: 'comment.added',
        meta: { preview: body.slice(0, 140), title: task.title },
    });

    const audience = await taskWatchers(taskId, user.id);
    const preview = body.slice(0, 160);
    const link = `/projects/${project.id}/tasks/${taskId}`;
    await notify({
        orgId: project.orgId,
        userIds: audience,
        type: 'comment.added',
        title: `New comment on ${task.title}`,
        body: `${user.firstName} ${user.lastName}: ${preview}`,
        link,
        emailPreference: 'emailOnComment',
        email: ({ email, firstName }) =>
            mails.commentAdded({
                to: email,
                actorName: `${user.firstName} ${user.lastName}`,
                taskTitle: task.title,
                preview: `${firstName}, ${preview}`,
                link: `${env.WEB_URL}${link}`,
            }),
    });

    // A mention is an explicit pull, so it goes to that person alone (watchers already got
    // the comment event above) and skips anyone watching the task quietly.
    const mentioned = await resolveMentions(body, project.orgId, user.id);
    const direct = mentioned.map((m) => m.id).filter((id) => !audience.includes(id));
    if (direct.length > 0) {
        await recordActivity({
            orgId: project.orgId,
            actorId: user.id,
            projectId: project.id,
            taskId,
            type: 'comment.mentioned',
            meta: { userIds: direct, names: mentioned.map((m) => `${m.firstName} ${m.lastName}`) },
        });
        await notify({
            orgId: project.orgId,
            userIds: direct,
            type: 'comment.mentioned',
            title: `${user.firstName} ${user.lastName} mentioned you on ${task.title}`,
            body: preview,
            link,
            emailPreference: 'emailOnComment',
            email: ({ email }) =>
                mails.commentAdded({
                    to: email,
                    actorName: `${user.firstName} ${user.lastName}`,
                    taskTitle: task.title,
                    preview,
                    link: `${env.WEB_URL}${link}`,
                }),
        });
    }

    return presentComment(comment);
}

export async function listComments(user: AuthUser, taskId: string) {
    await loadTaskAccess(user, taskId);
    const comments = await prisma.comment.findMany({
        where: { taskId, deletedAt: null },
        include: { author: true },
        orderBy: { createdAt: 'asc' },
    });
    return comments.map(presentComment);
}

export async function deleteComment(user: AuthUser, commentId: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new NotFound('Comment not found');
    const { project, access } = await loadTaskAccess(user, comment.taskId);
    const isAuthor = comment.authorId === user.id;
    if (!isAuthor && !can.moderateComment(access)) throw new Forbidden('You cannot delete this comment');

    await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date(), body: '[removed]' } });
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.deleted',
        meta: { commentId },
    });
    return { id: commentId };
}

export async function editComment(user: AuthUser, commentId: string, body: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: { task: { include: { project: true } } } });
    if (!comment || comment.deletedAt) throw new NotFound('Comment not found');
    if (comment.authorId !== user.id) throw new Forbidden('You can only edit your own comments');
    const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { body },
        include: { author: true },
    });

    // Editing in a mention is the common way people notice they forgot one, so it pings —
    // but only the names that were not already there, or every edit would re-notify.
    const before = await resolveMentions(comment.body, comment.task.project.orgId, user.id);
    const after = await resolveMentions(body, comment.task.project.orgId, user.id);
    const fresh = after.filter((u) => !before.some((p) => p.id === u.id));
    if (fresh.length > 0) {
        await notify({
            orgId: comment.task.project.orgId,
            userIds: fresh.map((u) => u.id),
            type: 'comment.mentioned',
            title: `${user.firstName} ${user.lastName} mentioned you on ${comment.task.title}`,
            body: body.slice(0, 160),
            link: `/projects/${comment.task.projectId}/tasks/${comment.taskId}`,
            emailPreference: 'emailOnComment',
        });
    }
    return presentComment(updated);
}
