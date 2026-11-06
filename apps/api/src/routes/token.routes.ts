import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser, requireSession } from '../middleware/auth.js';
import * as tokens from '../services/api-token.service.js';
import { createApiTokenSchema, type CreateApiTokenInput } from '../domain/schemas.js';

/**
 * Personal access token management.
 *
 * Every route here is session-only (`requireSession`): a token that could mint tokens would make
 * its own scope permanent, and revocation would be something a leaked credential could veto.
 * The plaintext appears exactly once, in the create response.
 */
export const tokenRouter = Router();

tokenRouter.use(authenticate, requireSession);

tokenRouter.get('/', asyncHandler(async (req, res) => {
    res.json({ items: await tokens.listTokens(currentUser(req).id) });
}));

tokenRouter.post('/', validate(createApiTokenSchema), asyncHandler(async (req, res) => {
    const created = await tokens.createToken(currentUser(req), input<CreateApiTokenInput>(req));
    res.status(201).json(created);
}));

tokenRouter.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await tokens.revokeToken(currentUser(req).id, req.params.id));
}));
