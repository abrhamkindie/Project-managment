'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCheck, ChevronLeft, ChevronRight, Inbox, MessageSquare, Tag, UserPlus, X } from 'lucide-react';
import { relativeTime } from '~/lib/format';
import { useDeleteNotification, useMarkNotificationsRead, useNotifications } from '~/lib/hooks';
import type { NotificationDto } from '~/lib/types';
import { Button, EmptyState, ErrorNote, Skeleton, Tabs } from './ui';
import { Page, PageHeader } from './page-shell';

/**
 * The notification inbox.
 *
 * Rows carry a `link` written by the API, which cannot know the workspace slug in this browser's
 * URL — the root-level shim routes turn `/projects/:id` into `/w/<slug>/projects/:id`, so the
 * inbox can navigate to the link exactly as stored.
 */
export function InboxView() {
    const router = useRouter();
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [page, setPage] = useState(1);

    const notifications = useNotifications(unreadOnly, page);
    const markRead = useMarkNotificationsRead();
    const dismiss = useDeleteNotification();

    const open = (notification: NotificationDto) => {
        // Marking read is fire-and-forget: leaving the inbox must not wait on a PATCH.
        if (!notification.readAt) markRead.mutate([notification.id]);
        if (notification.link) router.push(notification.link);
    };

    const items = notifications.data?.items ?? [];
    const pages = notifications.data?.pages ?? 1;

    return (
        <Page>
            <PageHeader
                title="Inbox"
                description={notifications.data?.unread ? `${notifications.data.unread} unread` : 'Assignment, comments, due dates and status changes'}
                actions={
                    <>
                        <Tabs
                            value={unreadOnly ? 'unread' : 'all'}
                            onChange={(next) => {
                                setUnreadOnly(next === 'unread');
                                setPage(1);
                            }}
                            options={[
                                { value: 'all', label: 'All' },
                                { value: 'unread', label: 'Unread', count: notifications.data?.unread },
                            ]}
                        />
                        <Button
                            icon={<CheckCheck className="h-4 w-4" />}
                            loading={markRead.isPending}
                            disabled={notifications.data?.unread === 0}
                            onClick={() => markRead.mutate()}
                        >
                            Mark all read
                        </Button>
                    </>
                }
            />

            <ErrorNote error={notifications.error} />

            {notifications.isLoading ? (
                <ul className="card divide-y divide-line">
                    {Array.from({ length: 5 }, (_, index) => (
                        <li key={index} className="px-4 py-3">
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="mt-2 h-3 w-4/5" />
                        </li>
                    ))}
                </ul>
            ) : items.length === 0 ? (
                <EmptyState
                    icon={<Inbox className="h-8 w-8" />}
                    title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
                    description="When someone assigns you work, comments on a task or closes a due date, it shows up here."
                />
            ) : (
                <ul className="card divide-y divide-line">
                    {items.map((notification) => (
                        <li key={notification.id} className="flex items-start gap-3 px-4 py-3">
                            <span className="mt-0.5 shrink-0 text-ink-faint" aria-hidden>
                                {IconFor(notification.type)}
                            </span>

                            <button type="button" onClick={() => open(notification)} className="min-w-0 flex-1 text-left">
                                <span className="flex items-center gap-2">
                                    {!notification.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-label="Unread" /> : null}
                                    <span className={notification.readAt ? 'truncate text-sm text-ink-muted' : 'truncate text-sm font-medium text-ink'}>
                                        {notification.title}
                                    </span>
                                </span>
                                {notification.body ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{notification.body}</p> : null}
                                <p className="mt-1 text-[11px] text-ink-faint">{relativeTime(notification.createdAt)}</p>
                            </button>

                            <div className="flex shrink-0 items-center gap-1">
                                {!notification.readAt ? (
                                    <Button variant="ghost" size="sm" aria-label="Mark read" loading={markRead.isPending} onClick={() => markRead.mutate([notification.id])}>
                                        <CheckCheck className="h-4 w-4" />
                                    </Button>
                                ) : null}
                                <Button variant="ghost" size="sm" aria-label="Delete notification" onClick={() => dismiss.mutate(notification.id)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {pages > 1 ? (
                <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
                    <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
                        Newer
                    </Button>
                    <span>
                        Page {page} of {pages}
                    </span>
                    <Button size="sm" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} icon={<ChevronRight className="h-4 w-4" />}>
                        Older
                    </Button>
                </div>
            ) : null}
        </Page>
    );
}

/** The type is a stable enum from the API; anything unknown still renders as a plain inbox row. */
function IconFor(type: string) {
    if (type.startsWith('comment')) return <MessageSquare className="h-4 w-4" />;
    if (type.startsWith('member') || type.startsWith('project.member')) return <UserPlus className="h-4 w-4" />;
    if (type.startsWith('task.assigned') || type.startsWith('label')) return <Tag className="h-4 w-4" />;
    return <Inbox className="h-4 w-4" />;
}
