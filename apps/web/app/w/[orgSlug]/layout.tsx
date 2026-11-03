import type { ReactNode } from 'react';
import { WorkspaceShell } from '~/components/workspace-shell';
import { RealtimeProvider } from '~/lib/realtime';
import { requireWorkspace } from '~/lib/server-session';

/**
 * Every screen under `/w/<slug>` shares one workspace context: the slug is resolved against the
 * visitor's memberships on the server (a slug you do not belong to redirects), the shell renders
 * the chrome, and the realtime provider joins the rooms for this organization.
 */
export default async function WorkspaceLayout({ params, children }: { params: Promise<{ orgSlug: string }>; children: ReactNode }) {
    const { orgSlug } = await params;
    const { session, org } = await requireWorkspace(orgSlug);

    return (
        <RealtimeProvider orgId={org.id}>
            <WorkspaceShell session={session} org={org}>
                {children}
            </WorkspaceShell>
        </RealtimeProvider>
    );
}
