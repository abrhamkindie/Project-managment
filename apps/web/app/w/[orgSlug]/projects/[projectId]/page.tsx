import type { Metadata } from 'next';
import { ProjectWorkspace } from '~/components/project/workspace';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Project' };

/**
 * A single project.
 *
 * Which task is open arrives as `?task=<id>` — the shape the API uses in notification links — and
 * is handed to the client as an initial value rather than read from the URL in the browser, so
 * this page needs no `Suspense` boundary for `useSearchParams`.
 */
export default async function ProjectPage({
    params,
    searchParams,
}: {
    params: Promise<{ orgSlug: string; projectId: string }>;
    searchParams: Promise<{ task?: string | string[] }>;
}) {
    const [{ orgSlug, projectId }, query] = await Promise.all([params, searchParams]);
    const { session, org } = await requireWorkspace(orgSlug);
    const task = Array.isArray(query.task) ? query.task[0] : query.task;

    return <ProjectWorkspace orgId={org.id} slug={org.slug} projectId={projectId} viewerId={session.user.id} timezone={session.user.timezone} initialTaskId={task ?? null} />;
}
