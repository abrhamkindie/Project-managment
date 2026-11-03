'use client';

import Link from 'next/link';
import { useMemo, useState, type ComponentType } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { AlertTriangle, CalendarClock, CircleGauge, Flag, Timer } from 'lucide-react';
import {
    HEALTH_CLASS,
    HEALTH_LABEL,
    PRIORITY_LABEL,
    STATUS_LABEL,
    STATUS_TOKEN,
    dueLabel,
    formatHours,
    percent,
} from '~/lib/format';
import { projectsPath, projectPath } from '~/lib/paths';
import { useOverview, useTeams } from '~/lib/hooks';
import type { AnalyticsQuery, ProjectHealthRow, Tally, WorkloadRow } from '~/lib/types';
import { Badge, EmptyState, ErrorNote, ProgressBar, Select, Skeleton } from './ui';
import { Page, PageHeader, Section } from './page-shell';

/**
 * The reporting screen: is the team keeping up, and what needs attention today?
 *
 * One request feeds the whole page — `GET /analytics/overview` returns totals, breakdowns,
 * the throughput series, workload and project health together, because splitting them into
 * six queries would make the numbers disagree with each other while they were loading.
 */

const WINDOWS = [
    { days: 7, label: 'Last 7 days' },
    { days: 30, label: 'Last 30 days' },
    { days: 90, label: 'Last 90 days' },
] as const;

