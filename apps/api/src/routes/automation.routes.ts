import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import * as automations from '../services/automation.service.js';
import {
    createAutomationSchema,
    updateAutomationSchema,
    type CreateAutomationInput,
    type UpdateAutomationInput,
} from '../domain/schemas.js';

/**
 * Project automation rules.
 *
 * Managing them is `can.editProject` (managers, the project lead, its creator) — a rule quietly
 * reassigns or re-statuses other people's work, so it is a settings power, not a contributor one.
 * The enforcement itself lives in the service; the engine runs from the activity write path.
 */
export const automationRouter = Router();

automationRouter.use(authenticate);

automationRouter.get('/projects/:projectId/automations', asyncHandler(async (req, res) => {
    res.json({ items: await automations.listRules(currentUser(req), req.params.projectId) });
}));

automationRouter.post(
    '/projects/:projectId/automations',
    validate(createAutomationSchema),
    asyncHandler(async (req, res) => {
        res.status(201).json(await automations.createRule(currentUser(req), req.params.projectId, input<CreateAutomationInput>(req)));
    }),
);

automationRouter.patch('/automations/:id', validate(updateAutomationSchema), asyncHandler(async (req, res) => {
    res.json(await automations.updateRule(currentUser(req), req.params.id, input<UpdateAutomationInput>(req)));
}));

automationRouter.delete('/automations/:id', asyncHandler(async (req, res) => {
    res.json(await automations.deleteRule(currentUser(req), req.params.id));
}));
