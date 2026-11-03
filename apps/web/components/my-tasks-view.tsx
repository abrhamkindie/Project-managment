'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarCheck, ListChecks } from 'lucide-react';
import { useMyTasks } from '~/lib/hooks';
import { projectPath } from '~/lib/paths';
import type { TaskCardDto } from '~/lib/types';
import { EmptyState, ErrorNote, Skeleton } from './ui';
import { Page, PageHeader } from './page-shell';
import { QuickAdd } from './project/quick-add';
import { TaskRow } from './project/task-list';

/**
 * My Tasks: the one view a person opens every morning.
 *
 * The API returns only open work in active projects, so finishing a card takes it out of the
 * list — which is why the empty state is a success message rather than an apology.
 */
export function MyTasksView({ orgId, slug, viewerId }: { orgId: string; slug: string; viewerId: string }) {
    const router = useRouter();
    const myTasks = useMyTasks(orgId);

    const groups = useMemo(
        () =>
            (myTasks.data?.groups ?? []).map((group) => ({
                ...group,
                tasks: [...group.tasks].sort(byDueDate),
            })),
        [myTasks.data],
    );

    const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    const overdue = groups.reduce((sum, group) => sum + group.tasks.filter((task) => task.isOverdue).length, 0);

    const open = (task: TaskCardDto) => router.push(`${projectPath(slug, task.projectId)}?task=${task.id}`);

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
                            {overdue > 0 ? (
                                <span className="inline-flex items-center gap-1 text-state-urgent">
                                    <CalendarCheck className="h-4 w-4" />
                                    {overdue} overdue
                                </span>
                            ) : null}
                        </span>
                    ) : undefined
                }
            />

            {myTasks.isError ? <ErrorNote error={myTasks.error} /> : null}

            {myTasks.isPending ? (
                <div className="space-y-3">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-24 w-full" />
                </div>
            ) : groups.length === 0 ? (
                <EmptyState
                    icon={<ListChecks className="h-6 w-6" />}
                    title="Nothing is waiting on you"
                    description="Every task assigned to you is done or the projects have no open work. New assignments appear here as soon as they happen."
                />
            ) : (
                <div className="space-y-6">
                    {groups.map((group) => (
                        <section key={group.project.id} className="space-y-1.5">
                            <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.project.color }} aria-hidden />
                                <Link href={projectPath(slug, group.project.id)} className="hover:text-brand-700">
                                    {group.project.name}
                                </Link>
                                <span className="text-xs font-normal text-ink-faint">{group.tasks.length}</span>
                            </h2>

                            <ul className="card divide-y divide-line overflow-hidden">
                                {group.tasks.map((task) => (
                                    <li key={task.id}>
                                        <TaskRow task={task} canEdit onOpen={() => open(task)} />
                                    </li>
                                ))}
                            </ul>

                            <div className="px-1">
                                <QuickAdd orgId={orgId} label="Add task to this project" body={{ projectId: group.project.id, assigneeIds: [viewerId] }} />
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </Page>
    );
}

/** Sooner first; undated work sits at the bottom where it is out of the way. */
function byDueDate(a: TaskCardDto, b: TaskCardDto): number {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
}
