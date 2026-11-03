'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import clsx from 'clsx';

/**
 * Page scaffolding.
 *
 * One header shape for every screen keeps titles, descriptions and primary actions in the same
 * place, which is what makes a new page feel familiar instead of newly designed.
 */

export function Page({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
    return <div className={clsx('mx-auto w-full px-4 py-5 sm:px-6', wide ? 'max-w-none' : 'max-w-6xl', className)}>{children}</div>;
}

export function PageHeader({
    title,
    description,
    actions,
    back,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    back?: { href: string; label: string };
}) {
    return (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                {back ? (
                    <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
                        <ChevronLeft className="h-3.5 w-3.5" />
                        {back.label}
                    </Link>
                ) : null}
                <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">{title}</h1>
                {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
    );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={clsx('space-y-3', className)}>
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}
