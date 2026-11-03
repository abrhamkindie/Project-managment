'use client';

import Link from 'next/link';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import clsx from 'clsx';
import {
    Activity,
    AlertTriangle,
    CalendarClock,
    CheckCircle2,
    CircleGauge,
    Flag,
    ListChecks,
    ShieldAlert,
    TrendingUp,
    Users,
} from 'lucide-react';
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
import type { AnalyticsQuery, MilestoneRow, ProjectHealthRow, Tally, WorkloadRow } from '~/lib/types';
import { Avatar, Badge, EmptyState, ErrorNote, ProgressBar, Select, Skeleton } from './ui';
import { Page } from './page-shell';

/**
 * The reporting screen: is the team keeping up, and what needs attention today?
 *
 * One request feeds the whole page — `GET /analytics/overview` returns totals, breakdowns,
 * the throughput series, workload and project health together, because splitting them into
 * six queries would make the numbers disagree with each other while they were loading.
 *
 * Layout is a cockpit: a KPI strip up top, then a 3-column grid — the chart and the health
 * table take the wide columns, the composition breakdowns and "needs attention" sit beside them.
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

    const filters = (
        <div className="flex items-center gap-2">
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
        </div>
    );

    if (overview.error) {
        return (
            <Page wide>
                <Toolbar description="Team performance for the selected window." filters={filters} />
                <ErrorNote error={overview.error} />
            </Page>
        );
    }

    if (!overview.data) {
        return (
            <Page wide>
                <Toolbar description="Team performance for the selected window." filters={filters} />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-[86px]" />
                    ))}
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <Skeleton className="h-72 xl:col-span-2" />
                    <Skeleton className="h-72" />
                </div>
            </Page>
        );
    }

    const { totals, throughput, workload, projects, milestones, byStatus, byPriority, window: range } = overview.data;
    const empty = totals.tasks === 0;
    const subtitle = `${new Date(range.from).toLocaleDateString()} – ${new Date(range.to).toLocaleDateString()} · ${range.granularity === 'week' ? 'weekly' : 'daily'} buckets`;

    return (
        <Page wide>
            <Toolbar description={subtitle} filters={filters} />

            {empty ? (
                <EmptyState
                    icon={<CircleGauge className="h-8 w-8" />}
                    title="Nothing to report yet"
                    description="Create a project and assign a few tasks — the numbers above fill in as work moves."
                    action={
                        <Link href={projectsPath(slug)} className="btn btn-primary btn-sm">
                            Go to projects
                        </Link>
                    }
                />
            ) : (
                <div className="space-y-4">
                    {/* KPI strip */}
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Stat label="Open tasks" value={totals.open} hint={`${totals.tasks} total`} tone="brand" icon={ListChecks} />
                        <Stat label="Overdue" value={totals.overdue} hint={`${totals.dueSoon} due soon`} tone={totals.overdue > 0 ? 'danger' : 'neutral'} icon={AlertTriangle} />
                        <Stat label="Completed" value={totals.completed} hint={`${totals.created} created`} tone="success" icon={CheckCircle2} />
                        <Stat label="Completion rate" value={percent(totals.completionRate)} hint={`avg ${formatHours(totals.avgCompletionHours)} to finish`} icon={TrendingUp} />
                    </div>

                    {/* Throughput + needs attention */}
                    <div className="grid gap-4 xl:grid-cols-3">
                        <Panel
                            className="xl:col-span-2"
                            title="Throughput"
                            subtitle="Created vs completed"
                            icon={Activity}
                            action={<Legend />}
                        >
                            <ThroughputChart buckets={throughput} />
                        </Panel>

                        <Panel title="Needs attention" icon={ShieldAlert}>
                            <Attention totals={totals} projects={projects} />
                        </Panel>
                    </div>

                    {/* Composition + workload */}
                    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        <Panel title="Tasks by status" icon={CircleGauge}>
                            <Breakdown rows={byStatus} labelOf={(key) => STATUS_LABEL[key as keyof typeof STATUS_LABEL] ?? key} dot={(key) => STATUS_TOKEN[key as keyof typeof STATUS_TOKEN]} />
                        </Panel>
                        <Panel title="Tasks by priority" icon={Flag}>
                            <Breakdown rows={byPriority} labelOf={(key) => PRIORITY_LABEL[key as keyof typeof PRIORITY_LABEL] ?? key} />
                        </Panel>
                        <Panel title="Workload by person" icon={Users} className="lg:col-span-2 xl:col-span-1">
                            <WorkloadTable rows={workload} />
                        </Panel>
                    </div>

                    {/* Project health + milestones */}
                    <div className="grid gap-4 xl:grid-cols-3">
                        <Panel title="Project health" icon={CircleGauge} className="xl:col-span-2">
                            <ProjectHealthTable rows={projects} slug={slug} />
                        </Panel>
                        <Panel title="Milestones" icon={Flag}>
                            <Milestones rows={milestones} />
                        </Panel>
                    </div>
                </div>
            )}
        </Page>
    );
}

