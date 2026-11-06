'use client';

import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { dayKeyOf } from '~/lib/format';
import type { TaskCardDto } from '~/lib/types';

const DAY_MS = 86_400_000;

type Zoom = 'day' | 'week' | 'month';

const PX_PER_DAY: Record<Zoom, number> = { day: 44, week: 18, month: 7 };

/** Days since the epoch for the UTC calendar day an ISO stamp falls on (null if none). */
function dayNumber(value?: string | null): number | null {
    const key = dayKeyOf(value);
    return key ? Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS) : null;
}

const isoFromDayNumber = (day: number): string => new Date(day * DAY_MS).toISOString();

/** Bar span in days, honouring start→due and the estimate / milestone fallbacks. */
function barRange(task: TaskCardDto): { start: number; end: number } | null {
    const due = dayNumber(task.dueDate);
    const start = dayNumber(task.startDate);
    if (task.isMilestone) {
        const at = due ?? start;
        return at === null ? null : { start: at, end: at };
    }
    if (start !== null && due !== null) return { start, end: Math.max(start, due) };
    if (due !== null) {
        const span = task.estimateMins ? Math.max(1, Math.round(task.estimateMins / 480)) : 1;
        return { start: due - span + 1, end: due };
    }
    if (start !== null) return { start, end: start };
    return null;
}

const ROW_H = 36;
const LABEL_W = 220;

type Drag = { id: string; kind: 'move' | 'start' | 'end'; origin: { start: number; end: number }; startX: number; dx: number };

/**
 * Timeline / Gantt view.
 *
 * One row per scheduled task, grouped under its board column. Bars are laid out on a shared
 * day scale so a reader sees overlap and slack at a glance; dragging a bar (or its edges)
 * reschedules the work through the same optimistic task-patch path the board uses. Milestones
 * are diamonds, epics get a heavier bar, and a vertical line marks today.
 */
