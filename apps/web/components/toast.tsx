'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import clsx from 'clsx';

/**
 * Toasts.
 *
 * Mutations across the app report through one channel: a saved task should confirm itself the
 * same way a failed invite warns. Kept in a context so any client component can push one
 * without importing a store singleton (which would break server rendering).
 */

export interface Toast {
    id: number;
    tone: 'success' | 'error' | 'info';
    message: string;
    /** Optional action, e.g. "Undo" or "Open" for a notification. */
    action?: { label: string; onClick: () => void };
}

interface ToastApi {
    push: (toast: Omit<Toast, 'id'>) => void;
    success: (message: string, action?: Toast['action']) => void;
    error: (message: string, action?: Toast['action']) => void;
    info: (message: string, action?: Toast['action']) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TIMEOUT_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const sequence = useRef(0);

    const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

    const push = useCallback(
        (toast: Omit<Toast, 'id'>) => {
            sequence.current += 1;
            const id = sequence.current;
            setToasts((current) => [...current.slice(-4), { ...toast, id }]);
            // Errors stay until dismissed: they usually need an action.
            if (toast.tone !== 'error') setTimeout(() => dismiss(id), TIMEOUT_MS);
        },
        [dismiss],
    );

    const api = useMemo<ToastApi>(
        () => ({
            push,
            success: (message, action) => push({ tone: 'success', message, action }),
            error: (message, action) => push({ tone: 'error', message, action }),
            info: (message, action) => push({ tone: 'info', message, action }),
        }),
        [push],
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={clsx(
                            'pointer-events-auto card animate-drawer flex items-start gap-2 bg-surface px-3 py-2.5 text-sm',
                            toast.tone === 'error' ? 'border-red-200' : toast.tone === 'success' ? 'border-green-200' : 'border-line',
                        )}
                    >
                        {toast.tone === 'error' ? (
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                        ) : toast.tone === 'success' ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-done" />
                        ) : (
                            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                        )}
                        <span className="flex-1 text-ink-soft">{toast.message}</span>
                        {toast.action ? (
                            <button type="button" onClick={() => { toast.action?.onClick(); dismiss(toast.id); }} className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700">
                                {toast.action.label}
                            </button>
                        ) : null}
                        <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="shrink-0 text-ink-faint hover:text-ink">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used inside <ToastProvider>');
    return context;
}
