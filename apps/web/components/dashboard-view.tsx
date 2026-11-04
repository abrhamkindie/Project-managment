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
    AlertTriangle,
    CalendarClock,
    CheckCircle2,
    CircleGauge,
    Flag,
    ListChecks,
    ShieldAlert,
    TrendingUp,
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
import { Page, PageHeader } from './page-shell';

/**
 * Workspace reporting screen.
 *
 * Layout follows a 3-layer hierarchy (status → diagnosis → action):
 *   1. KPI ribbon — 5-second health check
 *   2. Throughput + attention — why, and what to triage
 *   3. Portfolio tables — project health, people, milestones
 */

const WINDOWS = [
    { days: 7, label: 'Last 7 days' },
    { days: 30, label: 'Last 30 days' },
    { days: 90, label: 'Last 90 days' },
] as const;

export function DashboardView({ orgId, slug }: { orgId: string; slug: string }) {
    const [days, setDays] = useState<number>(30);
    const [teamId, setTeamId] = useState<string>('');

    const query = useMemo<AnalyticsQuery>(() => {
        // Snap to UTC midnight so the server's SSR memo and the client's hydration memo agree on
        // `from`. A raw `Date.now()` differs by seconds between the two and would give React Query
        // two different cache keys, forcing a wasted refetch on every navigation.
        const dayMs = 86_400_000;
        const todayUtc = Math.floor(Date.now() / dayMs) * dayMs;
        const from = new Date(todayUtc - days * dayMs).toISOString();
        return { from, granularity: days > 45 ? 'week' : 'day', ...(teamId ? { teamId } : {}) };
    }, [days, teamId]);

    const overview = useOverview(orgId, query);
    const teams = useTeams(orgId);

    const filters = (
        <div className="flex flex-wrap items-center gap-2">
            {teams.data?.length ? (
                <Select value={teamId} onChange={(event) => setTeamId(event.target.value)} aria-label="Filter by team" className="w-auto min-w-[9rem]">
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
            <Page wide className="pb-10">
                <PageHeader title="Dashboard" description="Team performance for the selected window." actions={filters} />
                <ErrorNote error={overview.error} />
            </Page>
        );
    }

    if (!overview.data) {
        return (
            <Page wide className="pb-10">
                <PageHeader title="Dashboard" description="Loading workspace metrics…" actions={filters} />
                <div className="card overflow-hidden">
                    <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                        {Array.from({ length: 4 }, (_, index) => (
                            <div key={index} className="p-5">
                                <Skeleton className="h-16" />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="mt-6 grid gap-4 xl:grid-cols-3">
                    <Skeleton className="h-80 xl:col-span-2" />
                    <Skeleton className="h-80" />
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <Skeleton className="h-64 xl:col-span-2" />
                    <Skeleton className="h-64" />
                </div>
            </Page>
        );
    }

    const { totals, throughput, workload, projects, milestones, byStatus, byPriority, window: range } = overview.data;
    const empty = totals.tasks === 0;
    const subtitle = `${new Date(range.from).toLocaleDateString()} – ${new Date(range.to).toLocaleDateString()} · ${range.granularity === 'week' ? 'Weekly' : 'Daily'} view`;

    return (
        <Page wide className="pb-10">
            <PageHeader title="Dashboard" description={subtitle} actions={filters} />

            {empty ? (
                <EmptyState
                    icon={<CircleGauge className="h-8 w-8" />}
                    title="Nothing to report yet"
                    description="Create a project and assign a few tasks — metrics fill in as work moves."
                    action={
                        <Link href={projectsPath(slug)} className="btn btn-primary btn-sm">
                            Go to projects
                        </Link>
                    }
                />
            ) : (
                <div className="space-y-8 animate-fade-in">
                    {/* Layer 1 — KPI ribbon */}
                    <section aria-label="Key metrics">
                        <div className="card overflow-hidden">
                            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                                <Stat
                                    label="Open tasks"
                                    value={totals.open}
                                    hint={`${totals.tasks} total`}
                                    icon={ListChecks}
                                />
                                <Stat
                                    label="Overdue"
                                    value={totals.overdue}
                                    hint={`${totals.dueSoon} due soon`}
                                    tone={totals.overdue > 0 ? 'danger' : 'neutral'}
                                    icon={AlertTriangle}
                                />
                                <Stat
                                    label="Completed"
                                    value={totals.completed}
                                    hint={`${totals.created} created in window`}
                                    tone="success"
                                    icon={CheckCircle2}
                                />
                                <Stat
                                    label="Completion rate"
                                    value={percent(totals.completionRate)}
                                    hint={`avg ${formatHours(totals.avgCompletionHours)} to finish`}
                                    icon={TrendingUp}
                                />
                            </div>
                        </div>
                    </section>

                    {/* Layer 2 — diagnosis */}
                    <section className="space-y-3" aria-label="Delivery">
                        <SectionLabel>Delivery</SectionLabel>
                        <div className="grid gap-4 xl:grid-cols-5">
                            <Panel className="xl:col-span-3" title="Throughput" subtitle="Created vs completed" action={<Legend />}>
                                <ThroughputChart buckets={throughput} />
                            </Panel>

                            <Panel className="xl:col-span-2" title="Needs attention" subtitle="Act on these first">
                                <Attention totals={totals} projects={projects} />
                            </Panel>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <Panel title="By status">
                                <Breakdown
                                    rows={byStatus}
                                    labelOf={(key) => STATUS_LABEL[key as keyof typeof STATUS_LABEL] ?? key}
                                    dot={(key) => STATUS_TOKEN[key as keyof typeof STATUS_TOKEN]}
                                />
                            </Panel>
                            <Panel title="By priority">
                                <Breakdown rows={byPriority} labelOf={(key) => PRIORITY_LABEL[key as keyof typeof PRIORITY_LABEL] ?? key} />
                            </Panel>
                        </div>
                    </section>

                    {/* Layer 3 — portfolio detail */}
                    <section className="space-y-3" aria-label="Portfolio">
                        <SectionLabel>Portfolio</SectionLabel>
                        <div className="grid gap-4 xl:grid-cols-5">
                            <Panel className="xl:col-span-3" title="Project health">
                                <ProjectHealthTable rows={projects} slug={slug} />
                            </Panel>
                            <div className="grid gap-4 xl:col-span-2">
                                <Panel title="Workload">
                                    <WorkloadTable rows={workload} />
                                </Panel>
                                <Panel title="Milestones">
                                    <Milestones rows={milestones} />
                                </Panel>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </Page>
    );
}

function SectionLabel({ children }: { children: ReactNode }) {
    return <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{children}</h2>;
}

function Panel({
    title,
    subtitle,
    action,
    className,
    children,
}: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section className={clsx('card flex flex-col overflow-hidden', className)}>
            <header className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
                    {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
                </div>
                {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
            </header>
            <div className="flex-1 px-5 pb-5 pt-3">{children}</div>
        </section>
    );
}

function Legend() {
    return (
        <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-brand-400" aria-hidden /> Created
            </span>
            <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-green-500" aria-hidden /> Completed
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
    tone?: 'neutral' | 'success' | 'danger';
    icon?: ComponentType<{ className?: string }>;
}) {
    const valueTone = {
        neutral: 'text-ink',
        success: 'text-ink',
        danger: 'text-danger',
    }[tone];
    const iconTone = {
        neutral: 'text-ink-faint',
        success: 'text-green-600',
        danger: 'text-danger',
    }[tone];

    return (
        <div className="relative px-5 py-5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-muted">{label}</p>
                {Icon ? <Icon className={clsx('h-3.5 w-3.5 shrink-0', iconTone)} aria-hidden /> : null}
            </div>
            <p className={clsx('mt-2 text-3xl font-semibold leading-none tracking-tight tabular-nums', valueTone)}>{value}</p>
            {hint ? <p className="mt-2 truncate text-xs text-ink-faint">{hint}</p> : null}
        </div>
    );
}

function Attention({ totals, projects }: { totals: { overdue: number; dueSoon: number; open: number }; projects: ProjectHealthRow[] }) {
    const atRisk = projects.filter((row) => row.health === 'at_risk' || row.health === 'off_track').length;
    const rows = [
        { label: 'Overdue tasks', value: totals.overdue, tone: 'danger' as const, icon: AlertTriangle, detail: 'Past due date' },
        { label: 'Due soon', value: totals.dueSoon, tone: 'warning' as const, icon: CalendarClock, detail: 'Next few days' },
        { label: 'Projects at risk', value: atRisk, tone: 'brand' as const, icon: ShieldAlert, detail: 'Health off track' },
        { label: 'Open tasks', value: totals.open, tone: 'neutral' as const, icon: ListChecks, detail: 'Still in progress' },
    ];
    const rail = {
        danger: 'bg-red-500',
        warning: 'bg-amber-500',
        brand: 'bg-brand-500',
        neutral: 'bg-line-strong',
    };
    const valueTone = {
        danger: 'text-danger',
        warning: 'text-amber-700 dark:text-amber-500',
        brand: 'text-ink',
        neutral: 'text-ink',
    };

    return (
        <ul className="space-y-2">
            {rows.map(({ label, value, tone, icon: Icon, detail }) => (
                <li
                    key={label}
                    className={clsx(
                        'relative flex items-center gap-3 overflow-hidden rounded-lg border border-line bg-canvas/60 px-3 py-3',
                        value > 0 && tone === 'danger' && 'border-red-200 bg-red-50/50 dark:border-red-200/20 dark:bg-red-50/40',
                    )}
                >
                    <span className={clsx('absolute inset-y-0 left-0 w-0.5', rail[tone])} aria-hidden />
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-ink-muted shadow-sm ring-1 ring-line">
                        <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{label}</span>
                        <span className="block truncate text-xs text-ink-faint">{detail}</span>
                    </span>
                    <span className={clsx('shrink-0 text-xl font-semibold tabular-nums tracking-tight', value > 0 ? valueTone[tone] : 'text-ink-faint')}>
                        {value}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ThroughputChart({ buckets }: { buckets: { bucket: string; created: number; completed: number }[] }) {
    const data = buckets.map((row) => ({ ...row, label: row.bucket.length > 8 ? row.bucket.slice(5) : row.bucket }));

    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barGap={3} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                        cursor={{ fill: 'rgb(var(--brand-500) / 0.06)' }}
                        contentStyle={{
                            background: 'rgb(var(--surface))',
                            borderRadius: 10,
                            border: '1px solid rgb(var(--line))',
                            fontSize: 12,
                            color: 'rgb(var(--ink))',
                            boxShadow: 'var(--shadow-card)',
                        }}
                        labelStyle={{ color: 'rgb(var(--ink-muted))' }}
                        labelFormatter={(value) => `Bucket ${value}`}
                    />
                    <Bar dataKey="created" name="Created" fill="rgb(var(--brand-400))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="completed" name="Completed" fill="rgb(var(--green-500))" radius={[4, 4, 0, 0]} maxBarSize={28} />
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
        <ul className="space-y-3.5">
            {rows.map((row) => (
                <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                        {dot?.(row.key) ? <span className={`status-dot ${dot(row.key)}`} aria-hidden /> : null}
                        <span className="truncate text-ink-soft">{labelOf(row.key)}</span>
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
                        <span className="block h-full rounded-full bg-brand-400/90" style={{ width: `${(row.count / max) * 100}%` }} />
                    </span>
                    <span className="min-w-[3.25rem] text-right tabular-nums text-ink-muted">
                        <span className="font-medium text-ink">{row.count}</span>
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
                        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-subtle">
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
                <li key={row.project.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <Link href={projectPath(slug, row.project.id)} className="flex min-w-0 items-center gap-2.5 font-medium text-ink hover:text-brand-700">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.project.color }} aria-hidden />
                            <span className="truncate">{row.project.name}</span>
                        </Link>
                        <span className={clsx('chip shrink-0 border', HEALTH_CLASS[row.health])}>{HEALTH_LABEL[row.health]}</span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-3">
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
    if (rows.length === 0) {
        return <p className="text-sm text-ink-muted">No milestones in this window. Mark a task as a milestone to track it here.</p>;
    }

    return (
        <ul className="divide-y divide-line">
            {rows.map((milestone) => (
                <li key={milestone.id} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{milestone.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                            <span className="truncate">{milestone.project}</span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                                <CalendarClock className="h-3 w-3" />
                                {dueLabel(milestone.dueDate)}
                            </span>
                        </span>
                    </span>
                    <Badge tone={milestone.status === 'done' ? 'success' : milestone.isOverdue ? 'danger' : 'neutral'}>
                        {milestone.isOverdue ? 'Overdue' : STATUS_LABEL[milestone.status]}
                    </Badge>
                </li>
            ))}
        </ul>
    );
}
