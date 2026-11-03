'use client';

import { useRouter } from 'next/navigation';
import { Bell, Check, Loader2, MailOpen } from 'lucide-react';
import { useNotifications, useMarkNotificationsRead } from '~/lib/hooks';
import { inboxPath } from '~/lib/paths';
import { relativeTime } from '~/lib/format';
import type { NotificationDto } from '~/lib/types';
import { Menu, MenuItem, Spinner } from './ui';

/**
 * Notification bell.
 *
 * The list is a normal cached query, and the unread badge comes from the same response, so the
 * socket event for a new notification only has to invalidate one key for the badge, the list and
 * the inbox page to all agree.
 */
export function NotificationBell({ slug }: { slug: string }) {
    const router = useRouter();
    const notifications = useNotifications(false);
    const markRead = useMarkNotificationsRead();
    const items = notifications.data?.items.slice(0, 8) ?? [];
    const unread = notifications.data?.unread ?? 0;

    const open = (notification: NotificationDto) => {
        markRead.mutate([notification.id]);
        // API-authored links are workspace-relative shims (`/projects/…`, `/my-tasks`) that resolve
        // the right workspace on the server, so they are safe to push as they come.
        if (notification.link) router.push(notification.link);
    };

    return (
        <Menu
            align="right"
            trigger={(openState) => (
                <button
                    type="button"
                    aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
                    className={`btn btn-ghost btn-icon relative ${openState ? 'bg-gray-100 text-ink' : ''}`}
                >
                    <Bell className="h-5 w-5" />
                    {unread > 0 ? (
                        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    ) : null}
                </button>
            )}
        >
            <div className="w-[340px] max-w-[85vw]">
                <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Notifications</span>
                    {unread > 0 ? (
                        <button type="button" className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700" onClick={() => markRead.mutate(undefined)}>
                            <MailOpen className="h-3.5 w-3.5" />
                            Mark all read
                        </button>
                    ) : null}
                </div>

                {notifications.isPending ? (
                    <div className="px-3 py-4">
                        <Spinner label="Loading…" />
                    </div>
                ) : items.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-ink-muted">Nothing yet. Assignments and comments land here.</p>
                ) : (
                    <ul className="max-h-[60vh] overflow-y-auto">
                        {items.map((notification) => (
                            <li key={notification.id}>
                                <button
                                    type="button"
                                    onClick={() => open(notification)}
                                    className="flex w-full gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-gray-100"
                                >
                                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-transparent' : 'bg-brand-500'}`} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-ink">{notification.title}</span>
                                        <span className="block text-xs text-ink-muted">{notification.body}</span>
                                        <span className="mt-0.5 block text-[11px] text-ink-faint">{relativeTime(notification.createdAt)}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="border-t border-line p-1">
                    <MenuItem icon={<Check className="h-4 w-4" />} onSelect={() => router.push(inboxPath(slug))}>
                        Open inbox
                    </MenuItem>
                </div>
                {markRead.isPending ? (
                    <div className="flex items-center gap-1 px-2 pb-1 text-[11px] text-ink-faint">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        marking read
                    </div>
                ) : null}
            </div>
        </Menu>
    );
}
