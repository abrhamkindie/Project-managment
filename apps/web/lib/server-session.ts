import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ApiError, api } from './api';
import { homeFor, workspacePath } from './paths';
import type { OrganizationSummary, ProjectDetailDto, Session } from './types';

/**
 * Session access for server components.
 *
 * The visitor's cookies are forwarded verbatim to the API, so the server sees exactly what
 * the browser sees: no shared secret and no second source of truth about who is signed in.
 *
 * Note what this deliberately does *not* do: refresh. Refresh tokens are single-use, and a
 * server-side rotation would set new cookies on an outgoing server fetch that the browser
 * never receives — the visitor would then replay a consumed token and have every session
 * revoked. So an expired access token simply means "not signed in here", and the login
 * screen performs the rotation where the cookies can actually land.
 *
 * Both lookups are wrapped in React `cache`, so a layout and the page inside it share one
 * upstream call per request instead of asking `GET /auth/me` twice.
 */
export const getSession = cache(async (): Promise<Session | null> => {
    const jar = await cookies();
    const cookie = jar.toString();
    if (!cookie.includes('atlas_at')) return null;
    try {
        return await api.get<Session>('/auth/me', { headers: { cookie } });
    } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
    }
});

export const requireSession = cache(async (): Promise<Session> => {
    const session = await getSession();
    if (!session) redirect('/login');
    return session;
});

/**
 * Resolves a workspace from the URL slug against the session's memberships, so a slug the
 * visitor has no part in is a redirect rather than a leak or a 500.
 */
export const requireWorkspace = cache(async (slug: string): Promise<{ session: Session; org: OrganizationSummary }> => {
    const session = await requireSession();
    const org = session.organizations.find((candidate) => candidate.slug === slug);
    if (!org) redirect(homeFor(session));
    return { session, org };
});

/**
 * Which workspace a project belongs to, for the root-level links the API writes into
 * notifications (`/projects/:id/tasks/:id`, which cannot know a slug).
 *
 * A stale or unauthorised link answers `null` and the caller shows a not-found page: guessing a
 * workspace instead ("just use the first one") would point the link at a project that is not it.
 */
export const getProjectOrgId = cache(async (projectId: string): Promise<string | null> => {
    const session = await getSession();
    if (!session) return null;
    const jar = await cookies();
    try {
        const detail = await api.get<ProjectDetailDto>(`/projects/${projectId}`, { headers: { cookie: jar.toString() } });
        return detail.orgId;
    } catch (error) {
        if (error instanceof ApiError && (error.isUnauthorized || error.status === 403 || error.status === 404)) return null;
        throw error;
    }
});

/**
 * A root-level link such as `/dashboard` or `/my-tasks`, resolved into the workspace shell.
 *
 * The API writes notification links without a slug because it has no way to know which of the
 * visitor's workspaces they are reading. Their first membership is where they signed up, and the
 * switcher is one click away from there.
 */
export async function intoWorkspace(section: string, from: string): Promise<never> {
    const session = await getSession();
    if (!session) redirect(`/login?next=${encodeURIComponent(from)}`);
    const org = session.organizations[0];
    if (!org) redirect('/onboarding');
    redirect(workspacePath(org.slug, section));
}
