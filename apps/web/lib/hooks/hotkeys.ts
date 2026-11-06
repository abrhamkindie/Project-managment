'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts.
 *
 * One tiny matcher instead of a dependency: bindings are written the way users read them —
 * `"mod+k"` for the chord, `"/"` for a bare key, `"g b"` for a two-key sequence (press `g`, then
 * `b`, within a short window). Sequences make navigation memorable without eating single keys,
 * and single keys stay inert while the user is typing in a field.
 *
 * Handlers are read from a ref, so binding a closure over fresh state never re-registers the
 * window listener — the listener is installed once per `enabled` flip.
 */

export type HotkeyBindings = Record<string, (event: KeyboardEvent) => void>;

/** How long a `g`-style prefix stays armed waiting for its second key. */
const SEQUENCE_WINDOW = 900;

/** True when the key press belongs to a text field, a select or a contenteditable region. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/** `⌘`/`Ctrl` share one token so a mac and a linux keyboard can bind the same chord. */
function tokenFor(event: KeyboardEvent): string {
    const key = event.key.toLowerCase();
    return event.metaKey || event.ctrlKey ? `mod+${key}` : key;
}

export function useHotkeys(bindings: HotkeyBindings, options: { enabled?: boolean } = {}): void {
    const { enabled = true } = options;
    const latest = useRef(bindings);
    latest.current = bindings;
    const prefix = useRef<{ tokens: string; expiresAt: number } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.repeat || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            const table = latest.current;
            const token = tokenFor(event);
            // A chord never continues a pending sequence.
            const armed = prefix.current && prefix.current.expiresAt > Date.now() ? prefix.current.tokens : '';
            prefix.current = null;
            const candidate = armed ? `${armed} ${token}` : token;

            // A prefix only counts if some binding goes deeper with it.
            const isPrefix = Object.keys(table).some((sequence) => sequence.startsWith(`${candidate} `));
            if (isPrefix) {
                prefix.current = { tokens: candidate, expiresAt: Date.now() + SEQUENCE_WINDOW };
                return;
            }

            const handler = table[candidate];
            if (!handler) return;
            event.preventDefault();
            handler(event);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled]);
}
