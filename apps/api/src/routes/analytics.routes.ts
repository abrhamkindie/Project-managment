import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import * as analytics from '../services/analytics.service.js';
import { analyticsQuerySchema, burndownQuerySchema, type AnalyticsQuery, type BurndownQuery } from '../domain/schemas.js';
import { prisma } from '../lib/prisma.js';
import { NotFound } from '../domain/errors.js';

/**
 * Reporting endpoints. Everything is read-only and scope-aware: passing `projectId`
 * narrows the report to one project (members allowed), omitting it reports on the whole
 * organization (managers and admins).
 */
export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

analyticsRouter.get(
    '/organizations/:orgId/analytics/overview',
    validate(analyticsQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        res.json(await analytics.overview(currentUser(req), req.params.orgId, input<AnalyticsQuery>(req, 'query')));
    }),
);

analyticsRouter.get(
    '/organizations/:orgId/analytics/workload',
    validate(analyticsQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        res.json(await analytics.workload(currentUser(req), req.params.orgId, input<AnalyticsQuery>(req, 'query')));
    }),
);

analyticsRouter.get(
    '/projects/:projectId/analytics',
    validate(analyticsQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const project = await prisma.project.findUnique({
            where: { id: req.params.projectId },
            select: { orgId: true },
        });
        if (!project) throw new NotFound('Project not found');
        const query = { ...input<AnalyticsQuery>(req, 'query'), projectId: req.params.projectId };
        res.json(await analytics.overview(currentUser(req), project.orgId, query));
    }),
);

/** Burndown for one cycle: remaining scope per day against the ideal line. */
analyticsRouter.get(
    '/projects/:projectId/analytics/burndown',
    validate(burndownQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        res.json(await analytics.cycleBurndown(currentUser(req), req.params.projectId, input<BurndownQuery>(req, 'query').cycleId));
    }),
);

/** Velocity trend: scope, completion and logged time per cycle, oldest first. */
analyticsRouter.get(
    '/projects/:projectId/analytics/cycles',
    asyncHandler(async (req, res) => {
        res.json(await analytics.cycleCompletion(currentUser(req), req.params.projectId));
    }),
);
