import { notFound, redirect } from 'next/navigation';
import { projectPath, slugForOrg } from '~/lib/paths';
import { getProjectOrgId, getSession } from '~/lib/server-session';

/**
 * Root-level task link.
 *
 * The drawer is a query parameter rather than a nested route, so this ends in `?task=<id>` and
 * lands on the board with the card already open.
 */
export default async function TaskLink({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
    const { projectId, taskId } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}/tasks/${taskId}`)}`);

    const orgId = await getProjectOrgId(projectId);
    const slug = orgId ? slugForOrg(session, orgId) : undefined;
    if (!slug) notFound();

    redirect(`${projectPath(slug, projectId)}?task=${taskId}`);
}
