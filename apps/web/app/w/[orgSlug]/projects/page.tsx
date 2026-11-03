import type { Metadata } from 'next';
import { ProjectsView } from '~/components/projects-view';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    const { org } = await requireWorkspace(orgSlug);
    return <ProjectsView orgId={org.id} slug={org.slug} role={org.role} />;
}
