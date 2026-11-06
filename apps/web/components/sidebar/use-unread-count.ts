'use client';

import { useNotifications } from '~/lib/hooks';

/**
 * Unread-notification count, shared by the bell and the sidebar Inbox badge.
 *
 * Both surfaces read the same cached query (`unreadOnly=false`, default page), so one fetch
 * feeds the badge in the header and the one in the drawer — a new notification invalidates
 * the key and both update together.
 */
export function useUnreadCount(): number {
    return useNotifications(false).data?.unread ?? 0;
}