export function DashboardView({ orgId, slug }: { orgId: string; slug: string }) {
    const [days, setDays] = useState<number>(30);
    const [teamId, setTeamId] = useState<string>('');

    // A wider window is bucketed by week so the chart keeps fewer than ~14 bars on screen.
    const query = useMemo<AnalyticsQuery>(() => {
        const from = new Date(Date.now() - days * 86_400_000).toISOString();
        return { from, granularity: days > 45 ? 'week' : 'day', ...(teamId ? { teamId } : {}) };
    }, [days, teamId]);

    const overview = useOverview(orgId, query);
    const teams = useTeams(orgId);

    if (overview.error) {
        return (
            <Page>
                <PageHeader title="Dashboard" />
                <ErrorNote error={overview.error} />
            </Page>
        );
    }

    if (!overview.data) {
        return (
            <Page>
                <PageHeader title="Dashboard" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-24" />
                    ))}
                </div>
                <Skeleton className="mt-4 h-64" />
            </Page>
        );
    }

    const { totals, throughput, workload, projects, milestones, byStatus, byPriority, window: range } = overview.data;
    const empty = totals.tasks === 0;

    return (
        <Page wide>
            <PageHeader
                title="Dashboard"
                description={`${new Date(range.from).toLocaleDateString()} – ${new Date(range.to).toLocaleDateString()} · ${range.granularity === 'week' ? 'weekly' : 'daily'} buckets`}
                actions={
                    <>
                        {teams.data?.length ? (
                            <Select value={teamId} onChange={(event) => setTeamId(event.target.value)} aria-label="Filter by team" className="w-auto">
                                <option value="">All teams</option>
                                {teams.data.map((team) => (
                                    <option key={team.id} value={team.id}>
                                        {team.name}
                                    </option>
                                ))}
                            </Select>
                        ) : null}
                        <Select value={String(days)} onChange={(event) => setDays(Number(event.target.value))} aria-label="Time window" className="w-auto">
                            {WINDOWS.map((option) => (
                                <option key={option.days} value={option.days}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </>
                }
            />

            {empty ? (
                <EmptyState
                    icon={<CircleGauge className="h-8 w-8" />}
                    title="Nothing to report yet"
                    description="Create a project and assign a few tasks — the numbers below fill in as work moves."
                    action={
                        <Link href={projectsPath(slug)} className="btn btn-primary btn-sm">
                            Go to projects
                        </Link>
                    }
                />
            ) : (
                <div className="space-y-6">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Open tasks" value={totals.open} hint={`${totals.tasks} total`} />
                        <Stat label="Overdue" value={totals.overdue} hint={`${totals.dueSoon} due soon`} tone={totals.overdue > 0 ? 'danger' : 'ok'} icon={AlertTriangle} />
                        <Stat label="Completed" value={totals.completed} hint={`${totals.created} created`} icon={CircleGauge} />
                        <Stat label="Completion rate" value={percent(totals.completionRate)} hint={`avg ${formatHours(totals.avgCompletionHours)} to finish`} icon={Timer} />
                    </div>

                    <Section title="Created vs completed">
                        <div className="card p-4">
                            <ThroughputChart buckets={throughput} />
                        </div>
                    </Section>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Section title="Tasks by status">
                            <Breakdown rows={byStatus} labelOf={(key) => STATUS_LABEL[key as keyof typeof STATUS_LABEL] ?? key} dot={(key) => STATUS_TOKEN[key as keyof typeof STATUS_TOKEN]} />
                        </Section>
                        <Section title="Tasks by priority">
                            <Breakdown rows={byPriority} labelOf={(key) => PRIORITY_LABEL[key as keyof typeof PRIORITY_LABEL] ?? key} />
                        </Section>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Section title="Workload by person">
                            <WorkloadTable rows={workload} />
                        </Section>
                        <Section title="Project health">
                            <ProjectHealthTable rows={projects} slug={slug} />
                        </Section>
                    </div>

                    <Section title="Milestones">
                        {milestones.length === 0 ? (
                            <p className="card px-4 py-3 text-sm text-ink-muted">No milestones in this window. Mark a task as a milestone to track it here.</p>
                        ) : (
                            <ul className="card divide-y divide-line">
                                {milestones.map((milestone) => (
                                    <li key={milestone.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                                        <Flag className="h-4 w-4 shrink-0 text-brand-500" />
                                        <span className="min-w-0 flex-1 truncate">{milestone.title}</span>
                                        <span className="hidden text-xs text-ink-faint sm:inline">{milestone.project}</span>
                                        <Badge tone={milestone.status === 'done' ? 'success' : milestone.isOverdue ? 'danger' : 'neutral'}>
                                            {milestone.isOverdue ? 'Overdue' : STATUS_LABEL[milestone.status]}
                                        </Badge>
                                        <span className="w-24 shrink-0 text-right text-xs text-ink-muted">
                                            <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                                            {dueLabel(milestone.dueDate)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>
            )}
        </Page>
    );
}

function Stat({
    label,
    value,
    hint,
    tone = 'neutral',
    icon: Icon,
}: {
    label: string;
    value: number | string;
    hint?: string;
    tone?: 'neutral' | 'ok' | 'danger';
    icon?: ComponentType<{ className?: string }>;
}) {
    const accent = { neutral: 'text-ink', ok: 'text-ink', danger: 'text-state-urgent' }[tone];
    return (
        <div className="card p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                {label}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
            {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
        </div>
    );
}

/**
 * Grouped bars, created against completed.
 *
 * Recharts is the only chart dependency, and it is used for this one series: the other
 * breakdowns are counts with a bar behind them, which reads better as plain markup.
 */
function ThroughputChart({ buckets }: { buckets: { bucket: string; created: number; completed: number }[] }) {
    // `2026-11-03` is too wide for an axis; the day part is enough to place a bar.
    const data = buckets.map((row) => ({ ...row, label: row.bucket.length > 8 ? row.bucket.slice(5) : row.bucket }));

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                    <Tooltip
                        cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                        contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                        labelFormatter={(value) => `Bucket ${value}`}
                    />
                    <Bar dataKey="created" name="Created" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function Breakdown({
    rows,
    labelOf,
    dot,
}: {
    rows: Tally[];
    labelOf: (key: string) => string;
    dot?: (key: string) => string | undefined;
}) {
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const max = Math.max(1, ...rows.map((row) => row.count));
    if (rows.length === 0) return <p className="card px-4 py-3 text-sm text-ink-muted">Nothing counted yet.</p>;

    return (
        <ul className="card space-y-2.5 p-4">
            {rows.map((row) => (
                <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                        {dot?.(row.key) ? <span className={`status-dot ${dot(row.key)}`} aria-hidden /> : null}
                        <span className="truncate text-ink-soft">{labelOf(row.key)}</span>
                    </span>
                    <span className="h-2 rounded-full bg-gray-100">
                        <span className="block h-full rounded-full bg-brand-400" style={{ width: `${(row.count / max) * 100}%` }} />
                    </span>
                    <span className="tabular-nums text-ink-muted">
                        {row.count}
                        <span className="ml-1 text-xs text-ink-faint">{total ? Math.round((row.count / total) * 100) : 0}%</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}

function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
    const max = Math.max(1, ...rows.map((row) => row.score));
    if (rows.length === 0) return <p className="card px-4 py-3 text-sm text-ink-muted">No assigned work in this window.</p>;

    return (
        <ul className="card divide-y divide-line">
            {rows.map((row) => (
                <li key={row.user.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                            {row.user.firstName} {row.user.lastName}
                        </span>
                        <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                            <span
                                className={`block h-full rounded-full ${row.overdue > 0 ? 'bg-state-urgent' : 'bg-brand-400'}`}
                                style={{ width: `${(row.score / max) * 100}%` }}
                            />
                        </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-ink-muted">
                        {row.open} open
                        {row.overdue > 0 ? <Badge tone="danger" className="ml-1.5">{row.overdue} late</Badge> : null}
                        <span className="block text-ink-faint">{row.done} done</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ProjectHealthTable({ rows, slug }: { rows: ProjectHealthRow[]; slug: string }) {
    if (rows.length === 0) return <p className="card px-4 py-3 text-sm text-ink-muted">No projects with tasks yet.</p>;

    return (
        <ul className="card divide-y divide-line">
            {rows.map((row) => (
                <li key={row.project.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <Link href={projectPath(slug, row.project.id)} className="flex min-w-0 items-center gap-2 hover:underline">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.project.color }} aria-hidden />
                            <span className="truncate font-medium text-ink">{row.project.name}</span>
                        </Link>
                        <span className={`chip shrink-0 border ${HEALTH_CLASS[row.health]}`}>{HEALTH_LABEL[row.health]}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <ProgressBar value={row.progress} tone={row.overdue > 0 ? 'warning' : 'success'} className="flex-1" />
                        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                            {row.completed}/{row.total}
                            {row.overdue > 0 ? <span className="ml-2 text-state-urgent">{row.overdue} late</span> : null}
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    );
}
