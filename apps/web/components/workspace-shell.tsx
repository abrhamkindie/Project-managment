'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
    Check,
    ChevronsUpDown,
    FolderOpen,
    Inbox,
    LayoutDashboard,
    ListChecks,
    LogOut,
    Menu as MenuIcon,
    Plus,
    Settings,
    Users,
    Wifi,
    WifiOff,
} from 'lucide-react';
import { useLogout, useProjects } from '~/lib/hooks';
import { inboxPath, membersPath, myTasksPath, projectPath, projectsPath, settingsPath, workspacePath } from '~/lib/paths';
import { useRealtime } from '~/lib/realtime';
import type { OrganizationSummary, Session } from '~/lib/types';
import { CreateWorkspaceForm } from './create-workspace';
import { NotificationBell } from './notification-bell';
import { Avatar, Menu, MenuItem, Modal } from './ui';

/**
 * The workspace chrome: switcher, navigation, account menu, and the socket connection.
 *
 * Everything inside is cache-driven — the shell never blocks a page, and a slow `/members`
 * response does not stop the sidebar from rendering. The session arrives from the server
 * component above so the first paint already knows who this is.
 */
export function WorkspaceShell({ session, org, children }: { session: Session; org: OrganizationSummary; children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const realtime = useRealtime();
    const logout = useLogout();
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [mobileNav, setMobileNav] = useState(false);

    const links = [
        { href: workspacePath(org.slug, 'dashboard'), label: 'Dashboard', icon: LayoutDashboard },
        { href: myTasksPath(org.slug), label: 'My Tasks', icon: ListChecks },
        { href: projectsPath(org.slug), label: 'Projects', icon: FolderOpen },
        { href: membersPath(org.slug), label: 'Members', icon: Users },
        { href: inboxPath(org.slug), label: 'Inbox', icon: Inbox },
    ];

    const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

    return (
        <div className="flex min-h-screen">
            <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface px-3 py-4 lg:flex">
                <WorkspaceSwitcher org={org} onOpenSwitcher={() => setSwitcherOpen(true)} />

                <nav className="flex flex-col gap-0.5">
                    {links.map((link) => (
                        <Link key={link.href} href={link.href} className={clsx('nav-item', isActive(link.href) && 'nav-item-active')}>
                            <link.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                            {link.label}
                        </Link>
                    ))}
                </nav>

                <ProjectShortlist slug={org.slug} orgId={org.id} activePathname={pathname} />

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-faint">
                    <span
                        title={realtime.status === 'live' ? 'Live updates connected' : 'Live updates not connected'}
                        className="inline-flex items-center gap-1.5"
                    >
                        {realtime.status === 'offline' ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className={clsx('h-3.5 w-3.5', realtime.status === 'live' && 'text-state-done')} />}
                        {realtime.status === 'live' ? 'Live' : realtime.status === 'connecting' ? 'Connecting' : 'Offline'}
                    </span>
                    <button type="button" className="link" onClick={() => logout.mutate()}>
                        Sign out
                    </button>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur">
                    <div className="flex min-w-0 items-center gap-2">
                        <button type="button" className="btn btn-ghost btn-icon lg:hidden" aria-label="Open navigation" onClick={() => setMobileNav((value) => !value)}>
                            <MenuIcon className="h-5 w-5" />
                        </button>
                        <span className="truncate text-sm font-medium lg:hidden">{org.name}</span>
                    </div>
                    <Header session={session} slug={org.slug} />
                </header>

                {/* `min-h-0` lets a board fill exactly the remaining height and scroll its own columns. */}
                <main className="min-h-0 min-w-0 flex-1">{children}</main>
            </div>

            {mobileNav ? (
                <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMobileNav(false)}>
                    <nav className="h-full w-64 space-y-1 bg-surface p-3" onClick={(event) => event.stopPropagation()}>
                        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{org.name}</p>
                        {links.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileNav(false)}
                                className={clsx('nav-item', isActive(link.href) && 'nav-item-active')}
                            >
                                <link.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                                {link.label}
                            </Link>
                        ))}
                        <button type="button" className="nav-item w-full text-left" onClick={() => logout.mutate()}>
                            <LogOut className="h-4 w-4 shrink-0 text-ink-faint" />
                            Sign out
                        </button>
                    </nav>
                </div>
            ) : null}

            {switcherOpen ? (
                <Modal title="Switch workspace" onClose={() => setSwitcherOpen(false)}>
                    <ul className="space-y-1">
                        {session.organizations.map((candidate) => (
                            <li key={candidate.id}>
                                <button
                                    type="button"
                                    className="nav-item w-full justify-between"
                                    onClick={() => {
                                        setSwitcherOpen(false);
                                        router.push(workspacePath(candidate.slug, 'dashboard'));
                                    }}
                                >
                                    <span className="truncate">{candidate.name}</span>
                                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                                        {candidate.role}
                                        {candidate.id === org.id ? <Check className="h-4 w-4 text-brand-600" /> : null}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-4 border-t border-line pt-4">
                        <button
                            type="button"
                            className="nav-item w-full"
                            onClick={() => {
                                setSwitcherOpen(false);
                                setCreateOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4 shrink-0" />
                            Create workspace
                        </button>
                    </div>
                </Modal>
            ) : null}

            {createOpen ? (
                <Modal title="Create workspace" description="A new workspace starts empty, with you as its admin." onClose={() => setCreateOpen(false)}>
                    <CreateWorkspaceForm onDone={(slug) => router.push(workspacePath(slug, 'projects'))} />
                </Modal>
            ) : null}
        </div>
    );
}

/** The bell and the account menu, shown in the desktop corner and in the mobile bar. */
function Header({ session, slug }: { session: Session; slug: string }) {
    const router = useRouter();
    const logout = useLogout();
    return (
        <div className="flex items-center gap-1">
            <NotificationBell slug={slug} />
            <Menu
                align="right"
                trigger={() => (
                    <button type="button" className="rounded-full" aria-label="Account menu">
                        <Avatar user={session.user} />
                    </button>
                )}
            >
                <p className="px-2.5 py-1.5 text-xs text-ink-muted">{session.user.email}</p>
                <MenuItem icon={<Settings className="h-4 w-4" />} onSelect={() => router.push(settingsPath())}>
                    Settings
                </MenuItem>
                <MenuItem
                    icon={<LogOut className="h-4 w-4" />}
                    tone="danger"
                    onSelect={() => logout.mutate()}
                >
                    Sign out
                </MenuItem>
            </Menu>
        </div>
    );
}

function WorkspaceSwitcher({ org, onOpenSwitcher }: { org: OrganizationSummary; onOpenSwitcher: () => void }) {
    return (
        <button type="button" onClick={onOpenSwitcher} className="nav-item w-full justify-between font-medium">
            <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[11px] font-bold text-white">
                    {org.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{org.name}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
    );
}

/**
 * A short list of active projects under the nav. It is the same cached query the projects page
 * uses, so opening a project from here does not refetch anything.
 */
function ProjectShortlist({ slug, orgId, activePathname }: { slug: string; orgId: string; activePathname: string }) {
    const projects = useProjects(orgId, { status: 'active', pageSize: 8 });
    const items = projects.data?.items ?? [];

    return (
        <div className="space-y-0.5">
            <p className="px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Projects</p>
            {projects.isPending ? (
                <>
                    <div className="skeleton h-7" />
                    <div className="skeleton h-7" />
                </>
            ) : (
                items.map((project) => (
                    <Link
                        key={project.id}
                        href={projectPath(slug, project.id)}
                        className={clsx('nav-item', activePathname.startsWith(projectPath(slug, project.id)) && 'nav-item-active')}
                    >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
                        <span className="truncate">{project.name}</span>
                    </Link>
                ))
            )}
            {items.length === 0 ? <p className="px-2.5 py-1 text-xs text-ink-faint">No projects yet.</p> : null}
            <Link href={projectsPath(slug)} className="nav-item text-ink-muted">
                <FolderOpen className="h-4 w-4 shrink-0" />
                View all projects
            </Link>
        </div>
    );
}
