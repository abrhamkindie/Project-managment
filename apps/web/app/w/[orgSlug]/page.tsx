import { redirect } from 'next/navigation';
import { workspacePath } from '~/lib/paths';

/** `/w/<slug>` has no content of its own — the dashboard is the workspace home. */
export default async function WorkspaceIndex({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    redirect(workspacePath(orgSlug));
}
