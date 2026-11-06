import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, requireOrgRole } from '../middleware/auth.js';
import * as webhooks from '../services/webhook.service.js';
import {
    createWebhookSchema,
    updateWebhookSchema,
    webhookDeliveryQuerySchema,
    type CreateWebhookInput,
    type UpdateWebhookInput,
    type WebhookDeliveryQuery,
} from '../domain/schemas.js';

/**
 * Outbound webhook subscriptions.
 *
 * Organization admins only: a hook receives task titles and member names for as long as its URL is
 * correct, which is a data-egress decision rather than a day-to-day collaboration one.
 *
 * Sending is asynchronous (`services/webhook.service.ts` + the scheduler sweep). The one synchronous
 * endpoint here is `/test`, whose only job is to tell the person typing a URL whether it answered.
 */
export const webhookRouter = Router();

webhookRouter.use(authenticate);

webhookRouter.get('/organizations/:orgId/webhooks', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    res.json({ items: await webhooks.listWebhooks(req.params.orgId) });
}));

webhookRouter.post('/organizations/:orgId/webhooks', requireOrgRole('admin'), validate(createWebhookSchema), asyncHandler(async (req, res) => {
    const created = await webhooks.createWebhook(req.params.orgId, input<CreateWebhookInput>(req));
    res.status(201).json(created);
}));

webhookRouter.patch('/organizations/:orgId/webhooks/:id', requireOrgRole('admin'), validate(updateWebhookSchema), asyncHandler(async (req, res) => {
    res.json(await webhooks.updateWebhook(req.params.orgId, req.params.id, input<UpdateWebhookInput>(req)));
}));

webhookRouter.delete('/organizations/:orgId/webhooks/:id', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    res.json(await webhooks.deleteWebhook(req.params.orgId, req.params.id));
}));

/** New signing secret, returned once. Subscribers must be re-configured with it. */
webhookRouter.post('/organizations/:orgId/webhooks/:id/rotate-secret', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    res.json(await webhooks.rotateSecret(req.params.orgId, req.params.id));
}));

/**
 * One immediate signed POST with a fixed body. Nothing is queued, so a test does not look like
 * production traffic to the receiver and cannot be mistaken for a real event later.
 */
webhookRouter.post('/organizations/:orgId/webhooks/:id/test', requireOrgRole('admin'), asyncHandler(async (req, res) => {
    const body = JSON.stringify({ event: 'test', message: 'ZORQEN webhook test', sentAt: new Date().toISOString() });
    const target = await webhooks.loadTarget(req.params.orgId, req.params.id);
    const result = await webhooks.attemptDelivery({ url: target.url, secret: target.secret, body, deliveryId: 'test', event: 'test' });
    res.json({ delivered: result.status === 'success', responseCode: result.responseCode, error: result.error });
}));

webhookRouter.get(
    '/organizations/:orgId/webhooks/:id/deliveries',
    requireOrgRole('admin'),
    validate(webhookDeliveryQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const query = input<WebhookDeliveryQuery>(req, 'query');
        res.json(await webhooks.listDeliveries(req.params.orgId, req.params.id, query.page, query.pageSize));
    }),
);
