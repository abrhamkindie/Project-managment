import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { input, validate } from '../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import * as projects from '../services/project.service.js';
import * as tasks from '../services/task.service.js';
import {
    createProjectSchema,
    createSectionSchema,
    projectListQuerySchema,
    projectMemberSchema,
    reorderSectionsSchema,
    updateProjectSchema,
    updateSectionSchema,
    type CreateProjectInput,
    type CreateSectionInput,
    type ProjectListQuery,
    type ProjectMemberInput,
    type ReorderSectionsInput,
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

projectRouter.get('/projects/:id/board', asyncHandler(async (req, res) => {
    res.json(await tasks.getBoard(currentUser(req), req.params.id));
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
