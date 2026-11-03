import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { InvitePanel } from '~/components/invite-panel';
import { homeFor } from '~/lib/paths';
import { getSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Join your team' };

/**
 * Invitation landing. The token stays in the URL so the screen is reloadable and shareable
 * inside the recipient's own browser; it is never written into storage.
 */
export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const token = typeof params.token === 'string' ? params.token : undefined;
    const email = typeof params.email === 'string' ? params.email : undefined;

    // A signed-in visitor with somewhere to go should not have to click through this screen.
    const session = await getSession();
    if (session && token === undefined) redirect(homeFor(session));

    return <InvitePanel token={token} email={email} />;
}
