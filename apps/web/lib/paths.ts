import type { Session } from './types';

/**
 * Route helpers.
 *
 * The workspace slug lives in the URL (`/w/<slug>/…`) because everything on screen is scoped
 * to one workspace, and two browser tabs can then show two different workspaces without any
 * shared "current organization" state. Every link is built here so a route change is a
 * one-line change.
 */

export const workspacePath = (slug: string, section = 'dashboard') => `/w/${slug}/${section}`;
export const projectsPath = (slug: string) => workspacePath(slug, 'projects');
export const projectPath = (slug: string, projectId: string) => `${projectsPath(slug)}/${projectId}`;
export const taskPath = (slug: string, projectId: string, taskId: string) => `${projectPath(slug, projectId)}/tasks/${taskId}`;
export const myTasksPath = (slug: string) => workspacePath(slug, 'my-tasks');
export const calendarPath = (slug: string) => workspacePath(slug, 'calendar');
export const inboxPath = (slug: string) => workspacePath(slug, 'inbox');
export const membersPath = (slug: string) => workspacePath(slug, 'members');
export const settingsPath = () => '/settings';

/** Where to land after sign-in: the first membership, which sign-up creates for everybody. */
export function homeFor(session: Pick<Session, 'organizations'>): string {
    const org = session.organizations[0];
    return org ? workspacePath(org.slug) : '/onboarding';
}

/** Slug of the workspace a project belongs to, from the session's membership list. */
export function slugForOrg(session: Pick<Session, 'organizations'>, orgId: string): string | undefined {
    return session.organizations.find((org) => org.id === orgId)?.slug;
}

/**
 * Post-sign-in destination taken from the query string.
 *
 * Only root-relative paths are accepted: `//evil.example` is protocol-relative and `/api/...`
 * is not a page, so both are dropped rather than followed.
 */
export function safeNext(value: string | string[] | undefined): string | undefined {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/api')) return undefined;
    return candidate;
}
