import type { Metadata } from 'next';
import { InboxView } from '~/components/inbox-view';

export const metadata: Metadata = { title: 'Inbox' };

/**
 * Notifications belong to a person, not a workspace, so nothing is scoped here.
 *
 * The route still sits under `/w/<slug>` because that is where the shell and the sidebar live —
 * the layout above has already proven the visitor belongs to this workspace.
 */
export default function InboxPage() {
    return <InboxView />;
}
