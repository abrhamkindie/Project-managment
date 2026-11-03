'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { CalendarDays, CheckCircle2, Flag, ListTree, MessageSquare, Paperclip } from 'lucide-react';
import { DUE_CLASS, PRIORITY_CLASS, PRIORITY_LABEL, STATUS_LABEL, STATUS_TOKEN, dueLabel, dueTone } from '~/lib/format';
import { useUpdateTask } from '~/lib/hooks';
import type { BoardDto, TaskCardDto } from '~/lib/types';
import { AvatarStack } from '../ui';
import { QuickAdd } from './quick-add';

/**
 * The list view of a project.
 *
 * It reads the same board cache as the Kanban — grouped by column, ordered by position — so the
 * two views can never disagree about who owns what, and switching between them is free.
 */
export function TaskList({
    orgId,
    projectId,
    board,
    canEdit,
    onOpen,
    selectedTaskId = null,
}: {
    orgId: string;
    projectId: string;
    board: BoardDto;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    /** The task whose drawer is open, so its row can be highlighted and scrolled into view. */
    selectedTaskId?: string | null;
}) {
    const groups = board.sections.map((section) => ({ key: section.id, name: section.name, tasks: section.tasks, isDone: section.isDone }));
    if (board.unassigned.length > 0) groups.push({ key: 'unassigned', name: 'No column', tasks: board.unassigned, isDone: false });

    return (
        <div className="space-y-5">
            {groups.map((group) => (
                <section key={group.key} className="space-y-1">
                    <h2 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {group.name}
                        <span className="text-ink-faint">{group.tasks.length}</span>
                        {group.isDone ? <CheckCircle2 className="h-3.5 w-3.5 text-state-done" /> : null}
                    </h2>

                    <ul className="card divide-y divide-line overflow-hidden">
                        {group.tasks.length === 0 ? <li className="px-3 py-3 text-sm text-ink-faint">No tasks in this column.</li> : null}
                        {group.tasks.map((task) => (
                            <li key={task.id}>
                                <TaskRow task={task} canEdit={canEdit} onOpen={onOpen} selected={task.id === selectedTaskId} />
                            </li>
                        ))}
                    </ul>

                    {canEdit && group.key !== 'unassigned' ? (
                        <div className="px-1">
                            <QuickAdd orgId={orgId} label="Add task" body={{ projectId, sectionId: group.key, status: group.isDone ? 'done' : 'todo' }} />
                        </div>
                    ) : null}
                </section>
            ))}
        </div>
    );
}

/** One row: complete it, open it, see who owns it. Reused by My Tasks. */
export function TaskRow({ task, canEdit, onOpen, selected = false }: { task: TaskCardDto; canEdit: boolean; onOpen: (taskId: string) => void; selected?: boolean }) {
    const update = useUpdateTask();
    const tone = dueTone(task.dueDate, task.status, task.isOverdue);
    const done = task.status === 'done' || task.status === 'canceled';

    const rowRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [selected]);

    return (
        <div
            ref={rowRef}
            aria-current={selected ? 'true' : undefined}
            className={clsx('flex items-center gap-3 border-l-2 px-3 py-2.5 transition', selected ? 'border-l-brand-500 bg-brand-50' : 'border-l-transparent hover:bg-canvas')}
        >
            <button
                type="button"
                disabled={!canEdit}
                aria-label={done ? 'Reopen task' : 'Mark task done'}
                className={clsx(
                    'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] transition',
                    done ? 'border-state-done bg-state-done text-white' : 'border-line hover:border-brand-300',
                )}
                onClick={() => update.mutate({ taskId: task.id, patch: { status: done ? 'in_progress' : 'done' } })}
            >
                {done ? '✓' : ''}
            </button>

            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(task.id)}>
                <p className={clsx('truncate text-sm font-medium', done ? 'text-ink-faint line-through' : 'text-ink')}>
                    {task.isMilestone ? <Flag className="mr-1.5 inline h-3.5 w-3.5 text-brand-500" /> : null}
                    {task.title}
                </p>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                    <span className={clsx('inline-flex items-center gap-1', DUE_CLASS[tone])}>
                        <CalendarDays className="h-3.5 w-3.5" />
                        {dueLabel(task.dueDate)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className={clsx('status-dot', STATUS_TOKEN[task.status])} aria-hidden />
                        {STATUS_LABEL[task.status]}
                    </span>
                    {task.priority !== 'none' ? <span className={clsx('font-medium', PRIORITY_CLASS[task.priority])}>{PRIORITY_LABEL[task.priority]}</span> : null}
                    {task.labels.map((label) => (
                        <span key={label.id} className="rounded-full px-1.5 py-0.5 font-medium" style={{ backgroundColor: `${label.color}1a`, color: label.color }}>
                            {label.name}
                        </span>
                    ))}
                    {task.commentCount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                            <MessageSquare className="h-3.5 w-3.5" />
                            {task.commentCount}
                        </span>
                    ) : null}
                    {task.attachments.length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                            <Paperclip className="h-3.5 w-3.5" />
                            {task.attachments.length}
                        </span>
                    ) : null}
                    {task.subtaskCount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                            <ListTree className="h-3.5 w-3.5" />
                            {task.subtaskCount}
                        </span>
                    ) : null}
                </div>
            </button>

            <AvatarStack users={task.assignees} max={3} />
        </div>
    );
}
