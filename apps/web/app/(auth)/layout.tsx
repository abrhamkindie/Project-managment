import Link from 'next/link';
import type { ReactNode } from 'react';

/** Signed-out screens share this frame: the product on the left, the form on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
            <section className="hidden flex-col justify-between bg-brand-600 px-10 py-12 text-white lg:flex">
                <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 font-bold" aria-hidden>
                        A
                    </span>
                    Atlas
                </Link>
                <div className="max-w-md space-y-4">
                    <h1 className="text-3xl font-semibold leading-tight text-balance">
                        Every task, every owner, every deadline — in one place.
                    </h1>
                    <p className="text-brand-100">
                        Assign work, follow the board, and see whether the project is on track without asking anybody for a status
                        update.
                    </p>
                </div>
                <ul className="grid gap-2 text-sm text-brand-100">
                    <li>Projects with list and board views</li>
                    <li>Multiple assignees, due dates, labels, attachments</li>
                    <li>In-app and email notifications, plus an activity trail</li>
                    <li>Workload, overdue and completion analytics</li>
                </ul>
            </section>

            <section className="flex items-center justify-center px-5 py-12">
                <div className="w-full max-w-sm">{children}</div>
            </section>
        </main>
    );
}