export function GanttView({
    groups,
    canEdit,
    onOpen,
    onReschedule,
}: {
    groups: { id: string; name: string; tasks: TaskCardDto[] }[];
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    onReschedule: (taskId: string, patch: { startDate?: string | null; dueDate?: string | null }) => void;
}) {
    const [zoom, setZoom] = useState<Zoom>('week');
    const [drag, setDrag] = useState<Drag | null>(null);
    const px = PX_PER_DAY[zoom];

    const { rows, min, max } = useMemo(() => {
        const all = groups.flatMap((group) => group.tasks);
        const spans = all.map(barRange).filter((r): r is { start: number; end: number } => r !== null);
        const lo = spans.length ? Math.min(...spans.map((s) => s.start)) : dayNumber(new Date().toISOString())! - 7;
        const hi = spans.length ? Math.max(...spans.map((s) => s.end)) : lo + 14;
        // Pad a fortnight each way so the first/last bars are never glued to an edge.
        return { rows: all, min: lo - 14, max: hi + 14 };
    }, [groups]);

    const totalDays = Math.max(1, max - min + 1);
    const trackWidth = totalDays * px;
    const today = dayNumber(new Date().toISOString());
    const leftOf = (day: number) => (day - min) * px;
    const monthTicks = useMemo(() => buildMonthTicks(min, max, (day) => (day - min) * px), [min, max, px]);

    const startDrag = useCallback(
        (event: React.PointerEvent, task: TaskCardDto, kind: Drag['kind']) => {
            if (!canEdit) return;
            const origin = barRange(task);
            if (!origin) return;
            event.preventDefault();
            event.stopPropagation();
            (event.target as Element).setPointerCapture?.(event.pointerId);
            setDrag({ id: task.id, kind, origin, startX: event.clientX, dx: 0 });

            const move = (e: PointerEvent) => setDrag((d) => (d && d.id === task.id ? { ...d, dx: e.clientX - d.startX } : d));
            const up = (e: PointerEvent) => {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
                const dx = e.clientX - event.clientX;
                const shift = Math.round(dx / px);
                setDrag(null);
                if (shift === 0) return;
                if (kind === 'move') {
                    onReschedule(task.id, { startDate: isoFromDayNumber(origin.start + shift), dueDate: isoFromDayNumber(origin.end + shift) });
                } else if (kind === 'start') {
                    onReschedule(task.id, { startDate: isoFromDayNumber(Math.min(origin.start + shift, origin.end)) });
                } else {
                    onReschedule(task.id, { dueDate: isoFromDayNumber(Math.max(origin.end + shift, origin.start)) });
                }
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
        },
        [canEdit, px, onReschedule],
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                <div className="flex items-center gap-1 text-sm">
                    <span className="text-ink-muted">Zoom</span>
                    {(['day', 'week', 'month'] as Zoom[]).map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setZoom(option)}
                            className={clsx('rounded px-2 py-0.5 capitalize transition', zoom === option ? 'bg-active font-medium text-brand-700' : 'text-ink-muted hover:bg-hover')}
                        >
                            {option}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-ink-faint">{canEdit ? 'Drag a bar to reschedule · drag an edge to resize' : 'Read-only timeline'}</p>
            </div>

            {rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-ink-muted">No scheduled tasks yet. Add start or due dates to see them here.</div>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    <div style={{ width: LABEL_W + trackWidth }} className="relative">
                        {/* Month name rail */}
                        <div className="sticky top-0 z-20 flex h-6 border-b border-line bg-surface">
                            <div className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface px-3 text-xs font-medium leading-6 text-ink-muted" style={{ width: LABEL_W }}>
                                Task
                            </div>
                            <div className="relative" style={{ width: trackWidth }}>
                                {monthTicks.map((tick) => (
                                    <span key={tick.left} className="absolute top-0 text-[11px] font-medium text-ink-faint" style={{ left: tick.left + 4 }}>
                                        {tick.label}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {groups.map((group) => {
                            const scheduled = group.tasks.filter((t) => barRange(t));
                            if (scheduled.length === 0) return null;
                            return (
                                <div key={group.id}>
                                    <div className="sticky left-0 z-10 flex h-7 items-center border-b border-line bg-canvas px-3 text-xs font-semibold uppercase tracking-wide text-ink-faint" style={{ width: LABEL_W }}>
                                        {group.name}
                                    </div>
                                    <div className="relative">
                                        {/* Grid lines + today, spanning the group's rows */}
                                        <div className="pointer-events-none absolute inset-y-0 left-0" style={{ left: LABEL_W, width: trackWidth }}>
                                            {buildDayGrid(min, max, px, zoom).map((line) => (
                                                <span key={line.left} className="absolute inset-y-0 w-px bg-line/60" style={{ left: line.left }} aria-hidden />
                                            ))}
                                            {today !== null && today >= min && today <= max ? (
                                                <span className="absolute inset-y-0 w-0.5 bg-brand-500/70" style={{ left: leftOf(today) }} aria-hidden />
                                            ) : null}
                                        </div>

                                        {scheduled.map((task) => {
                                            const range = barRange(task)!;
                                            const shift = drag?.id === task.id && drag.kind !== 'end' ? Math.round(drag.dx / px) : 0;
                                            const endShift = drag?.id === task.id && drag.kind === 'end' ? Math.round(drag.dx / px) : 0;
                                            const start = range.start + (drag?.id === task.id && drag.kind === 'start' ? shift : drag?.id === task.id && drag.kind === 'move' ? shift : 0);
                                            const end = range.end + endShift + (drag?.id === task.id && drag.kind === 'move' ? shift : 0);
                                            const left = leftOf(start);
                                            const width = Math.max(px, (end - start + 1) * px);

                                            return (
                                                <div key={task.id} className="flex items-stretch border-b border-line/50" style={{ height: ROW_H }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => onOpen(task.id)}
                                                        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3 text-left text-xs hover:bg-hover"
                                                        style={{ width: LABEL_W }}
                                                        title={task.title}
                                                    >
                                                        {task.isMilestone ? <span className="h-2 w-2 rotate-45 bg-brand-500" aria-hidden /> : null}
                                                        {task.kind === 'epic' ? <span className="rounded bg-brand-500/15 px-1 text-[9px] font-bold uppercase text-brand-600">Epic</span> : null}
                                                        <span className="truncate text-ink">{task.title}</span>
                                                    </button>

                                                    <div className="relative" style={{ width: trackWidth }}>
                                                        <div
                                                            role={canEdit ? 'button' : undefined}
                                                            onPointerDown={(event) => startDrag(event, task, 'move')}
                                                            onClick={() => canEdit && drag === null && onOpen(task.id)}
                                                            className={clsx(
                                                                'group absolute top-1/2 flex -translate-y-1/2 items-center rounded',
                                                                task.isMilestone ? 'h-4 w-4 -rotate-45 rounded-sm' : 'h-4',
                                                                task.isMilestone ? 'bg-brand-500' : task.kind === 'epic' ? 'bg-brand-600' : statusTint(task.status),
                                                                canEdit && !task.isMilestone ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                                                            )}
                                                            style={{ left, width: task.isMilestone ? undefined : width }}
                                                            title={`${task.title} · ${task.startDate ? 'start ' : ''}${task.dueDate ? `due ${dayKeyOf(task.dueDate) ?? ''}` : ''}`}
                                                        >
                                                            {!task.isMilestone && canEdit ? (
                                                                <>
                                                                    <span
                                                                        onPointerDown={(event) => startDrag(event, task, 'start')}
                                                                        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover:opacity-100 bg-black/25"
                                                                    />
                                                                    <span
                                                                        onPointerDown={(event) => startDrag(event, task, 'end')}
                                                                        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover:opacity-100 bg-black/25"
                                                                    />
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function statusTint(status: TaskCardDto['status']): string {
    if (status === 'done') return 'bg-state-done';
    if (status === 'canceled') return 'bg-ink-faint';
    if (status === 'in_review') return 'bg-amber-500';
    if (status === 'in_progress') return 'bg-sky-500';
    return 'bg-emerald-500';
}

/** Month label positions for the top rail. */
function buildMonthTicks(min: number, max: number, leftOf: (day: number) => number): { label: string; left: number }[] {
    const ticks: { label: string; left: number }[] = [];
    for (let day = min; day <= max; day += 1) {
        const date = new Date(day * DAY_MS);
        if (date.getUTCDate() === 1) ticks.push({ label: `${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${date.getUTCFullYear()}`, left: leftOf(day) });
    }
    return ticks;
}

/** Vertical grid lines: every day at day-zoom, every Monday at week, every month at month. */
function buildDayGrid(min: number, max: number, px: number, zoom: Zoom): { left: number }[] {
    const lines: { left: number }[] = [];
    for (let day = min; day <= max; day += 1) {
        const date = new Date(day * DAY_MS);
        const dow = date.getUTCDay();
        const show = zoom === 'day' ? true : zoom === 'week' ? dow === 1 : date.getUTCDate() === 1;
        if (show) lines.push({ left: (day - min) * px });
    }
    return lines;
}
