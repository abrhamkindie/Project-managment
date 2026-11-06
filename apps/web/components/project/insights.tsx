'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { CircleGauge, Clock, Timer, TrendingUp } from 'lucide-react';
import { PRIORITY_LABEL, STATUS_LABEL, formatMins, percent } from '~/lib/format';
import { useBurndown, useCycleCompletion, useCycles, useProjectOverview, useTasks } from '~/lib/hooks';
import type { AnalyticsQuery } from '~/lib/types';
import { EmptyState, ErrorNote, ProgressBar, Select, Skeleton } from '../ui';

/**
 * Project insights: the cycle story plus the numbers behind it.
 *
 * Four reads, each with its own job — the overview totals carry throughput / priority / on-time rate,
 * the burndown is per cycle, the completion list is the velocity trend across cycles, and the epic
 * rollup comes from the task list because only the task readers compute child progress.
 */

const WINDOWS = [
    { days: 30, label: 'Last 30 days' },
    { days: 60, label: 'Last 60 days' },
    { days: 90, label: 'Last 90 days' },
] as const;

/** Recharts paints with raw CSS values, so the theme tokens have to be spelled out here. */
const chartTooltip = {
    contentStyle: {
        background: 'rgb(var(--surface))',
        borderRadius: 10,
        border: '1px solid rgb(var(--line))',
        fontSize: 12,
        color: 'rgb(var(--ink))',
        boxShadow: 'var(--shadow-card)',
    },
    labelStyle: { color: 'rgb(var(--ink-muted))' },
};

const axisTick = { fontSize: 10, fill: 'rgb(var(--ink-muted))' };

