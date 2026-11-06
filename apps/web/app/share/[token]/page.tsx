import type { Metadata } from 'next';
import { cache } from 'react';
import { ApiError, api } from '~/lib/api';
import { ShareView } from '~/components/share-view';
import type { ShareSnapshot } from '~/lib/types';

/**
 * A shared link, rendered for somebody with no account and no cookies.
 *
 * `cache` keeps `generateMetadata` and the page on a single upstream read per request — the same
 * trick `lib/server-session.ts` uses for the session — and the token is looked up by the API, never
 * here: this route holds no key, so a page cannot be coaxed into naming a project the link does not
 * cover. A dead, revoked or expired link all answer 404 upstream and all render the same sentence,
 * because telling them apart would confirm which tokens once existed.
 */

const loadSnapshot = cache(async (token: string): Promise<ShareSnapshot | null> => {
    try {
        return await api.get<ShareSnapshot>(`/public/shares/${token}`, { retryOn401: false });
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
    }
});

/** Never cached: a revocation has to bite on the very next load. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const { token } = await params;
    const snapshot = await loadSnapshot(token);
    if (!snapshot) return { title: 'Shared link' };
    const title = snapshot.kind === 'task' ? snapshot.task.title : snapshot.project.name;
    return {
        title,
        description: snapshot.kind === 'project' ? snapshot.project.description ?? undefined : undefined,
    };
}

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const snapshot = await loadSnapshot(token);

    if (!snapshot) {
        return (
            <main className="grid min-h-screen place-items-center bg-canvas px-5">
                <div className="card max-w-md p-6 text-center">
                    <h1 className="text-lg font-semibold text-ink">This link is not available</h1>
                    <p className="mt-2 text-sm text-ink-muted">
                        Share links expire and can be revoked by whoever created them. Ask for a fresh one if you expected to see a
                        board here.
                    </p>
                </div>
            </main>
        );
    }

    return <ShareView snapshot={snapshot} />;
}
