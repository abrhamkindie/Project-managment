'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { addMonths, format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayKeyOf, PRIORITY_LABEL } from '~/lib/format';
import { projectPath } from '~/lib/paths';
import { useProjects, useTasks, useUpdateTask } from '~/lib/hooks';
import type { TaskCardDto } from '~/lib/types';
import { AvatarStack, Button, ErrorNote, Skeleton } from './ui';

/**
 * Calendar view: one month of due dates.
 *
 * The grid is built from UTC calendar-day numbers rather than `Date` arithmetic, so a DST change
 * inside the month cannot create a 23- or 25-hour step and shift every chip by a day. "Today" is
 * resolved in the viewer's own timezone — the day a card is due is a calendar day for the person
 * who owns it, not for the server.
 *
 * Dropping a chip rewrites `dueDate` (and slides `startDate` with it to keep the span) through the
 * same task-patch path the board uses, so realtime and caches behave identically here.
 */

const DAY_MS = 86_400_000;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** A grid is always six weeks: enough to cover any month, keep the height steady, never reflow. */
const CELLS = 42;

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
const dayKey = (index: number) => new Date(index * DAY_MS).toISOString().slice(0, 10);
const currentMonthKey = () => new Date().toISOString().slice(0, 7);

/** Today's calendar day in the viewer's zone, falling back to the machine clock when unset. */
function todayKey(timezone?: string): string {
    const fallback = new Date().toISOString().slice(0, 10);
    if (!timezone) return fallback;
    try {
        // `en-CA` is the ISO-looking locale: YYYY-MM-DD without any formatting maths.
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch {
        return fallback;
    }
}

const dayStamp = (key: string) => `${key}T00:00:00.000Z`;

export function CalendarView({
    orgId,
    slug,
    viewerId,
    timezone,
    projectId = null,
    canEdit = true,
    onOpen,
}: {
    orgId: string;
    slug: string;
    viewerId: string;
    timezone?: string;
    /** Limits the grid to one project; the org calendar leaves it out. */
    projectId?: string | null;
    canEdit?: boolean;
    /** Opens the drawer in the project workspace; org mode falls back to a link when omitted. */
    onOpen?: (taskId: string) => void;
}) {
    const [month, setMonth] = useState(currentMonthKey);
    const [mineOnly, setMineOnly] = useState(false);
    const [dropKey, setDropKey] = useState<string | null>(null);
    const update = useUpdateTask();

    const cells = useMemo(() => {
        const first = dayNumber(`${month}-01`);
        // 1970-01-01 was a Thursday, so index 0 lands on Monday with this offset.
        const start = first - ((first + 3) % 7);
        return Array.from({ length: CELLS }, (_, offset) => dayKey(start + offset));
    }, [month]);

    const tasks = useTasks(orgId, {
        ...(projectId ? { projectId } : {}),
        ...(mineOnly ? { assigneeId: viewerId } : {}),
        dueAfter: dayStamp(cells[0]),
        dueBefore: `${cells[CELLS - 1]}T23:59:59.999Z`,
        orderBy: 'dueDate',
        pageSize: 200,
    });
    // Project colour and edit rights come from the org list; chips are tinted by project.
    const projects = useProjects(orgId);

    const tintById = useMemo(() => {
        const map = new Map<string, { name: string; color: string; canEdit: boolean }>();
        for (const project of projects.data?.items ?? []) map.set(project.id, { name: project.name, color: project.color, canEdit: project.canEdit ?? false });
        return map;
    }, [projects.data]);

    // A task is bucketed on every day it is scheduled, not only its deadline: the due day is the
    // `anchor` (the full chip), and any earlier day inside its start→due window gets a continuation
    // bar, so the grid reads as a working schedule rather than a single dot per deadline.
    const byDay = useMemo(() => {
        const map = new Map<string, { task: TaskCardDto; anchor: boolean }[]>();
        const push = (key: string, task: TaskCardDto, anchor: boolean) => {
            const bucket = map.get(key);
            if (bucket) bucket.push({ task, anchor });
            else map.set(key, [{ task, anchor }]);
        };
        for (const task of tasks.data?.items ?? []) {
            const dueKey = dayKeyOf(task.dueDate);
            if (!dueKey) continue;
            push(dueKey, task, true);
            const startKey = dayKeyOf(task.startDate);
            if (startKey && startKey < dueKey) {
                for (const key of cells) {
                    if (key >= startKey && key < dueKey) push(key, task, false);
                }
            }
        }
        return map;
    }, [tasks.data, cells]);

    const today = todayKey(timezone);
    const monthLabel = useMemo(() => format(parseISO(`${month}-01`), 'MMMM yyyy'), [month]);

    const shift = useCallback((delta: number) => setMonth((value) => format(addMonths(parseISO(`${value}-01`), delta), 'yyyy-MM')), []);

    const reschedule = useCallback(
        (taskId: string, key: string) => {
            const task = (tasks.data?.items ?? []).find((candidate) => candidate.id === taskId);
            const due = dayNumber(key);
            if (!task || !Number.isFinite(due)) return;
            const patch: { dueDate: string; startDate?: string | null } = { dueDate: dayStamp(key) };
            // Keep the working window the same length instead of collapsing a multi-day task.
            const start = dayKeyOf(task.startDate);
            if (start) {
                const span = Math.max(0, due - dayNumber(start));
                patch.startDate = dayStamp(dayKey(Math.max(0, due - span)));
            }
            update.mutate({ taskId, patch });
        },
        [tasks.data, update],
    );

    const truncated = (tasks.data?.total ?? 0) > (tasks.data?.items.length ?? 0);

    return (
        <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-1 text-lg font-semibold text-ink">{monthLabel}</h2>
                <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMonth(currentMonthKey())}>
                    Today
                </Button>
                <button
                    type="button"
                    className={clsx('btn btn-sm', mineOnly ? 'btn-primary' : 'btn-secondary')}
                    onClick={() => setMineOnly((value) => !value)}
                >
                    Only mine
                </button>
                {tasks.isFetching ? <span className="text-xs text-ink-faint">Loading…</span> : null}
            </div>

            {tasks.isError ? <ErrorNote error={tasks.error} /> : null}

            {tasks.isPending ? (
                <Skeleton className="h-[60vh]" />
            ) : (
                <div className="card min-h-0 overflow-auto">
                    <div className="grid grid-cols-7 border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        {WEEK_DAYS.map((day) => (
                            <div key={day} className="px-2 py-1.5 text-center">
                                {day}
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7">
                        {cells.map((key) => {
                            const inMonth = key.slice(0, 7) === month;
                            const entries = byDay.get(key) ?? [];
                            const shown = entries.slice(0, 5);
                            const isToday = key === today;
                            return (
                                <div
                                    key={key}
                                    onDragOver={(event) => {
                                        if (!canEdit) return;
                                        event.preventDefault();
                                        setDropKey(key);
                                    }}
                                    onDragLeave={() => setDropKey((value) => (value === key ? null : value))}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        setDropKey(null);
                                        if (!canEdit) return;
                                        const id = event.dataTransfer.getData('text/plain');
                                        if (id) reschedule(id, key);
                                    }}
                                    className={clsx(
                                        'flex min-h-[104px] flex-col gap-1 border-b border-r border-line p-1.5 transition',
                                        inMonth ? 'bg-surface' : 'bg-canvas/60 text-ink-faint',
                                        dropKey === key && 'bg-active ring-1 ring-inset ring-brand-300',
                                    )}
                                >
                                    <span
                                        className={clsx(
                                            'self-start rounded px-1 text-xs tabular-nums',
                                            isToday ? 'bg-brand-500 font-semibold text-white' : inMonth ? 'text-ink-muted' : 'text-ink-faint',
                                        )}
                                    >
                                        {Number(key.slice(8, 10))}
                                    </span>

                                    {shown.map(({ task, anchor }) => {
                                        const project = tintById.get(task.projectId);
                                        const tint = project?.color ?? 'rgb(var(--brand-500))';
                                        const dim = task.status === 'done' || task.status === 'canceled';

                                        // A continuation day carries just a bar: the label and the
                                        // action stay on the deadline, so one task is not written out
                                        // again on every day of its window.
                                        if (!anchor) {
                                            const bar = (
                                                <div
                                                    role="button"
                                                    tabIndex={-1}
                                                    title={task.title}
                                                    onClick={() => onOpen?.(task.id)}
                                                    className={clsx('h-1.5 rounded-full', onOpen ? 'cursor-pointer' : '', dim && 'opacity-55')}
                                                    style={{ backgroundColor: tint }}
                                                />
                                            );
                                            return onOpen || !slug ? (
                                                <span key={task.id}>{bar}</span>
                                            ) : (
                                                <Link key={task.id} href={`${projectPath(slug, task.projectId)}?task=${task.id}`} className="block">
                                                    {bar}
                                                </Link>
                                            );
                                        }

                                        const draggable = canEdit && (projectId ? true : project?.canEdit === true);
                                        const chip = (
                                            <span className="block min-w-0 flex-1">
                                                {!projectId && project ? (
                                                    <span className="block truncate text-[10px] uppercase tracking-wide text-ink-faint">{project.name}</span>
                                                ) : null}
                                                <span className="flex items-center gap-1">
                                                    {task.isOverdue ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label="Overdue" /> : null}
                                                    <span className="min-w-0 truncate text-[11px] leading-tight text-ink">{task.title}</span>
                                                </span>
                                            </span>
                                        );
                                        const content = onOpen || !slug ? (
                                            <button type="button" className="flex min-w-0 flex-1 text-left" onClick={() => onOpen?.(task.id)}>
                                                {chip}
                                            </button>
                                        ) : (
                                            <Link href={`${projectPath(slug, task.projectId)}?task=${task.id}`} className="flex min-w-0 flex-1">
                                                {chip}
                                            </Link>
                                        );
                                        return (
                                            <div
                                                key={task.id}
                                                draggable={draggable}
                                                onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                                                title={`${task.title} · ${PRIORITY_LABEL[task.priority]}${project ? ` · ${project.name}` : ''}`}
                                                className={clsx(
                                                    'flex items-center gap-1 rounded border-l-2 bg-canvas px-1 py-1',
                                                    dim ? 'opacity-55' : '',
                                                    draggable ? 'cursor-grab active:cursor-grabbing' : '',
                                                )}
                                                style={{ borderLeftColor: tint }}
                                            >
                                                {content}
                                                {task.assignees.length > 0 ? <AvatarStack users={task.assignees} max={1} /> : null}
                                            </div>
                                        );
                                    })}

                                    {entries.length > shown.length ? <span className="px-1 text-[11px] text-ink-faint">+{entries.length - shown.length} more</span> : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {truncated ? <p className="text-xs text-ink-faint">Showing the first 200 scheduled tasks in this range — narrow it with “Only mine” or open the project.</p> : null}
        </div>
    );
}
