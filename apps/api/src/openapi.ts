import { Router } from 'express';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from './config/env.js';
import {
    acceptInviteSchema,
    activityFeedQuerySchema,
    analyticsQuerySchema,
    assignSchema,
    boardQuerySchema,
    bulkTaskSchema,
    changePasswordSchema,
    createCommentSchema,
    createCustomFieldSchema,
    createLabelSchema,
    createOrganizationSchema,
    createProjectSchema,
    createSectionSchema,
    createTaskSchema,
    createTeamSchema,
    fieldListQuerySchema,
    forgotPasswordSchema,
    inviteSchema,
    labelIdsSchema,
    loginSchema,
    markReadSchema,
    memberRoleSchema,
    moveTaskSchema,
    notificationListQuerySchema,
    projectMemberSchema,
    projectListQuerySchema,
    registerSchema,
    reorderSectionsSchema,
    resetPasswordSchema,
    resetTokenQuerySchema,
    taskListQuerySchema,
    taskFieldValuesSchema,
    teamMembersSchema,
    updateCustomFieldSchema,
    updateOrganizationSchema,
    updateProfileSchema,
    updateProjectSchema,
    updateSectionSchema,
    updateTaskSchema,
} from './domain/schemas.js';

// Mirrors the inline definition in routes/auth.routes.ts (kept local on purpose).
const googleSchema = z.object({ idToken: z.string().min(1, 'Google ID token is required') });

/**
 * OpenAPI 3.1 document built from the same Zod schemas `validate()` uses at runtime,
 * so the docs and the request contracts can never disagree. The catalog below mirrors
 * the mount table in `routes/index.ts` (paths are shown under the canonical `/api/v1`).
 */

type ParamDef = { name: string; description?: string };

interface RouteDef {
    method: 'get' | 'post' | 'patch' | 'put' | 'delete';
    path: string;
    tag: string;
    summary: string;
    body?: { name: string; schema: object };
    query?: { name: string; schema: object };
    params?: ParamDef[];
    deprecated?: boolean;
}

const ORGANIZATION_PARAMS: ParamDef[] = [{ name: 'orgId', description: 'Organization id' }];
const TASK_PARAMS: ParamDef[] = [{ name: 'id', description: 'Task id' }];

