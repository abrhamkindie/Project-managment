'use client';

import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { LogOut, Settings } from 'lucide-react';
import { useLogout } from '~/lib/hooks';
import { fullName } from '~/lib/format';
import { settingsPath } from '~/lib/paths';
import type { Session } from '~/lib/types';
import { Avatar, Menu, MenuItem } from '../ui';
import { ThemeToggle } from '../theme-toggle';

/**
 * Sidebar footer: who you are, and the three things you reach for from the rail —
 * appearance, settings, sign out. The header keeps only the notification bell so
 * the account lives in exactly one place.
 */
export function AccountFooter({
    session,
    collapsed = false,
}: {
    session: Session;
    collapsed?: boolean;
}) {
    const logout = useLogout();
    const router = useRouter();

    const menu = (
        <Menu
            align="right"
            trigger={() => (
                <button
                    type="button"
                    className={clsx(
                        'rounded-full p-0.5',
                        collapsed ? 'mx-auto block' : 'flex items-center gap-2 rounded-full px-1 py-0.5 hover:bg-hover',
                    )}
                    aria-label="Account menu"
                >
                    <Avatar user={session.user} size={collapsed ? 'sm' : 'md'} />
                    {!collapsed ? (
                        <span className="min-w-0 text-left">
                            <span className="block truncate text-sm font-medium text-ink">{fullName(session.user)}</span>
                            <span className="block truncate text-xs text-ink-muted">{session.user.email}</span>
                        </span>
                    ) : null}
                </button>
            )}
        >
            <MenuItem icon={<Settings className="h-4 w-4" />} onSelect={() => router.push(settingsPath())}>
                Settings
            </MenuItem>
            <MenuItem icon={<LogOut className="h-4 w-4" />} tone="danger" onSelect={() => logout.mutate()}>
                Sign out
            </MenuItem>
        </Menu>
    );

    if (collapsed) return <div className="flex justify-center">{menu}</div>;

    return (
        <div className="flex items-center justify-between gap-1 border-t border-line pt-2">
            {menu}
            <ThemeToggle />
        </div>
    );
}
