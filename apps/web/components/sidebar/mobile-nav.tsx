'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { OrganizationSummary, Session } from '~/lib/types';
import { AccountFooter } from './account-footer';
import { NAV_SECTIONS, visibleNavItems, type NavItem } from './nav-config';
import { ProjectShortlist } from './project-shortlist';
import { useUnreadCount } from './use-unread-count';

/**
 * Mobile slide-over navigation.
 *
 * The backdrop is NOT wrapped in `lg:hidden` — that class hid the fixed overlay on desktop
 * viewports by mistake once before; visibility is driven by `open` alone. It closes on
 * backdrop click, ESC, and route change, and reuses the same nav table as the desktop rail.
 */
export function MobileNav({
    open,
    onClose,
    session,
    org,
    onOpenSwitcher,
}: {
    open: boolean;
    onClose: () => void;
    session: Session;
    org: OrganizationSummary;
    onOpenSwitcher: () => void;
}) {
    const pathname = usePathname();
    const unread = useUnreadCount();

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    // Navigating anywhere makes the drawer irrelevant; keep it from covering the new page.
    // `open` is a dependency so the close only fires for navigations while the drawer is up.
    useEffect(() => {
        if (open) onClose();
    }, [pathname, open, onClose]);

    if (!open) return null;

    const isActive = (item: NavItem) => {
        const href = item.href(org.slug);
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex bg-backdrop/50 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
        >
            <nav
                className="flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface p-3"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-2 flex items-center justify-between">
                    <button type="button" onClick={onOpenSwitcher} className="nav-item min-w-0 font-semibold">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-accent text-[11px] font-bold text-[rgb(var(--on-accent))]">
                            {org.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate">{org.name}</span>
                    </button>
                    <button type="button" onClick={onClose} aria-label="Close navigation" className="btn btn-ghost btn-icon">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                    <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                        {NAV_SECTIONS['for-you']}
                    </p>
                    {visibleNavItems
                        .filter((item) => item.section === 'for-you')
                        .map((item) => (
                            <DrawerLink key={item.id} item={item} slug={org.slug} unread={unread} active={isActive(item)} onNavigate={onClose} />
                        ))}

                    <p className="px-2 pt-3 text-[11px] font-bold uppercase tracking-wide text-ink-faint">{NAV_SECTIONS.workspace}</p>
                    {visibleNavItems
                        .filter((item) => item.section === 'workspace')
                        .map((item) => (
                            <DrawerLink key={item.id} item={item} slug={org.slug} unread={unread} active={isActive(item)} onNavigate={onClose} />
                        ))}

                    <div className="pt-2">
                        <ProjectShortlist slug={org.slug} orgId={org.id} activePathname={pathname} />
                    </div>
                </div>

                <AccountFooter session={session} />
            </nav>
        </div>
    );
}

function DrawerLink({
    item,
    slug,
    unread,
    active,
    onNavigate,
}: {
    item: NavItem;
    slug: string;
    unread: number;
    active: boolean;
    onNavigate: () => void;
}) {
    const badge = item.badge === 'inbox' && unread > 0 ? unread : null;
    return (
        <Link
            href={item.href(slug)}
            onClick={onNavigate}
            className={clsx('nav-item', active && 'nav-item-active')}
        >
            <item.icon className="h-4 w-4 shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {badge ? (
                <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{badge > 9 ? '9+' : badge}</span>
            ) : null}
        </Link>
    );
}