/** Page title + date subtitle on the left, the filter selects on the right. */
function Toolbar({ description, filters }: { description: string; filters: ReactNode }) {
    return (
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
                <p className="mt-0.5 truncate text-sm text-ink-muted">{description}</p>
            </div>
            {filters}
        </header>
    );
}

/** A titled, bordered surface. Every dashboard block shares this frame so the grid stays even. */
function Panel({
    title,
    subtitle,
    icon: Icon,
    action,
    className,
    bodyClassName,
    children,
}: {
    title: string;
    subtitle?: string;
    icon?: ComponentType<{ className?: string }>;
    action?: ReactNode;
    className?: string;
    bodyClassName?: string;
    children: ReactNode;
}) {
    return (
        <section className={clsx('card flex flex-col overflow-hidden', className)}>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                    {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-faint" /> : null}
                    <h2 className="truncate text-sm font-semibold tracking-tight text-ink">{title}</h2>
                    {subtitle ? <span className="hidden truncate text-xs text-ink-faint sm:inline">· {subtitle}</span> : null}
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </header>
            <div className={clsx('flex-1 p-4', bodyClassName)}>{children}</div>
        </section>
    );
}

function Legend() {
    return (
        <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-brand-400" aria-hidden /> Created
            </span>
            <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden /> Completed
            </span>
        </div>
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
    tone?: 'neutral' | 'brand' | 'success' | 'danger';
    icon?: ComponentType<{ className?: string }>;
}) {
    const accent = { neutral: 'text-ink', brand: 'text-ink', success: 'text-ink', danger: 'text-danger' }[tone];
    const tile = {
        neutral: 'bg-subtle text-ink-muted',
        brand: 'bg-brand-50 text-brand-600',
        success: 'bg-green-50 text-green-600',
        danger: 'bg-red-50 text-red-600',
    }[tone];
    return (
        <div className="card flex items-center gap-3 p-4">
            {Icon ? (
                <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tile)}>
                    <Icon className="h-5 w-5" />
                </span>
            ) : null}
            <div className="min-w-0">
                <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
                <p className={clsx('mt-0.5 text-[26px] font-semibold leading-none tabular-nums tracking-tight', accent)}>{value}</p>
                {hint ? <p className="mt-1 truncate text-xs text-ink-muted">{hint}</p> : null}
            </div>
        </div>
    );
}

