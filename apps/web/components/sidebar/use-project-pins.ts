'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Client-side project pins: the sidebar shortlist shows pinned projects first.
 *
 * Deliberately localStorage-only in this phase — a server-side `pinned` column would put
 * personal preferences behind a schema change for no current benefit. The storage key is
 * per-workspace so pinning in one org never affects another.
 */

const keyFor = (orgId: string) => `zorqen-pinned-projects:${orgId}`;

export function useProjectPins(orgId: string) {
    const [pinned, setPinned] = useState<string[]>([]);

    // Read after mount only: `localStorage` does not exist during SSR, and guessing an
    // empty array here would risk a hydration mismatch on the first paint.
    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(keyFor(orgId));
            setPinned(raw ? (JSON.parse(raw) as string[]) : []);
        } catch {
            setPinned([]);
        }
    }, [orgId]);

    const toggle = useCallback(
        (projectId: string) => {
            setPinned((current) => {
                const next = current.includes(projectId)
                    ? current.filter((id) => id !== projectId)
                    : [...current, projectId];
                try {
                    window.localStorage.setItem(keyFor(orgId), JSON.stringify(next));
                } catch {
                    /* private mode: pins just do not survive the tab */
                }
                return next;
            });
        },
        [orgId],
    );

    return { pinned, toggle, isPinned: (projectId: string) => pinned.includes(projectId) };
}
