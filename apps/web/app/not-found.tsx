import Link from 'next/link';

/** One 404 screen for the whole app, including links that no longer resolve. */
export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center px-6">
            <div className="max-w-sm space-y-3 text-center">
                <p className="text-sm font-semibold text-brand-600">404</p>
                <h1 className="text-2xl font-semibold text-ink">We cannot find that page</h1>
                <p className="text-sm text-ink-muted">
                    The project may have been deleted, or the link may point to a workspace you are not a member of.
                </p>
                <Link href="/" className="btn btn-primary">
                    Back to my workspace
                </Link>
            </div>
        </main>
    );
}