/** The action-first panel: what is late, what is close, and how many projects are drifting. */
function Attention({ totals, projects }: { totals: { overdue: number; dueSoon: number; open: number }; projects: ProjectHealthRow[] }) {
    const atRisk = projects.filter((row) => row.health === 'at_risk' || row.health === 'off_track').length;
    const rows = [
        { label: 'Overdue', value: totals.overdue, tone: 'danger' as const, icon: AlertTriangle },
        { label: 'Due soon', value: totals.dueSoon, tone: 'warning' as const, icon: CalendarClock },
        { label: 'Projects at risk', value: atRisk, tone: 'brand' as const, icon: ShieldAlert },
        { label: 'Open tasks', value: totals.open, tone: 'neutral' as const, icon: ListChecks },
    ];
    const tileOf = { danger: 'bg-red-50 text-red-600', warning: 'bg-amber-50 text-amber-600', brand: 'bg-brand-50 text-brand-600', neutral: 'bg-subtle text-ink-muted' };

    return (
        <ul className="divide-y divide-line">
            {rows.map(({ label, value, tone, icon: Icon }) => (
                <li key={label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-3 min-w-0">
                        <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tileOf[tone])}>
                            <Icon className="h-4 w-4" />
                        </span>
                        <span className="truncate text-sm text-ink-soft">{label}</span>
                    </span>
                    <span className={clsx('shrink-0 text-lg font-semibold tabular-nums', value > 0 && tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</span>
                </li>
            ))}
        </ul>
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
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip
                        cursor={{ fill: 'rgb(var(--brand-500) / 0.08)' }}
                        contentStyle={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink)', boxShadow: 'var(--shadow-card)' }}
                        labelStyle={{ color: 'var(--ink-muted)' }}
                        labelFormatter={(value) => `Bucket ${value}`}
                    />
                    <Bar dataKey="created" name="Created" fill="var(--brand-400)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="var(--green-500)" radius={[3, 3, 0, 0]} />
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
    if (rows.length === 0) return <p className="text-sm text-ink-muted">Nothing counted yet.</p>;

    return (
        <ul className="space-y-3">
            {rows.map((row) => (
                <li key={row.key} className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                        {dot?.(row.key) ? <span className={`status-dot ${dot(row.key)}`} aria-hidden /> : null}
                        <span className="truncate text-ink-soft">{labelOf(row.key)}</span>
                    </span>
                    <span className="h-2 rounded-full bg-subtle">
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
    if (rows.length === 0) return <p className="text-sm text-ink-muted">No assigned work in this window.</p>;

    return (
        <ul className="divide-y divide-line">
            {rows.map((row) => (
                <li key={row.user.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Avatar user={row.user} size="sm" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                            {row.user.firstName} {row.user.lastName}
                        </span>
                        <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                            <span
                                className={clsx('block h-full rounded-full', row.overdue > 0 ? 'bg-red-500' : 'bg-brand-400')}
                                style={{ width: `${(row.score / max) * 100}%` }}
                            />
                        </span>
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums text-ink-muted">
                        <span className="block text-sm font-semibold text-ink">{row.open}</span>
                        {row.overdue > 0 ? <span className="text-danger">{row.overdue} late</span> : <span className="text-ink-faint">{row.done} done</span>}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ProjectHealthTable({ rows, slug }: { rows: ProjectHealthRow[]; slug: string }) {
    if (rows.length === 0) return <p className="text-sm text-ink-muted">No projects with tasks yet.</p>;

    return (
        <ul className="divide-y divide-line">
            {rows.map((row) => (
                <li key={row.project.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <Link href={projectPath(slug, row.project.id)} className="flex min-w-0 items-center gap-2 hover:underline">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.project.color }} aria-hidden />
                            <span className="truncate font-medium text-ink">{row.project.name}</span>
                        </Link>
                        <span className={clsx('chip shrink-0 border', HEALTH_CLASS[row.health])}>{HEALTH_LABEL[row.health]}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <ProgressBar value={row.progress} tone={row.overdue > 0 ? 'warning' : 'success'} className="flex-1" />
                        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                            {row.completed}/{row.total}
                            {row.overdue > 0 ? <span className="ml-2 text-danger">{row.overdue} late</span> : null}
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function Milestones({ rows }: { rows: MilestoneRow[] }) {
    if (rows.length === 0) return <p className="text-sm text-ink-muted">No milestones in this window. Mark a task as a milestone to track it here.</p>;

    return (
        <ul className="divide-y divide-line">
            {rows.map((milestone) => (
                <li key={milestone.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <Flag className="h-4 w-4 shrink-0 text-brand-500" />
                    <span className="min-w-0 flex-1 truncate">{milestone.title}</span>
                    <span className="hidden text-xs text-ink-faint sm:inline">{milestone.project}</span>
                    <Badge tone={milestone.status === 'done' ? 'success' : milestone.isOverdue ? 'danger' : 'neutral'}>
                        {milestone.isOverdue ? 'Overdue' : STATUS_LABEL[milestone.status]}
                    </Badge>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                        <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                        {dueLabel(milestone.dueDate)}
                    </span>
                </li>
            ))}
        </ul>
    );
}
