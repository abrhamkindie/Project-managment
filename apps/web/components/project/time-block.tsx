'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Clock, Play, Plus, Square, Trash2 } from 'lucide-react';
import { formatMins, formatStopwatch, toDateInput } from '~/lib/format';
import { useAddTimeEntry, useDeleteTimeEntry, useStartTimer, useStopTimer, useTaskTime } from '~/lib/hooks';
import type { TaskDetailDto } from '~/lib/types';
import { Button } from '../ui';

/**
 * Timer and logged-time panel.
 *
 * The server row owns the truth: a running entry has no duration until it stops, so the ticking figure
 * here is a local read of `startedAt` that is replaced by the frozen `durationMins` on the next fetch.
 * Manual entries cover work done away from the app.
 *
 * Starting a timer needs only the ability to see the task — recording hours you already worked is
 * exactly what an archived project still allows — so nothing here is gated on `canEdit`. Deleting
 * someone else's entry is a manager call: the button is always drawn and the API says no.
 */
export function TimeBlock({ task }: { task: TaskDetailDto }) {
    const time = useTaskTime(task.id);
    const start = useStartTimer(task.id, task.projectId);
    const stop = useStopTimer(task.id, task.projectId);
    const addEntry = useAddTimeEntry(task.id, task.projectId);
    const remove = useDeleteTimeEntry(task.id, task.projectId);
    const [now, setNow] = useState(() => Date.now());
    const [formOpen, setFormOpen] = useState(false);

    const running = time.data?.running ?? null;
    const runningId = running?.id ?? null;

    // Only tick while something is actually running; an idle drawer should not re-render every second.
    useEffect(() => {
        if (!runningId) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [runningId]);

    const summary = time.data?.summary;
    const elapsedMs = running ? now - Date.parse(running.startedAt) : 0;
    const busy = start.isPending || stop.isPending;
    const entries = time.data?.entries ?? [];

    return (
        <section className="mb-6">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Clock className="h-4 w-4 text-ink-faint" />
                    Time
                </h3>
                <span className="text-xs text-ink-muted">
                    {formatMins(summary?.totalMins ?? 0)} logged
                    {summary?.estimateMins ? (
                        <span
                            className={clsx('ml-1', (summary.overEstimateMins ?? 0) > 0 ? 'text-danger' : 'text-ink-faint')}
                        >
                            of {formatMins(summary.estimateMins)}
                        </span>
                    ) : null}
                </span>
            </div>

            <div className="flex items-center gap-2">
                {running ? (
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => stop.mutate()}
                        disabled={busy}
                        icon={<Square className="h-3.5 w-3.5" />}
                    >
                        <span className="tabular-nums">{formatStopwatch(elapsedMs)}</span>
                    </Button>
                ) : (
                    <Button size="sm" variant="secondary" onClick={() => start.mutate()} disabled={busy} icon={<Play className="h-3.5 w-3.5" />}>
                        Start timer
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setFormOpen((open) => !open)} icon={<Plus className="h-3.5 w-3.5" />}>
                    Log time
                </Button>
            </div>

            {formOpen ? (
                <ManualEntry
                    defaultDay={toDateInput(new Date().toISOString())}
                    busy={addEntry.isPending}
                    onSubmit={(values) => addEntry.mutate(values, { onSuccess: () => setFormOpen(false) })}
                    onCancel={() => setFormOpen(false)}
                />
            ) : null}

            {summary && summary.byUser.length > 1 ? (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                    {summary.byUser.map((row) => (
                        <li key={row.user.id}>
                            {row.user.firstName} {row.user.lastName} · {formatMins(row.mins)}
                        </li>
                    ))}
                </ul>
            ) : null}

            {entries.length > 0 ? (
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                    {entries.map((entry) => (
                        <li
                            key={entry.id}
                            className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-ink">
                                    {entry.description || `${entry.user.firstName} ${entry.user.lastName}`}
                                </span>
                                <span className="text-[11px] text-ink-faint">{new Date(entry.startedAt).toLocaleString()}</span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                                {entry.running ? <span className="text-brand-700">running</span> : formatMins(entry.durationMins)}
                            </span>
                            <button
                                type="button"
                                onClick={() => remove.mutate(entry.id)}
                                disabled={remove.isPending}
                                aria-label="Delete time entry"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}

/** Backfill form: a day, the minutes spent, and an optional note. */
function ManualEntry({
    defaultDay,
    busy,
    onSubmit,
    onCancel,
}: {
    defaultDay: string;
    busy: boolean;
    onSubmit: (values: { startedAt: string; durationMins: number; description?: string }) => void;
    onCancel: () => void;
}) {
    const [day, setDay] = useState(defaultDay);
    const [mins, setMins] = useState('30');
    const [note, setNote] = useState('');
    const amount = Math.max(1, Math.min(43_200, Number(mins) || 0));

    return (
        <form
            className="mt-3 space-y-2 rounded-lg bg-canvas p-2"
            onSubmit={(event) => {
                event.preventDefault();
                const picked = new Date(`${day}T12:00:00`);
                // Never hand the API a start in the future: it rejects those, and midday today is
                // already past for most of the working day.
                const startedAt = new Date(Math.min(picked.getTime(), Date.now())).toISOString();
                onSubmit({ startedAt, durationMins: amount, description: note.trim() || undefined });
            }}
        >
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="date"
                    aria-label="Entry date"
                    value={day}
                    max={defaultDay}
                    onChange={(event) => setDay(event.target.value)}
                    className="rounded border border-line bg-surface px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
                />
                <input
                    type="number"
                    aria-label="Minutes spent"
                    min={1}
                    max={43_200}
                    value={mins}
                    onChange={(event) => setMins(event.target.value)}
                    className="w-20 rounded border border-line bg-surface px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
                />
                <span className="text-xs text-ink-faint">min</span>
                <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What did you work on?"
                    className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
                />
            </div>
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" disabled={busy}>
                    Save entry
                </Button>
            </div>
        </form>
    );
}
