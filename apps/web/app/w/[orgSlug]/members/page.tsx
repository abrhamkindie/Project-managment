import type { Metadata } from 'next';
import { MembersView } from '~/components/members-view';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    const { session, org } = await requireWorkspace(orgSlug);

    return (
        <MembersView
            orgId={org.id}
            viewerId={session.user.id}
            role={org.role}
            ownerId={org.ownerId}
        />
    );
}
