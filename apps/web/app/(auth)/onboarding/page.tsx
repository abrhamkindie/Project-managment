import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CreateWorkspaceForm } from '~/components/create-workspace';
import { homeFor } from '~/lib/paths';
import { requireSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Create a workspace' };

/**
 * The fallback for an account with no workspace. Sign-up normally creates one, so this is only
 * reached by an account created some other way — once there is a workspace, the switcher offers
 * to create more and this screen sends the visitor on.
 */
export default async function OnboardingPage() {
    const session = await requireSession();
    if (session.organizations.length > 0) redirect(homeFor(session));

    return (
        <div className="space-y-6">
            <header className="space-y-1">
                <h2 className="text-2xl font-semibold text-ink">Create your workspace</h2>
                <p className="text-sm text-ink-muted">
                    A workspace holds your projects and your teammates. Signed up as <strong className="font-medium">{session.user.email}</strong>.
                </p>
            </header>
            <CreateWorkspaceForm />
            <p className="text-sm text-ink-muted">
                Waiting to be invited instead?{' '}
                <a href="/invite" className="link">
                    Open your invitation link
                </a>
            </p>
        </div>
    );
}
