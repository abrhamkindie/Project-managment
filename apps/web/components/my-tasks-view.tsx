'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { CalendarCheck, Flag, ListChecks } from 'lucide-react';
import { dayKeyOf, daysFromToday, dueLabel, dueTone, PRIORITY_BORDER, PRIORITY_LABEL } from '~/lib/format';
import { useMyTasks, useUpdateTask } from '~/lib/hooks';
import { projectPath } from '~/lib/paths';
import type { TaskCardDto, TaskPriority } from '~/lib/types';
import { AvatarStack, Button, EmptyState, ErrorNote, Skeleton } from './ui';
import { Page, PageHeader } from './page-shell';

/**
 * My Tasks: the personal work queue.
 *
 * Grouped by urgency (Overdue → Today → Tomorrow → This week → Later → No date) rather than by
 * project — the question this screen answers is "what needs me now", not "what projects do I
 * belong to". Project becomes an inline chip that still deep-links to its board.
 *
 * Priority tints the row's left border so a glance sorts the pile even before reading the labels.
 * A chip strip above the list doubles as a filter and as a live count per bucket, so the user can
 * jump straight to, say, everything overdue without scrolling past the rest.
 */

type BucketKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

const BUCKETS: { key: BucketKey; label: string; tone?: string }[] = [
    { key: 'overdue', label: 'Overdue', tone: 'text-state-urgent' },
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tomorrow' },
    { key: 'week', label: 'This week' },
    { key: 'later', label: 'Later' },
    { key: 'none', label: 'No date' },
];

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

type FlatTask = TaskCardDto & { projectName: string; projectColor: string };

export function MyTasksView({ orgId, slug }: { orgId: string; slug: string; viewerId: string }) {
    const myTasks = useMyTasks(orgId);
    const [filter, setFilter] = useState<BucketKey | 'all'>('all');

    // Flatten project groups into one list so bucketing is straightforward. The API still ships
    // grouped payload (used by other consumers), we just don't need that shape here.
    const flat = useMemo<FlatTask[]>(() => {
        const groups = myTasks.data?.groups ?? [];
        const out: FlatTask[] = [];
        for (const g of groups) {
            for (const t of g.tasks) out.push({ ...t, projectName: g.project.name, projectColor: g.project.color });
        }
        return out;
    }, [myTasks.data]);

    // Assign each task to a bucket once, then group. Buckets with no tasks disappear from the
    // count row and the list, so the header is always "true" even for sparse work weeks.
    const byBucket = useMemo(() => {
        const map: Record<BucketKey, FlatTask[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] };
        for (const task of flat) map[bucketOf(task)].push(task);
        for (const list of Object.values(map)) list.sort(withinBucket);
        return map;
    }, [flat]);

    const counts = useMemo(() => {
        const c: Record<BucketKey, number> = { overdue: 0, today: 0, tomorrow: 0, week: 0, later: 0, none: 0 };
        for (const b of BUCKETS) c[b.key] = byBucket[b.key].length;
        return c;
    }, [byBucket]);

    const total = flat.length;
    const visible: BucketKey[] = filter === 'all' ? BUCKETS.map((b) => b.key) : [filter];

    return (
        <Page>
            <PageHeader
                title="My Tasks"
                description={
                    total > 0 ? (
                        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>
                                {total} open {total === 1 ? 'task' : 'tasks'} assigned to you
                            </span>
                            {counts.overdue > 0 ? (
                                <span className="inline-flex items-center gap-1 text-state-urgent">
                                    <CalendarCheck className="h-4 w-4" />
                                    {counts.overdue} overdue
                                </span>
                            ) : null}
                            {counts.today > 0 ? <span className="text-ink-soft">{counts.today} due today</span> : null}
                        </span>
                    ) : undefined
                }
            />

            {myTasks.isError ? <ErrorNote error={myTasks.error} /> : null}

            {myTasks.isPending ? (
                <div className="space-y-2">
                    <Skeleton className="h-8 w-96" />
                    {[0, 1, 2, 3, 4].map((key) => (
                        <Skeleton key={key} className="h-14" />
                    ))}
                </div>
            ) : total === 0 ? (
                <EmptyState
                    icon={<ListChecks className="h-6 w-6" />}
                    title="Nothing is waiting on you"
                    description="Every task assigned to you is done or the projects have no open work. New assignments appear here as soon as they happen."
                />
            ) : (
                <>
                    <BucketFilter value={filter} onChange={setFilter} counts={counts} />

                    {visible.every((key) => byBucket[key].length === 0) ? (
                        <EmptyState
                            icon={<ListChecks className="h-6 w-6" />}
                            title={`No ${BUCKETS.find((b) => b.key === filter)?.label.toLowerCase() ?? 'matching'} tasks`}
                            description="Pick another bucket above, or clear the filter to see everything."
                            action={<Button onClick={() => setFilter('all')}>Show all</Button>}
                        />
                    ) : (
                        <div className="space-y-6">
                            {visible
                                .filter((key) => byBucket[key].length > 0)
                                .map((key) => {
                                    const meta = BUCKETS.find((b) => b.key === key)!;
                                    const tasks = byBucket[key];
                                    return (
                                        <section key={key} className="space-y-1.5">
                                            <h2 className={clsx('flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted', meta.tone)}>
                                                {meta.label}
                                                <span className="text-ink-faint">{tasks.length}</span>
                                            </h2>
                                            <ul className="card divide-y divide-line overflow-hidden">
                                                {tasks.map((task) => (
                                                    <li key={task.id}>
                                                        <MyTaskRow slug={slug} task={task} />
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    );
                                })}
                        </div>
                    )}
                </>
            )}
        </Page>
    );
}

/**
 * A tight horizontal strip of filter chips. Each chip is also a live count, so scanning the row
 * tells the reader where the pressure is without them opening anything.
 */
function BucketFilter({ value, onChange, counts }: { value: BucketKey | 'all'; onChange: (next: BucketKey | 'all') => void; counts: Record<BucketKey, number> }) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return (
        <div role="tablist" className="mb-4 flex flex-wrap items-center gap-1.5">
            <Chip active={value === 'all'} onClick={() => onChange('all')} label="All" count={total} />
            {BUCKETS.map((b) => (
                <Chip
                    key={b.key}
                    active={value === b.key}
                    onClick={() => onChange(b.key)}
                    label={b.label}
                    count={counts[b.key]}
                    tone={b.tone}
                    disabled={counts[b.key] === 0}
                />
            ))}
        </div>
    );
}

function Chip({ active, onClick, label, count, tone, disabled }: { active: boolean; onClick: () => void; label: string; count: number; tone?: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled && !active}
            onClick={onClick}
            className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
                active ? 'border-brand-500 bg-active font-medium text-brand-700' : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                disabled && !active && 'opacity-40',
                !active && tone,
            )}
        >
            {label}
            <span className={clsx('tabular-nums', active ? 'text-brand-700' : 'text-ink-faint')}>{count}</span>
        </button>
    );
}