export function ProjectInsights({ orgId, projectId }: { orgId: string; projectId: string }) {
    const [days, setDays] = useState<number>(30);
    const [cyclePick, setCyclePick] = useState('');

    const query = useMemo<AnalyticsQuery>(() => {
        // UTC-midnight snapping, same as the dashboard: a raw `Date.now()` would give the chart a new
        // cache key on every render and refetch forever.
        const dayMs = 86_400_000;
        const todayUtc = Math.floor(Date.now() / dayMs) * dayMs;
        return { from: new Date(todayUtc - days * dayMs).toISOString(), granularity: days > 45 ? 'week' : 'day' };
    }, [days]);

    const overview = useProjectOverview(projectId, query);
    const cycles = useCycles(projectId);
    const completion = useCycleCompletion(projectId);
    const epics = useTasks(orgId, { projectId, kind: 'epic', pageSize: 20 });

    // Default to the running sprint, else the most recent one — a chart of a draft cycle is noise.
    const cycleId =
        cyclePick ||
        cycles.data?.find((cycle) => cycle.status === 'active')?.id ||
        cycles.data?.[cycles.data.length - 1]?.id ||
        '';
    const burndown = useBurndown(projectId, cycleId || undefined);

    if (overview.isLoading) return <Skeleton className="h-64" />;
    if (overview.isError || !overview.data) return <ErrorNote error={overview.error} />;

    const totals = overview.data.totals;

    return (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Project insights</h2>
                <Select
                    aria-label="Reporting window"
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="text-sm"
                >
                    {WINDOWS.map((window) => (
                        <option key={window.days} value={window.days}>
                            {window.label}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat icon={<CircleGauge className="h-4 w-4" />} label="On-time completion" value={percent(totals.onTimeRate)} hint="finished on or before their due date" />
                <Stat icon={<TrendingUp className="h-4 w-4" />} label="Completion rate" value={percent(totals.completionRate)} hint={`${totals.completed} of ${totals.tasks} created in the window`} />
                <Stat icon={<Clock className="h-4 w-4" />} label="Time logged" value={formatMins(totals.loggedMins)} hint={`${totals.open} still open`} />
                <Stat icon={<Timer className="h-4 w-4" />} label="Avg. time to done" value={totals.avgCompletionHours === null ? '—' : `${Math.round(totals.avgCompletionHours)}h`} hint="created → completed" />
            </div>

            <section className="rounded-xl border border-line bg-surface p-4">
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">Burndown</h3>
                    {cycles.data?.length ? (
                        <Select
                            aria-label="Cycle"
                            value={cycleId}
                            onChange={(event) => setCyclePick(event.target.value)}
                            className="text-sm"
                        >
                            {cycles.data.map((cycle) => (
                                <option key={cycle.id} value={cycle.id}>
                                    {cycle.name}
                                </option>
                            ))}
                        </Select>
                    ) : null}
                </header>

                {!cycles.data?.length ? (
                    <p className="text-xs text-ink-faint">No cycles yet — create a sprint to get a burndown.</p>
                ) : burndown.isLoading || !burndown.data ? (
                    <Skeleton className="h-52" />
                ) : (
                    <>
                        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                            <span>{burndown.data.totals.scope} in scope</span>
                            <span>{burndown.data.totals.completed} done</span>
                            <span>{burndown.data.totals.remaining} remaining</span>
                            <span>{formatMins(burndown.data.totals.loggedMins)} logged</span>
                        </div>
                        <div className="h-52">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={burndown.data.days} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                                    <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'rgb(var(--line))' }} minTickGap={24} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                                    <Tooltip {...chartTooltip} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Line type="monotone" dataKey="ideal" name="Ideal" stroke="rgb(var(--brand-300))" strokeDasharray="4 4" dot={false} />
                                    <Line type="monotone" dataKey="remaining" name="Remaining" stroke="rgb(var(--brand-500))" strokeWidth={2} dot={false} connectNulls={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Cycle velocity</h3>
                {!completion.data?.cycles.length ? (
                    <p className="text-xs text-ink-faint">Nothing to trend yet.</p>
                ) : (
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={completion.data.cycles} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barGap={3} barCategoryGap="28%">
                                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: 'rgb(var(--line))' }} />
                                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                                <Tooltip {...chartTooltip} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="scope" name="Scope" fill="rgb(var(--brand-200))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                                <Bar dataKey="completed" name="Completed" fill="rgb(var(--green-500))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-line bg-surface p-4">
                    <h3 className="mb-3 text-sm font-semibold text-ink">Priority mix</h3>
                    {overview.data.byPriority.length === 0 ? (
                        <p className="text-xs text-ink-faint">No tasks in this window.</p>
                    ) : (
                        <ul className="space-y-2">
                            {overview.data.byPriority.map((row) => (
                                <li key={row.key}>
                                    <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                                        <span>{PRIORITY_LABEL[row.key as keyof typeof PRIORITY_LABEL] ?? row.key}</span>
                                        <span className="tabular-nums">{row.count}</span>
                                    </div>
                                    <ProgressBar value={(row.count / Math.max(1, totals.tasks)) * 100} tone="brand" />
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="rounded-xl border border-line bg-surface p-4">
                    <h3 className="mb-3 text-sm font-semibold text-ink">Status mix</h3>
                    <ul className="space-y-2">
                        {overview.data.byStatus.map((row) => (
                            <li key={row.key}>
                                <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                                    <span>{STATUS_LABEL[row.key as keyof typeof STATUS_LABEL] ?? row.key}</span>
                                    <span className="tabular-nums">{row.count}</span>
                                </div>
                                <ProgressBar value={(row.count / Math.max(1, totals.tasks)) * 100} tone={row.key === 'done' ? 'success' : 'warning'} />
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Epics</h3>
                {epics.isLoading ? (
                    <Skeleton className="h-24" />
                ) : !epics.data?.items.length ? (
                    <EmptyState title="No epics" description="Group related work under an epic to see rollups here." />
                ) : (
                    <ul className="space-y-2">
                        {epics.data.items.map((epic) => (
                            <li key={epic.id} className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate text-sm text-ink">{epic.title}</span>
                                <span className="w-32 shrink-0">
                                    <ProgressBar
                                        value={epic.epicProgress && epic.epicProgress.total ? (epic.epicProgress.done / epic.epicProgress.total) * 100 : 0}
                                        tone="brand"
                                    />
                                </span>
                                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                                    {epic.epicProgress ? `${epic.epicProgress.done}/${epic.epicProgress.total}` : '—'}
                                </span>
                                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{formatMins(epic.loggedMins)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-line bg-surface p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <span className="text-ink-faint">{icon}</span>
                {label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
            {hint ? <p className="text-[11px] text-ink-faint">{hint}</p> : null}
        </div>
    );
}
