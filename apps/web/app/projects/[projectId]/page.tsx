import { notFound, redirect } from 'next/navigation';
import { projectPath, slugForOrg } from '~/lib/paths';
import { getProjectOrgId, getSession } from '~/lib/server-session';

/**
 * Root-level project link.
 *
 * Notifications are written by the API, which knows project ids but not workspace slugs, so this
 * shim resolves the id into the workspace shell and gets out of the way.
 */
export default async function ProjectLink({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);

    const orgId = await getProjectOrgId(projectId);
    const slug = orgId ? slugForOrg(session, orgId) : undefined;
    if (!slug) notFound();

    redirect(projectPath(slug, projectId));
}
