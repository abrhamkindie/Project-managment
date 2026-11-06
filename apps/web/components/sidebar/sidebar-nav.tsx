'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { ChevronsUpDown, FolderOpen, PanelLeftClose, PanelLeftOpen, Wifi, WifiOff } from 'lucide-react';
import { usePeople, usePresence } from '~/lib/hooks';
import { projectsPath } from '~/lib/paths';
import { useRealtime } from '~/lib/realtime';
import type { OrganizationSummary, Session } from '~/lib/types';
import { AvatarStack } from '../ui';
import { AccountFooter } from './account-footer';
import { NAV_SECTIONS, visibleNavItems, type NavItem } from './nav-config';
import { ProjectShortlist } from './project-shortlist';
import { useUnreadCount } from './use-unread-count';

/**
 * The collapsible workspace rail.
 *
 * Width is persisted by the shell (`Cmd/Ctrl+[` toggles it), nav entries come from the one
 * NAV_ITEMS table, and later-phase views (analytics, calendar, cycles) appear here without
 * touching this file. Collapsed mode keeps icons only, so every affordance needs a title.
 */
export function SidebarNav({
    session,
    org,
    pathname,
    collapsed,
    onToggleCollapsed,
    onOpenSwitcher,
}: {
    session: Session;
    org: OrganizationSummary;
    pathname: string;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onOpenSwitcher: () => void;
}) {
    const realtime = useRealtime();
    const unread = useUnreadCount();
    const presence = usePresence(org.id);
    const people = usePeople(org.id);

    const isActive = (item: NavItem) => {
        const href = item.href(org.slug);
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    return (
        <aside
            className={clsx(
                'sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 lg:flex',
                collapsed ? 'w-14 px-1.5 py-3' : 'w-60 px-2.5 py-3',
            )}
        >
            {/* Workspace switcher header */}
            <button
                type="button"
                onClick={onOpenSwitcher}
                title={org.name}
                className={clsx(
                    'mb-3 flex items-center gap-2 rounded-[3px] px-1.5 py-1 text-sm font-semibold text-ink hover:bg-hover',
                    collapsed && 'justify-center px-0',
                )}
            >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-accent text-[11px] font-bold text-[rgb(var(--on-accent))]">
                    {org.name.slice(0, 1).toUpperCase()}
                </span>
                {!collapsed ? (
                    <>
                        <span className="min-w-0 truncate">{org.name}</span>
                        <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    </>
                ) : null}
            </button>

            <p className={clsx('mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint', collapsed && 'sr-only')}>
                {NAV_SECTIONS['for-you']}
            </p>
            <nav className="flex flex-col gap-0.5">
                {visibleNavItems
                    .filter((item) => item.section === 'for-you')
                    .map((item) => (
                        <NavLink key={item.id} item={item} slug={org.slug} unread={unread} collapsed={collapsed} active={isActive(item)} />
                    ))}
            </nav>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                {collapsed ? (
                    <div className="flex justify-center">
                        <Link href={projectsPath(org.slug)} className="btn btn-ghost btn-icon" title="Projects" aria-label="Projects">
                            <FolderOpen className="h-4 w-4" />
                        </Link>
                    </div>
                ) : (
                    <>
                        <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                            {NAV_SECTIONS.workspace}
                        </p>
                        <nav className="mb-3 flex flex-col gap-0.5">
                            {visibleNavItems
                                .filter((item) => item.section === 'workspace')
                                .map((item) => (
                                    <NavLink key={item.id} item={item} slug={org.slug} unread={unread} collapsed={collapsed} active={isActive(item)} />
                                ))}
                        </nav>
                        <ProjectShortlist slug={org.slug} orgId={org.id} activePathname={pathname} />
                        {presence.active.length > 0 && people.data ? (
                            <div className="mt-4 flex items-center gap-2 border-t border-line px-2 pt-3">
                                <span className="h-2 w-2 shrink-0 rounded-full bg-state-done" aria-hidden />
                                <AvatarStack
                                    users={presence.active
                                        .map((row) => people.people.find((user) => user.id === row.userId))
                                        .filter((user) => user !== undefined)}
                                    max={5}
                                />
                                <span className="ml-auto whitespace-nowrap text-[11px] text-ink-faint">
                                    {presence.activeCount} online
                                </span>
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            {/* Live-status + collapse handle + account footer */}
            <div className="mt-auto space-y-2 pt-3">
                <div
                    className={clsx(
                        'border-t border-line pt-2 text-xs text-ink-faint',
                        collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center justify-between gap-2 px-1',
                    )}
                >
                    <span
                        title={realtime.status === 'live' ? 'Live updates connected' : 'Live updates not connected'}
                        className={clsx('inline-flex items-center gap-1.5', collapsed && 'flex-col gap-0')}
                    >
                        {realtime.status === 'offline' ? (
                            <WifiOff className="h-3.5 w-3.5" />
                        ) : (
                            <Wifi className={clsx('h-3.5 w-3.5', realtime.status === 'live' && 'text-state-done')} />
                        )}
                        {!collapsed ? (realtime.status === 'live' ? 'Live' : realtime.status === 'connecting' ? 'Connecting' : 'Offline') : null}
                    </span>
                    <button
                        type="button"
                        onClick={onToggleCollapsed}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        title={collapsed ? 'Expand sidebar (Ctrl+[)' : 'Collapse sidebar (Ctrl+[)'}
                        className="btn btn-ghost btn-icon hidden h-6 w-6 self-center lg:inline-flex"
                    >
                        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    </button>
                </div>

                <AccountFooter session={session} collapsed={collapsed} />
            </div>
        </aside>
    );
}

function NavLink({
    item,
    slug,
    unread,
    collapsed,
    active,
}: {
    item: NavItem;
    slug: string;
    unread: number;
    collapsed: boolean;
    active: boolean;
}) {
    const badge = item.badge === 'inbox' && unread > 0 ? unread : null;
    return (
        <Link
            href={item.href(slug)}
            title={item.label}
            className={clsx('nav-item', collapsed && 'justify-center px-0', active && 'nav-item-active')}
        >
            <span className="relative flex shrink-0 items-center">
                <item.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                {badge && collapsed ? (
                    <span className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
                ) : null}
            </span>
            {!collapsed ? (
                <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badge ? (
                        <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{badge > 9 ? '9+' : badge}</span>
                    ) : null}
                </>
            ) : null}
        </Link>
    );
}
