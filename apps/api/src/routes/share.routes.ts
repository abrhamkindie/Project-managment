import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser, requireOrgRole } from '../middleware/auth.js';
import { credentialLimit } from '../middleware/rateLimit.js';
import * as shares from '../services/share.service.js';
import { createShareLinkSchema, type CreateShareLinkInput } from '../domain/schemas.js';

/**
 * Public share links.
 *
 * Two routers because they have opposite trust: `shareRouter` is the authenticated management
 * surface (list, create, revoke your own links) and `publicRouter` is the anonymous read of one
 * snapshot, reached by anyone holding the URL.
 *
 * The public side is throttled per token so a guessed link is also a rate-limited one, and it is
 * the only route in the API that answers without any credential at all.
 */
export const shareRouter = Router();
export const publicShareRouter = Router();

shareRouter.use(authenticate);

shareRouter.get('/organizations/:orgId/shares', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json({ items: await shares.listShares(currentUser(req), req.params.orgId) });
}));

shareRouter.post(
    '/organizations/:orgId/shares',
    requireOrgRole('member'),
    validate(createShareLinkSchema),
    asyncHandler(async (req, res) => {
        // The organization comes from the shared object, not the URL: a link can only ever be
        // created for something the caller can already see inside this organization.
        res.status(201).json(await shares.createShare(currentUser(req), input<CreateShareLinkInput>(req)));
    }),
);

shareRouter.delete('/organizations/:orgId/shares/:id', requireOrgRole('member'), asyncHandler(async (req, res) => {
    res.json(await shares.revokeShare(currentUser(req), req.params.id));
}));

/** Board or task snapshot behind one token. Read-only, expiring, and deliberately cache-hostile. */
publicShareRouter.get(
    '/shares/:token',
    credentialLimit({ bucket: 'share', identity: (req) => `${req.ip ?? 'unknown'}:${req.params.token}`, limit: 60, windowMs: 60_000 }),
    asyncHandler(async (req, res) => {
        res.set('cache-control', 'no-store');
        res.json(await shares.snapshot(req.params.token));
    }),
);
