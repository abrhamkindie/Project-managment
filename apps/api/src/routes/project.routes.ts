import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import * as projects from '../services/project.service.js';
import * as tasks from '../services/task.service.js';
import * as cycles from '../services/cycle.service.js';
import { projectTasksCsv } from '../services/export.service.js';
import {
    boardQuerySchema,
    createCycleSchema,
    createProjectSchema,
    createSectionSchema,
    cycleListQuerySchema,
    projectListQuerySchema,
    projectMemberSchema,
    projectExportQuerySchema,
    reorderSectionsSchema,
    updateCycleSchema,
    updateProjectSchema,
    updateSectionSchema,
    type BoardQuery,
    type CreateCycleInput,
    type CreateProjectInput,
    type CreateSectionInput,
    type CycleListQuery,
    type ProjectListQuery,
    type ProjectMemberInput,
    type ProjectExportQuery,
    type ReorderSectionsInput,
    type UpdateCycleInput,
    type UpdateProjectInput,
    type UpdateSectionInput,
} from '../domain/schemas.js';

/**
 * Projects, their members and their board columns.
 *
 * Task routes live in `task.routes.ts`; the board is assembled here because it spans
 * sections and cards.
 */
export const projectRouter = Router();

projectRouter.use(authenticate);

projectRouter.get('/organizations/:orgId/projects', validate(projectListQuerySchema, 'query'), asyncHandler(async (req, res) => {
    res.json(await projects.listProjects(currentUser(req), req.params.orgId, input<ProjectListQuery>(req, 'query')));
}));

projectRouter.post('/organizations/:orgId/projects', validate(createProjectSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await projects.createProject(currentUser(req), req.params.orgId, input<CreateProjectInput>(req)));
}));

projectRouter.get('/projects/:id', asyncHandler(async (req, res) => {
    res.json(await projects.getProject(currentUser(req), req.params.id));
}));

/**
 * Board payload is capped per column (`?limit=`), so a project with 10k cards still opens.
 * The response carries `total`/`truncated` per section and points at the task list for the rest.
 */
projectRouter.get('/projects/:id/board', validate(boardQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { limit } = input<BoardQuery>(req, 'query');
    res.json(await tasks.getBoard(currentUser(req), req.params.id, limit));
}));

/**
 * CSV snapshot of the project's tasks. `format` is reserved for future exporters; only `csv`
 * is supported today. The whole file is materialised then sent with a content-disposition so
 * the browser saves it with a sensible name.
 *
 * `?fields=<definitionId>,…` appends custom-field columns (Phase 6), in the order given.
 */
projectRouter.get('/projects/:id/export', validate(projectExportQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { fields } = input<ProjectExportQuery>(req, 'query');
    const csv = await projectTasksCsv(currentUser(req), req.params.id, fields ?? []);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-${req.params.id}.csv"`);
    res.send(csv);
}));

projectRouter.patch('/projects/:id', validate(updateProjectSchema), asyncHandler(async (req, res) => {
    res.json(await projects.updateProject(currentUser(req), req.params.id, input<UpdateProjectInput>(req)));
}));

projectRouter.delete('/projects/:id', asyncHandler(async (req, res) => {
    res.json(await projects.deleteProject(currentUser(req), req.params.id));
}));

// ------------------------------------------------------------------------ members

projectRouter.post('/projects/:id/members', validate(projectMemberSchema), asyncHandler(async (req, res) => {
    const body = input<ProjectMemberInput>(req);
    res.status(201).json(await projects.addProjectMembers(currentUser(req), req.params.id, body.userIds, body.role));
}));

projectRouter.delete('/projects/:id/members/:userId', asyncHandler(async (req, res) => {
    res.json(await projects.removeProjectMember(currentUser(req), req.params.id, req.params.userId));
}));

// ----------------------------------------------------------------------- sections

projectRouter.post('/projects/:id/sections', validate(createSectionSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await projects.createSection(currentUser(req), req.params.id, input<CreateSectionInput>(req)));
}));

projectRouter.patch('/sections/:id', validate(updateSectionSchema), asyncHandler(async (req, res) => {
    res.json(await projects.updateSection(currentUser(req), req.params.id, input<UpdateSectionInput>(req)));
}));

projectRouter.delete('/sections/:id', asyncHandler(async (req, res) => {
    res.json(await projects.deleteSection(currentUser(req), req.params.id));
}));

projectRouter.post('/projects/:id/sections/reorder', validate(reorderSectionsSchema), asyncHandler(async (req, res) => {
    await projects.reorderSections(currentUser(req), req.params.id, input<ReorderSectionsInput>(req).orderedIds);
    res.json(await projects.getProject(currentUser(req), req.params.id));
}));

// ----------------------------------------------------------------------- cycles

/**
 * Cycles (Linear "sprints") scoped to a project. List carries per-cycle task counts so
 * the board chip renders without a follow-up call; the close route returns open work to
 * the backlog (Linear-style scope freeze).
 */
projectRouter.get('/projects/:id/cycles', validate(cycleListQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { status } = input<CycleListQuery>(req, 'query');
    res.json(await cycles.listCycles(currentUser(req), req.params.id, status));
}));

projectRouter.post('/projects/:id/cycles', validate(createCycleSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await cycles.createCycle(currentUser(req), req.params.id, input<CreateCycleInput>(req)));
}));

projectRouter.patch('/cycles/:id', validate(updateCycleSchema), asyncHandler(async (req, res) => {
    res.json(await cycles.updateCycle(currentUser(req), req.params.id, input<UpdateCycleInput>(req)));
}));

projectRouter.post('/cycles/:id/close', asyncHandler(async (req, res) => {
    res.json(await cycles.closeCycle(currentUser(req), req.params.id));
}));

projectRouter.delete('/cycles/:id', asyncHandler(async (req, res) => {
    res.json(await cycles.deleteCycle(currentUser(req), req.params.id));
}));
