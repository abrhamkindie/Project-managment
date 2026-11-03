import type { Metadata } from 'next';
import { DashboardView } from '~/components/dashboard-view';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    const { org } = await requireWorkspace(orgSlug);
    return <DashboardView orgId={org.id} slug={org.slug} />;
}
