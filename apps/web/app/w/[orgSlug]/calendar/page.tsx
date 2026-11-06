import type { Metadata } from 'next';
import { CalendarView } from '~/components/calendar-view';
import { Page, PageHeader } from '~/components/page-shell';
import { requireWorkspace } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Calendar' };

/**
 * Workspace calendar: everything with a due date, in the viewer's own timezone.
 *
 * Scope is the set of projects the visitor can see, because the tasks endpoint already applies that
 * rule; the "Only mine" toggle inside the grid is the personal cut users actually ask for.
 */
export default async function CalendarPage({ params }: { params: Promise<{ orgSlug: string }> }) {
    const { orgSlug } = await params;
    const { session, org } = await requireWorkspace(orgSlug);

    return (
        <Page wide>
            <PageHeader title="Calendar" description="Due dates across every project you can reach in this workspace." />
            <CalendarView orgId={org.id} slug={org.slug} viewerId={session.user.id} timezone={session.user.timezone} />
        </Page>
    );
}
