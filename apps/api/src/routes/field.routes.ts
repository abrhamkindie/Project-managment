import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import * as fields from '../services/custom-field.service.js';
import {
    createCustomFieldSchema,
    fieldListQuerySchema,
    taskFieldValuesSchema,
    updateCustomFieldSchema,
    type CreateCustomFieldInput,
    type FieldListQuery,
    type TaskFieldValuesInput,
    type UpdateCustomFieldInput,
} from '../domain/schemas.js';

/**
 * Custom fields: the definitions and their per-task values (Phase 6).
 *
 * Definitions are organization-scoped in the URL because a field is shared vocabulary — the whole
 * point is that two people mean the same thing by "Release tier". Values belong to a task, so they
 * hang off `/tasks/:id/fields` beside the other task sub-resources.
 *
 * The role rule is deliberately split: the route only requires organization membership, and the
 * service decides who may change a shape (a manager for organization-wide fields, the project's own
 * edit rule for project-scoped ones). Encoding that in middleware would need the definition row,
 * which is exactly what the service has to load anyway.
 */
export const fieldRouter = Router();

fieldRouter.use(authenticate);

fieldRouter.get(
    '/organizations/:orgId/fields',
    validate(fieldListQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const query = input<FieldListQuery>(req, 'query');
        res.json(await fields.listFields(currentUser(req), req.params.orgId, query.projectId));
    }),
);

fieldRouter.post(
    '/organizations/:orgId/fields',
    validate(createCustomFieldSchema),
    asyncHandler(async (req, res) => {
        res.status(201).json(await fields.createField(currentUser(req), req.params.orgId, input<CreateCustomFieldInput>(req)));
    }),
);

fieldRouter.patch(
    '/organizations/:orgId/fields/:fieldId',
    validate(updateCustomFieldSchema),
    asyncHandler(async (req, res) => {
        res.json(await fields.updateField(currentUser(req), req.params.orgId, req.params.fieldId, input<UpdateCustomFieldInput>(req)));
    }),
);

fieldRouter.delete('/organizations/:orgId/fields/:fieldId', asyncHandler(async (req, res) => {
    res.json(await fields.deleteField(currentUser(req), req.params.orgId, req.params.fieldId));
}));

/** Definitions this task can carry plus the values it already has — one call paints the drawer block. */
fieldRouter.get('/tasks/:id/fields', asyncHandler(async (req, res) => {
    res.json(await fields.taskFields(currentUser(req), req.params.id));
}));

/** Partial update by field id: only the keys sent are touched, so concurrent edits do not clobber. */
fieldRouter.patch(
    '/tasks/:id/fields',
    validate(taskFieldValuesSchema),
    asyncHandler(async (req, res) => {
        res.json(await fields.setFieldValues(currentUser(req), req.params.id, input<TaskFieldValuesInput>(req)));
    }),
);
