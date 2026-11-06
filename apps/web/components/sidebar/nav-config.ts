import type { LucideIcon } from 'lucide-react';
import {
    BarChart3,
    CalendarDays,
    FolderOpen,
    Inbox,
    LayoutDashboard,
    ListChecks,
    Settings,
    Users,
} from 'lucide-react';
import {
    calendarPath,
    inboxPath,
    membersPath,
    myTasksPath,
    projectsPath,
    settingsPath,
    workspacePath,
} from '~/lib/paths';

/**
 * The single navigation table for the workspace chrome.
 *
 * Sidebar, mobile drawer, breadcrumbs and the ⌘K page list all read this array, so a new
 * view (calendar, cycles, insights…) is one entry here plus its route — nothing searches
 * for "where is the nav defined".
 */

export interface NavItem {
    /** Stable id used for pins/badges; also the breadcrumb key. */
    id: string;
    label: string;
    icon: LucideIcon;
    /** Build the URL for a workspace slug. */
    href: (slug: string) => string;
    section: 'for-you' | 'workspace';
    /** Which live badge to render, if any. */
    badge?: 'inbox';
    /** Hidden until its phase ships the route (see `visibleNavItems`). */
    pending?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: (slug) => workspacePath(slug, 'dashboard'), section: 'for-you' },
    { id: 'my-tasks', label: 'My work', icon: ListChecks, href: (slug) => myTasksPath(slug), section: 'for-you' },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, href: (slug) => calendarPath(slug), section: 'for-you' },
    { id: 'inbox', label: 'Inbox', icon: Inbox, href: (slug) => inboxPath(slug), section: 'for-you', badge: 'inbox' },
    { id: 'projects', label: 'Projects', icon: FolderOpen, href: (slug) => projectsPath(slug), section: 'workspace' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, href: (slug) => workspacePath(slug, 'analytics'), section: 'workspace', pending: true },
    { id: 'members', label: 'Members', icon: Users, href: (slug) => membersPath(slug), section: 'workspace' },
    // Settings lives outside `/w/<slug>` (account-level, org-independent), so it ignores the slug.
    { id: 'settings', label: 'Settings', icon: Settings, href: () => settingsPath(), section: 'workspace' },
];

/** What the sidebar/drawer/palette render — shipped entries only. */
export const visibleNavItems = NAV_ITEMS.filter((item) => !item.pending);

/** Section headers shown above each nav group (expanded sidebar only). */
export const NAV_SECTIONS: Record<NavItem['section'], string> = {
    'for-you': 'For you',
    workspace: 'Workspace',
};

/** Breadcrumb label lookup falls back to the nav table — one place names every route. */
export function navLabelForSection(section: string): string | undefined {
    return NAV_ITEMS.find((item) => item.id === section)?.label;
}
