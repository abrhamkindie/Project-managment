'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCreateTask } from '~/lib/hooks';
import type { CreateTaskBody } from '~/lib/types';
import { Input } from '../ui';

/**
 * Inline task creation.
 *
 * Stays open after a submit so a manager dumping a list of tasks from a meeting does not have to
 * click the row again for each one. `Enter` saves, `Shift+Enter` gives up, `Esc` closes.
 */
export function QuickAdd({ orgId, body, label = 'Add task', onClose }: { orgId: string; body: Omit<CreateTaskBody, 'title'>; label?: string; onClose?: () => void }) {
    const create = useCreateTask(orgId);
    const [title, setTitle] = useState('');
    const [open, setOpen] = useState(!onClose ? true : false);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        create.mutate(
            { ...body, title: trimmed },
            {
                onSuccess: () => {
                    setTitle('');
                },
            },
        );
    };

    const keys = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            setOpen(false);
            onClose?.();
        }
        if (event.key === 'Enter' && event.shiftKey) {
            setOpen(false);
            onClose?.();
        }
    };

    if (!open) {
        return (
            <button type="button" className="nav-item w-full text-ink-muted" onClick={() => setOpen(true)}>
                <span aria-hidden>+</span>
                {label}
            </button>
        );
    }

    return (
        <form onSubmit={submit} className="space-y-1">
            <Input
                autoFocus
                value={title}
                placeholder={label}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={keys}
                aria-label={label}
            />
            {create.isError ? <p className="text-xs text-danger">{create.error instanceof Error ? create.error.message : 'Could not save'}</p> : null}
            {onClose ? (
                <div className="flex items-center justify-end gap-2 pt-1 text-xs text-ink-faint">
                    <span>
                        <span className="kbd">↵</span> to add · <span className="kbd">esc</span> to close
                    </span>
                    <button type="button" className="link" onClick={onClose}>
                        Done
                    </button>
                </div>
            ) : null}
        </form>
    );
}
