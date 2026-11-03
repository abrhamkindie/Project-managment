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
    await notify({
        orgId: project.orgId,
        userIds: audience,
        type: 'comment.added',
        title: `New comment on ${task.title}`,
        body: `${user.firstName} ${user.lastName}: ${preview}`,
        link: `/projects/${project.id}/tasks/${taskId}`,
        emailPreference: 'emailOnComment',
        email: ({ email, firstName }) =>
            mails.commentAdded({
                to: email,
                actorName: `${user.firstName} ${user.lastName}`,
                taskTitle: task.title,
                preview: `${firstName}, ${preview}`,
                link: `${env.WEB_URL}/projects/${project.id}/tasks/${taskId}`,
            }),
    });

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
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new NotFound('Comment not found');
    if (comment.authorId !== user.id) throw new Forbidden('You can only edit your own comments');
    const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { body },
        include: { author: true },
    });
    return presentComment(updated);
}
