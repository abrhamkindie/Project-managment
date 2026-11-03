import type { Metadata } from 'next';
import { SettingsView } from '~/components/settings-view';
import { requireSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Account settings sit outside `/w/<slug>` on purpose: a profile, a password and a notification
 * policy belong to the person, not to whichever workspace they happen to be looking at.
 */
export default async function SettingsPage() {
    const session = await requireSession();
    return <SettingsView session={session} />;
}