const catalog: RouteDef[] = [
    // ---------------------------------------------------------------- auth
    { method: 'post', path: '/auth/register', tag: 'Auth', summary: 'Create an account', body: { name: 'Register', schema: registerSchema } },
    { method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Sign in (sets session cookies)', body: { name: 'Login', schema: loginSchema } },
    { method: 'post', path: '/auth/forgot-password', tag: 'Auth', summary: 'Send a password-reset link by email', body: { name: 'ForgotPassword', schema: forgotPasswordSchema } },
    { method: 'get', path: '/auth/password-reset', tag: 'Auth', summary: 'Check whether a reset token is still valid', query: { name: 'ResetTokenQuery', schema: resetTokenQuerySchema } },
    { method: 'post', path: '/auth/reset-password', tag: 'Auth', summary: 'Consume a reset token and set a new password', body: { name: 'ResetPassword', schema: resetPasswordSchema } },
    { method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate the refresh token and reissue access' },
    { method: 'post', path: '/auth/logout', tag: 'Auth', summary: 'Revoke the current session' },
    { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current user with their organizations' },
    { method: 'get', path: '/auth/sessions', tag: 'Auth', summary: 'Active sessions for the current user' },
    { method: 'delete', path: '/auth/sessions', tag: 'Auth', summary: 'Revoke all other sessions' },
    { method: 'patch', path: '/auth/profile', tag: 'Auth', summary: 'Update profile fields', body: { name: 'UpdateProfile', schema: updateProfileSchema } },
    { method: 'post', path: '/auth/password', tag: 'Auth', summary: 'Change password (relogs everywhere else)', body: { name: 'ChangePassword', schema: changePasswordSchema } },
    { method: 'post', path: '/auth/google', tag: 'Auth', summary: 'Sign in / sign up / link with a Google identity token', body: { name: 'GoogleLogin', schema: googleSchema } },

    // --------------------------------------------------------- organizations
    { method: 'get', path: '/organizations', tag: 'Organizations', summary: 'Organizations the caller belongs to' },
    { method: 'post', path: '/organizations', tag: 'Organizations', summary: 'Create a workspace', body: { name: 'CreateOrganization', schema: createOrganizationSchema } },
    { method: 'post', path: '/organizations/invitations/accept', tag: 'Organizations', summary: 'Accept an invitation by token', body: { name: 'AcceptInvite', schema: acceptInviteSchema } },
    { method: 'get', path: '/organizations/{orgId}', tag: 'Organizations', summary: 'Organization detail', params: ORGANIZATION_PARAMS },
    { method: 'patch', path: '/organizations/{orgId}', tag: 'Organizations', summary: 'Rename an organization (admin)', params: ORGANIZATION_PARAMS, body: { name: 'UpdateOrganization', schema: updateOrganizationSchema } },
    { method: 'get', path: '/organizations/{orgId}/members', tag: 'Organizations', summary: 'Roster with roles and presence', params: ORGANIZATION_PARAMS },
    { method: 'patch', path: '/organizations/{orgId}/members/{userId}', tag: 'Organizations', summary: 'Change a member role (admin)', params: [...ORGANIZATION_PARAMS, { name: 'userId' }], body: { name: 'MemberRole', schema: memberRoleSchema } },
    { method: 'delete', path: '/organizations/{orgId}/members/{userId}', tag: 'Organizations', summary: 'Remove a member (admin)', params: [...ORGANIZATION_PARAMS, { name: 'userId' }] },
    { method: 'post', path: '/organizations/{orgId}/invitations', tag: 'Organizations', summary: 'Invite a person by email (admin)', params: ORGANIZATION_PARAMS, body: { name: 'Invite', schema: inviteSchema } },
    { method: 'get', path: '/organizations/{orgId}/invitations', tag: 'Organizations', summary: 'Pending invitations (admin)', params: ORGANIZATION_PARAMS },
    { method: 'delete', path: '/organizations/{orgId}/invitations/{invitationId}', tag: 'Organizations', summary: 'Revoke an invitation (admin)', params: [...ORGANIZATION_PARAMS, { name: 'invitationId' }] },
    { method: 'get', path: '/organizations/{orgId}/teams', tag: 'Organizations', summary: 'Teams with members', params: ORGANIZATION_PARAMS },
    { method: 'post', path: '/organizations/{orgId}/teams', tag: 'Organizations', summary: 'Create a team (manager+)', params: ORGANIZATION_PARAMS, body: { name: 'CreateTeam', schema: createTeamSchema } },
    { method: 'put', path: '/organizations/{orgId}/teams/{teamId}/members', tag: 'Organizations', summary: 'Replace team membership (manager+)', params: [...ORGANIZATION_PARAMS, { name: 'teamId' }], body: { name: 'TeamMembers', schema: teamMembersSchema } },
    { method: 'get', path: '/organizations/{orgId}/labels', tag: 'Organizations', summary: 'Labels (org-wide and project-scoped)', params: ORGANIZATION_PARAMS },
    { method: 'post', path: '/organizations/{orgId}/labels', tag: 'Organizations', summary: 'Create a label', params: ORGANIZATION_PARAMS, body: { name: 'CreateLabel', schema: createLabelSchema } },
    { method: 'delete', path: '/organizations/{orgId}/labels/{labelId}', tag: 'Organizations', summary: 'Delete a label', params: [...ORGANIZATION_PARAMS, { name: 'labelId' }] },
    { method: 'get', path: '/organizations/{orgId}/fields', tag: 'Custom fields', summary: 'Field definitions: organization-wide, or plus one project scope', params: ORGANIZATION_PARAMS, query: { name: 'FieldListQuery', schema: fieldListQuerySchema } },
    { method: 'post', path: '/organizations/{orgId}/fields', tag: 'Custom fields', summary: 'Create a field definition', params: ORGANIZATION_PARAMS, body: { name: 'CreateCustomField', schema: createCustomFieldSchema } },
    { method: 'patch', path: '/organizations/{orgId}/fields/{fieldId}', tag: 'Custom fields', summary: 'Rename a field or replace its options', params: [...ORGANIZATION_PARAMS, { name: 'fieldId' }], body: { name: 'UpdateCustomField', schema: updateCustomFieldSchema } },
    { method: 'delete', path: '/organizations/{orgId}/fields/{fieldId}', tag: 'Custom fields', summary: 'Delete a field and every value it holds', params: [...ORGANIZATION_PARAMS, { name: 'fieldId' }] },
    { method: 'get', path: '/tasks/{id}/fields', tag: 'Custom fields', summary: 'Definitions a task can carry, with its current values', params: TASK_PARAMS },
    { method: 'patch', path: '/tasks/{id}/fields', tag: 'Custom fields', summary: 'Set or clear values, keyed by field id', params: TASK_PARAMS, body: { name: 'TaskFieldValues', schema: taskFieldValuesSchema } },

    { method: 'get', path: '/organizations/{orgId}/activity', tag: 'Organizations', summary: 'Audit/activity feed', params: ORGANIZATION_PARAMS, query: { name: 'ActivityFeedQuery', schema: activityFeedQuerySchema } },
    { method: 'get', path: '/organizations/{orgId}/presence', tag: 'Organizations', summary: 'Online/away map for the roster', params: ORGANIZATION_PARAMS },

    // ------------------------------------------------------------- projects
    { method: 'get', path: '/organizations/{orgId}/projects', tag: 'Projects', summary: 'List projects', params: ORGANIZATION_PARAMS, query: { name: 'ProjectListQuery', schema: projectListQuerySchema } },
    { method: 'post', path: '/organizations/{orgId}/projects', tag: 'Projects', summary: 'Create a project', params: ORGANIZATION_PARAMS, body: { name: 'CreateProject', schema: createProjectSchema } },
    { method: 'get', path: '/projects/{id}', tag: 'Projects', summary: 'Project detail', params: [{ name: 'id', description: 'Project id' }] },
    { method: 'get', path: '/projects/{id}/board', tag: 'Projects', summary: 'Kanban board: sections with capped card lists', params: [{ name: 'id' }], query: { name: 'BoardQuery', schema: boardQuerySchema } },
    { method: 'patch', path: '/projects/{id}', tag: 'Projects', summary: 'Update project (also archive/restore via `status`)', params: [{ name: 'id' }], body: { name: 'UpdateProject', schema: updateProjectSchema } },
    { method: 'delete', path: '/projects/{id}', tag: 'Projects', summary: 'Archive or delete a project', params: [{ name: 'id' }] },
    { method: 'post', path: '/projects/{id}/members', tag: 'Projects', summary: 'Add a project member', params: [{ name: 'id' }], body: { name: 'ProjectMember', schema: projectMemberSchema } },
    { method: 'delete', path: '/projects/{id}/members/{userId}', tag: 'Projects', summary: 'Remove a project member', params: [{ name: 'id' }, { name: 'userId' }] },
    { method: 'post', path: '/projects/{id}/sections', tag: 'Projects', summary: 'Create a column', params: [{ name: 'id' }], body: { name: 'CreateSection', schema: createSectionSchema } },
    { method: 'patch', path: '/sections/{id}', tag: 'Projects', summary: 'Rename a column', params: [{ name: 'id', description: 'Section id' }], body: { name: 'UpdateSection', schema: updateSectionSchema } },
    { method: 'delete', path: '/sections/{id}', tag: 'Projects', summary: 'Delete a column (tasks become unassigned)', params: [{ name: 'id' }] },
    { method: 'post', path: '/projects/{id}/sections/reorder', tag: 'Projects', summary: 'Reorder columns', params: [{ name: 'id' }], body: { name: 'ReorderSections', schema: reorderSectionsSchema } },

    // ---------------------------------------------------------------- tasks
    { method: 'get', path: '/organizations/{orgId}/tasks', tag: 'Tasks', summary: 'Org-scoped task search/filter (powers My tasks)', params: ORGANIZATION_PARAMS, query: { name: 'TaskListQuery', schema: taskListQuerySchema } },
    { method: 'post', path: '/organizations/{orgId}/tasks', tag: 'Tasks', summary: 'Create a task', params: ORGANIZATION_PARAMS, body: { name: 'CreateTask', schema: createTaskSchema } },
    { method: 'post', path: '/organizations/{orgId}/tasks/bulk', tag: 'Tasks', summary: 'Bulk status/priority/delete/move/assign', params: ORGANIZATION_PARAMS, body: { name: 'BulkTasks', schema: bulkTaskSchema } },
    { method: 'get', path: '/organizations/{orgId}/my-tasks', tag: 'Tasks', summary: 'Open tasks grouped by project for the caller', params: ORGANIZATION_PARAMS },
    { method: 'get', path: '/tasks/{id}', tag: 'Tasks', summary: 'Task detail with timeline, subtasks and parent', params: TASK_PARAMS },
    { method: 'patch', path: '/tasks/{id}', tag: 'Tasks', summary: 'Update task fields', params: TASK_PARAMS, body: { name: 'UpdateTask', schema: updateTaskSchema } },
    { method: 'delete', path: '/tasks/{id}', tag: 'Tasks', summary: 'Soft-delete a task', params: TASK_PARAMS },
    { method: 'post', path: '/tasks/{id}/complete', tag: 'Tasks', summary: 'Mark done', params: TASK_PARAMS },
    { method: 'put', path: '/tasks/{id}/assignees', tag: 'Tasks', summary: 'Add/replace/remove assignees', params: TASK_PARAMS, body: { name: 'Assign', schema: assignSchema } },
    { method: 'post', path: '/tasks/{id}/move', tag: 'Tasks', summary: 'Kanban drag & drop', params: TASK_PARAMS, body: { name: 'MoveTask', schema: moveTaskSchema } },
    { method: 'put', path: '/tasks/{id}/labels', tag: 'Tasks', summary: 'Replace label set', params: TASK_PARAMS, body: { name: 'LabelIds', schema: labelIdsSchema } },
    { method: 'get', path: '/tasks/{id}/activity', tag: 'Tasks', summary: 'Task activity page', params: TASK_PARAMS },

    // ------------------------------------------------------------ comments
    { method: 'get', path: '/tasks/{id}/comments', tag: 'Comments', summary: 'Comments for a task', params: TASK_PARAMS },
    { method: 'post', path: '/tasks/{id}/comments', tag: 'Comments', summary: 'Add a comment (@mentions notify)', params: TASK_PARAMS, body: { name: 'CreateComment', schema: createCommentSchema } },
    { method: 'patch', path: '/comments/{id}', tag: 'Comments', summary: 'Edit own comment', params: [{ name: 'id', description: 'Comment id' }], body: { name: 'CreateComment', schema: createCommentSchema } },
    { method: 'delete', path: '/comments/{id}', tag: 'Comments', summary: 'Soft-delete own comment', params: [{ name: 'id' }] },

    // ----------------------------------------------------------- attachments
    { method: 'post', path: '/tasks/{id}/attachments', tag: 'Attachments', summary: 'Upload (multipart, magic-byte sniffed)', params: TASK_PARAMS },
    { method: 'get', path: '/tasks/{id}/attachments/{attachmentId}/download', tag: 'Attachments', summary: 'Download as attachment', params: [...TASK_PARAMS, { name: 'attachmentId' }] },
    { method: 'get', path: '/tasks/{id}/attachments/{attachmentId}/view', tag: 'Attachments', summary: 'Inline view', params: [...TASK_PARAMS, { name: 'attachmentId' }] },
    { method: 'delete', path: '/tasks/{id}/attachments/{attachmentId}', tag: 'Attachments', summary: 'Delete an attachment', params: [...TASK_PARAMS, { name: 'attachmentId' }] },

    // ------------------------------------------------------------- analytics
    { method: 'get', path: '/organizations/{orgId}/analytics/overview', tag: 'Analytics', summary: 'Org throughput and aging', params: ORGANIZATION_PARAMS, query: { name: 'AnalyticsQuery', schema: analyticsQuerySchema } },
    { method: 'get', path: '/organizations/{orgId}/analytics/workload', tag: 'Analytics', summary: 'Per-member workload and progress', params: ORGANIZATION_PARAMS, query: { name: 'AnalyticsQuery', schema: analyticsQuerySchema } },
    { method: 'get', path: '/projects/{projectId}/analytics', tag: 'Analytics', summary: 'Project overview (status mix, trend)', params: [{ name: 'projectId' }], query: { name: 'AnalyticsQuery', schema: analyticsQuerySchema } },

    // --------------------------------------------------------- notifications
    { method: 'get', path: '/notifications', tag: 'Notifications', summary: 'Inbox page', query: { name: 'NotificationListQuery', schema: notificationListQuerySchema } },
    { method: 'post', path: '/notifications/read', tag: 'Notifications', summary: 'Mark many read', body: { name: 'MarkRead', schema: markReadSchema } },
    { method: 'post', path: '/notifications/{id}/read', tag: 'Notifications', summary: 'Mark one read', params: [{ name: 'id' }] },
    { method: 'delete', path: '/notifications/{id}', tag: 'Notifications', summary: 'Dismiss one', params: [{ name: 'id' }] },
    { method: 'get', path: '/notifications/preferences', tag: 'Notifications', summary: 'Email preference map' },
    { method: 'put', path: '/notifications/preferences', tag: 'Notifications', summary: 'Update email preferences', body: { name: 'UpdateProfile', schema: updateProfileSchema } },
];

const BODY_SCHEMAS = new Map(
    catalog
        .filter((r) => r.body)
        .map((r) => [r.body!.name, zodToJsonSchema(r.body!.schema as never, { target: 'openApi3' })]),
);
const QUERY_SCHEMAS = new Map(
    catalog
        .filter((r) => r.query)
        .map((r) => [r.query!.name, zodToJsonSchema(r.query!.schema as never, { target: 'openApi3' })]),
);

function expressPath(openApiPath: string): string {
    return openApiPath.replace(/\{[^}]+\}/g, ':x');
}

const paths: Record<string, Record<string, unknown>> = {};
for (const route of catalog) {
    const parameters = [
        ...(route.params ?? []).map((p) => ({
            name: p.name,
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: p.description,
        })),
        ...(route.query
            ? Object.entries((QUERY_SCHEMAS.get(route.query.name) as { properties?: Record<string, unknown> }).properties ?? {}).map(
                ([name, schema]) => ({
                    name,
                    in: 'query',
                    required: false,
                    schema,
                }),
            )
            : []),
    ];
    const operation: Record<string, unknown> = {
        tags: [route.tag],
        summary: route.summary,
        security: route.path.startsWith('/auth/register') || route.path === '/auth/login' || route.path.includes('forgot') || route.path.includes('reset') || route.path === '/auth/google' || route.path === '/auth/refresh'
            ? [{}, { cookieAuth: [] }]
            : [{ cookieAuth: [] }],
    };
    if (parameters.length) operation.parameters = parameters;
    if (route.body) {
        operation.requestBody = {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${route.body.name}` } } },
        };
    }
    operation.responses = {
        '200': { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
        '4XX': { $ref: '#/components/responses/Error' },
    };
    paths[route.path] ??= {};
    paths[route.path][route.method] = operation;
    void expressPath; // path params already carry their descriptions; kept for future validation
}

export function buildOpenApiDocument() {
    return {
        openapi: '3.1.0',
        info: {
            title: 'ZORQEN API',
            version: '1.0.0',
            description:
                'Project management platform API. Session cookies are issued by /auth/login; every other route is tenant-scoped through organizations and project visibility.',
        },
        servers: [{ url: '/api/v1' }, { url: '/api', deprecated: true }],
        components: {
            securitySchemes: {
                cookieAuth: { type: 'apiKey', in: 'cookie', name: 'zorqen_at' },
                bearerAuth: { type: 'http', scheme: 'bearer' },
            },
            responses: {
                Error: {
                    description: 'Structured error (see middleware/error.ts)',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, details: {} } },
                                },
                            },
                        },
                    },
                },
            },
            schemas: Object.fromEntries([...BODY_SCHEMAS, ...QUERY_SCHEMAS]),
        },
        paths,
    };
}

/** Swagger UI shell (dev/staging only — the CDN bundle is not pinned) + JSON, under `/api/docs`. */
export function docsRouter(): Router {
    const router = Router();
    router.get('/docs/openapi.json', (_req, res) => res.json(buildOpenApiDocument()));
    router.get('/docs', (_req, res) => {
        if (env.NODE_ENV === 'production') return res.redirect('/api/docs/openapi.json');
        res.type('html').send(`<!doctype html><html><head><title>ZORQEN API</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:'/api/docs/openapi.json',dom_id:'#swagger'});</script></body></html>`);
    });
    return router;
}
