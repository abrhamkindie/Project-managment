'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Repeat } from 'lucide-react';
import { useUpdateTask } from '~/lib/hooks';
import type { RecurrenceRule, TaskDetailDto } from '~/lib/types';

const FREQS: { value: string; label: string }[] = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];

// ISO weekday chips, Monday first (1 = Mon … 7 = Sun).
const WEEKDAYS: { iso: number; short: string }[] = [
    { iso: 1, short: 'M' },
    { iso: 2, short: 'T' },
    { iso: 3, short: 'W' },
    { iso: 4, short: 'T' },
    { iso: 5, short: 'F' },
    { iso: 6, short: 'S' },
    { iso: 7, short: 'S' },
];

/** Icon + label on the left, editable value on the right — mirrors the drawer's property rows. */
function Row({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex items-start gap-3 py-1.5">
            <div className="flex w-32 shrink-0 items-center gap-2 pt-1 text-sm text-ink-muted">
                <span className="text-ink-faint">{icon}</span>
                <span>{label}</span>
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
                {children}
                {hint ? <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p> : null}
            </div>
        </div>
    );
}

/**
 * Recurrence editor for a single task.
 *
 * Writes a `RecurrenceRule` through the same optimistic task-patch path as the rest of the
 * drawer; the hourly server sweep does the actual cloning. Choosing "weekly" reveals weekday
 * chips so a standup can pin to Mon/Wed/Fri; daily & monthly only need the interval.
 */
export function RecurrenceRow({ task, canEdit }: { task: TaskDetailDto; canEdit: boolean }) {
    const update = useUpdateTask();
    const [intervalDraft, setIntervalDraft] = useState(String(task.recurrence?.interval ?? 1));

    const freq = task.recurrence?.freq ?? 'none';
    const save = (patch: Partial<RecurrenceRule> | null) => {
        const next: RecurrenceRule | null = patch === null ? null : { freq: 'daily', interval: 1, ...task.recurrence, ...patch };
        update.mutate({ taskId: task.id, patch: { recurrence: next } });
    };

    const toggleDay = (iso: number) => {
        const current = task.recurrence?.byDays ?? [];
        const next = current.includes(iso) ? current.filter((d) => d !== iso) : [...current, iso].sort((a, b) => a - b);
        save({ byDays: next });
    };

    return (
        <Row icon={<Repeat className="h-4 w-4" />} label="Repeat">
            <div className="flex flex-wrap items-center gap-2">
                <select
                    aria-label="Repeat frequency"
                    disabled={!canEdit}
                    value={freq}
                    onChange={(event) => {
                        const value = event.target.value;
                        if (value === 'none') save(null);
                        else save({ freq: value as RecurrenceRule['freq'], interval: Number(intervalDraft) || 1 });
                    }}
                    className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-ink hover:border-line focus:border-brand-500 focus:outline-none disabled:opacity-60"
                >
                    {FREQS.map((f) => (
                        <option key={f.value} value={f.value}>
                            {f.label}
                        </option>
                    ))}
                </select>

                {freq !== 'none' ? (
                    <div className="inline-flex items-center gap-1 text-sm text-ink-muted">
                        <span>every</span>
                        <input
                            type="number"
                            min={1}
                            max={365}
                            disabled={!canEdit}
                            value={intervalDraft}
                            aria-label="Repeat interval"
                            onChange={(event) => {
                                const raw = event.target.value;
                                setIntervalDraft(raw);
                                const n = Math.max(1, Math.min(365, Number(raw) || 1));
                                save({ interval: n });
                            }}
                            className="w-14 rounded border border-line bg-surface px-1 py-0.5 text-sm focus:border-brand-500 focus:outline-none"
                        />
                        <span className="capitalize">{freq === 'daily' ? 'days' : freq}</span>
                    </div>
                ) : null}
            </div>

            {freq === 'weekly' && canEdit ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {WEEKDAYS.map((day) => {
                        const on = (task.recurrence?.byDays ?? []).includes(day.iso);
                        return (
                            <button
                                key={day.iso}
                                type="button"
                                onClick={() => toggleDay(day.iso)}
                                aria-pressed={on}
                                className={clsx(
                                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition',
                                    on ? 'bg-brand-500 text-white' : 'bg-canvas text-ink-muted hover:bg-hover',
                                )}
                            >
                                {day.short}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </Row>
    );
}
