import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarDays, Lock, Tag } from 'lucide-react';
import { PRIORITY_CLASS, PRIORITY_LABEL, STATUS_LABEL, STATUS_TOKEN, dayKeyOf } from '~/lib/format';
import type { ShareSnapshot, ShareSnapshotBoardTask, ShareSnapshotTask } from '~/lib/types';
import { Badge } from './ui';

/**
 * The public share page's body: one read-only render of a snapshot, with no interactive parts.
 *
 * It is a server component on purpose. Everything a stranger is allowed to see is already in the
 * payload the API projects field by field (`services/share.service.ts`), so this file needs no
 * client state, no query cache and no session — and nothing here can reach a route the token
 * does not already cover.
 */

const tasksInSection = (tasks: ShareSnapshotBoardTask[], sectionId: string | null) =>
    tasks.filter((task) => task.sectionId === sectionId);

export function ShareView({ snapshot }: { snapshot: ShareSnapshot }) {
    const project = snapshot.project;
    const title = snapshot.kind === 'task' ? snapshot.task.title : project.name;

    return (
        <main className="min-h-screen bg-canvas">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-4">
                    <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white" aria-hidden>
                            Z
                        </span>
                        ZORQEN
                    </Link>
                    <span className="h-4 w-px bg-line" aria-hidden />
                    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Lock className="h-3.5 w-3.5" />
                        Shared read-only
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
                        {project.name}
                    </span>
                </div>
            </header>

            <div className="mx-auto max-w-6xl px-5 py-8">
                <h1 className="text-2xl font-semibold tracking-tight text-ink text-balance">{title}</h1>
                {snapshot.kind === 'project' && snapshot.project.description ? (
                    <p className="mt-2 max-w-2xl text-sm text-ink-muted">{snapshot.project.description}</p>
                ) : null}

                <div className="mt-6">
                    {snapshot.kind === 'task' ? <SharedTask task={snapshot.task} /> : <SharedBoard snapshot={snapshot} />}
                </div>

                <p className="mt-10 text-xs text-ink-faint">
                    You are looking at a snapshot. Comments, files and history are not part of a shared link.{' '}
                    <Link href="/login" className="link">
                        Sign in
                    </Link>{' '}
                    to work on it.
                </p>
            </div>
        </main>
    );
}

function SharedTask({ task }: { task: ShareSnapshotTask }) {
    return (
        <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_TOKEN[task.status]}`} aria-hidden />
                <span className="text-sm text-ink-soft">{STATUS_LABEL[task.status]}</span>
                <span className={PRIORITY_CLASS[task.priority]}>{PRIORITY_LABEL[task.priority]}</span>
                {task.kind === 'epic' ? <Badge tone="brand">Epic</Badge> : null}
                {task.isMilestone ? <Badge>Milestone</Badge> : null}
                {task.subtaskCount > 0 ? <Badge tone="neutral">{task.subtaskCount} subtasks</Badge> : null}
            </div>

            {task.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{task.description}</p>
            ) : (
                <p className="text-sm text-ink-faint">No description.</p>
            )}

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Starts">{toDate(task.startDate)}</Field>
                <Field label="Due">{toDate(task.dueDate)}</Field>
                <Field label="Estimate">{task.estimateMins ? `${task.estimateMins} min` : '—'}</Field>
                <Field label="Completed">{toDate(task.completedAt)}</Field>
                <Field label="Assignees">
                    {task.assignees.length ? task.assignees.map((person) => person.name).join(', ') : 'Unassigned'}
                </Field>
                <Field label="Labels">
                    {task.labels.length ? (
                        <span className="flex flex-wrap gap-1.5">
                            {task.labels.map((label) => (
                                <span key={label.id} className="chip" style={{ backgroundColor: `${label.color}1a`, color: label.color }}>
                                    <Tag className="mr-1 h-3 w-3" />
                                    {label.name}
                                </span>
                            ))}
                        </span>
                    ) : (
                        '—'
                    )}
                </Field>
            </dl>
        </div>
    );
}

function SharedBoard({ snapshot }: { snapshot: Extract<ShareSnapshot, { kind: 'project' }> }) {
    const { sections, tasks } = snapshot;
    // A section-less task is a backlog row in every view of this project, so it gets a column here
    // too rather than silently disappearing from a page whose whole job is to show everything.
    const columns = [...sections.map((section) => ({ id: section.id, name: section.name })), { id: null, name: 'Backlog' }];

    if (snapshot.project.truncated) {
        return (
            <p className="card p-4 text-sm text-ink-muted">
                This project is larger than a share snapshot holds, so the board is not shown. Ask for the project to be shared as a
                report, or open it in ZORQEN.
            </p>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {columns.map((column) => {
                const rows = tasksInSection(tasks, column.id);
                if (!rows.length) return null;
                return (
                    <section key={column.id ?? 'backlog'} className="card p-3">
                        <header className="mb-2 flex items-center justify-between px-1">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{column.name}</h2>
                            <span className="text-xs text-ink-faint">{rows.length}</span>
                        </header>
                        <ul className="space-y-1.5">
                            {rows.map((task) => (
                                <SharedRow key={task.id} task={task} />
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

function SharedRow({ task }: { task: ShareSnapshotBoardTask }) {
    return (
        <li className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="flex items-start gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_TOKEN[task.status]}`} aria-hidden />
                <span className="min-w-0 flex-1 text-sm text-ink">{task.title}</span>
                {task.isMilestone ? <Badge>Milestone</Badge> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <span className={PRIORITY_CLASS[task.priority]}>{PRIORITY_LABEL[task.priority]}</span>
                {task.dueDate ? (
                    <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {toDate(task.dueDate)}
                    </span>
                ) : null}
                {task.assignees.length ? <span>{task.assignees.join(', ')}</span> : <span>Unassigned</span>}
            </div>
        </li>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
            <dd className="mt-1 text-ink-soft">{children}</dd>
        </div>
    );
}

/** A shared page shows calendar days only: no visitor needs a workspace's clock on a public link. */
function toDate(value: string | null): string {
    return dayKeyOf(value) ?? '—';
}
