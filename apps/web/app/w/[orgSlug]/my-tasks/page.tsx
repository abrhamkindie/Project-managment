import type { Metadata } from 'next';
import { MyTasksView } from '~/components/my-tasks-view';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'My Tasks' };

export default async function MyTasksPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    const { session, org } = await requireWorkspace(orgSlug);
    return <MyTasksView orgId={org.id} slug={org.slug} viewerId={session.user.id} />;
}