/**
 * Compact row tuned for scan-and-complete.
 * Priority tints the left border; project is a chip (link to its board); the click-to-open target
 * is a `<button>` so keyboard users can open the drawer without tabbing past the avatar stack.
 */
function MyTaskRow({ task, slug }: { task: FlatTask; slug: string }) {
    const update = useUpdateTask();
    const tone = dueTone(task.dueDate, task.status, task.isOverdue);
    const href = `${projectPath(slug, task.projectId)}?task=${task.id}`;
    return (
        <div className={clsx('group flex items-center gap-3 border-l-2 px-3 py-2.5 transition hover:bg-canvas', PRIORITY_BORDER[task.priority])}>
            <button
                type="button"
                aria-label="Mark done"
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-transparent transition hover:border-brand-300 hover:text-brand-500"
                onClick={() => update.mutate({ taskId: task.id, patch: { status: 'done' } })}
            >
                ✓
            </button>

            <Link href={href} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink group-hover:text-brand-700">
                    {task.isMilestone ? <Flag className="mr-1.5 inline h-3.5 w-3.5 text-brand-500" /> : null}
                    {task.title}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor }} aria-hidden />
                        <span className="truncate">{task.projectName}</span>
                    </span>
                    <span className={clsx('inline-flex items-center gap-1', tone === 'overdue' ? 'text-state-urgent' : tone === 'soon' ? 'text-amber-600' : 'text-ink-faint')}>
                        {dueLabel(task.dueDate)}
                    </span>
                    {task.priority !== 'none' ? <span className="font-medium">{PRIORITY_LABEL[task.priority]}</span> : null}
                </div>
            </Link>

            <AvatarStack users={task.assignees} max={3} />
        </div>
    );
}

/** Bucket assignment. `isOverdue` from the server is more precise than a calendar-day subtraction
 *  for tasks due exactly today (which the day-key check would call "not overdue"). */
function bucketOf(task: FlatTask): BucketKey {
    const key = dayKeyOf(task.dueDate);
    if (!key) return 'none';
    if (task.isOverdue) return 'overdue';
    const days = daysFromToday(task.dueDate);
    if (days === null) return 'none';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days <= 6) return 'week';
    return 'later';
}

/** Urgent first, then sooner-due, then project name, then title. Keeps like-with-like together. */
function withinBucket(a: FlatTask, b: FlatTask): number {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    const ad = a.dueDate ?? '9999';
    const bd = b.dueDate ?? '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    const pn = a.projectName.localeCompare(b.projectName);
    if (pn !== 0) return pn;
    return a.title.localeCompare(b.title);
}
