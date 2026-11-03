import { Router } from 'express';
import { asyncHandler, paginate } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { markNotificationsRead, parsePrefs } from '../services/activity.js';
import { presentNotification } from '../services/presenters.js';
import {
    markReadSchema,
    notificationListQuerySchema,
    updateProfileSchema,
    type MarkReadInput,
    type NotificationListQuery,
    type UpdateProfileInput,
} from '../domain/schemas.js';

/**
 * In-app notification inbox. Realtime delivery happens over Socket.IO
 * (`notification:new`); this is the durable list the UI hydrates from.
 */
export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get('/', validate(notificationListQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const query = input<NotificationListQuery>(req, 'query');
    const userId = currentUser(req).id;
    const where = { userId, ...(query.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
        prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    res.json({ ...paginate(items.map(presentNotification), total, query.page, query.pageSize), unread });
}));

notificationRouter.post('/read', validate(markReadSchema), asyncHandler(async (req, res) => {
    const count = await markNotificationsRead(currentUser(req).id, input<MarkReadInput>(req).ids);
    res.json({ updated: count });
}));

notificationRouter.post('/:id/read', asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
        where: { id: req.params.id, userId: currentUser(req).id },
        data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
}));

notificationRouter.delete('/:id', asyncHandler(async (req, res) => {
    await prisma.notification.deleteMany({ where: { id: req.params.id, userId: currentUser(req).id } });
    res.json({ id: req.params.id });
}));

/** Per-user e-mail preferences, surfaced in Settings. */
notificationRouter.get('/preferences', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
    res.json(parsePrefs(user.prefs));
}));

notificationRouter.put('/preferences', validate(updateProfileSchema), asyncHandler(async (req, res) => {
    const body = input<UpdateProfileInput>(req);
    if (!body.prefs) return res.status(400).json({ error: { code: 'bad_request', message: '`prefs` is required' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
    const merged = { ...parsePrefs(user.prefs), ...body.prefs };
    await prisma.user.update({ where: { id: user.id }, data: { prefs: JSON.stringify(merged) } });
    return res.json(merged);
}));
