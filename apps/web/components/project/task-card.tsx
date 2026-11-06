'use client';

import { CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock, Flag, ListTree, MessageSquare, Paperclip } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { DUE_CLASS, PRIORITY_CLASS, PRIORITY_LABEL, STATUS_LABEL, STATUS_TOKEN, dueLabel, dueTone, formatMins } from '~/lib/format';
import type { TaskCardDto } from '~/lib/types';
import { AvatarStack } from '../ui';
import { FieldChips } from './fields';

/**
 * The task card, as it appears on the board and in the list.
 *
 * It shows what a reader decides from at a glance — who owns it, whether it is late, how much
 * discussion it has — and nothing that requires a second look-up.
 *
 * On the board, subtasks nest inside their parent through the `depth` prop. A child card gets an
 * indent, a vertical rail on the left, and a short horizontal tick connecting it to the parent,
 * so a column of mixed parents and children still reads as a tree.
 */
export function TaskCard({
    task,
    onOpen,
    draggable = false,
    overlay = false,
    selected = false,
    depth = 0,
    hasVisibleChildren = false,
    childCount = 0,
    expanded = false,
    onToggleExpand,
    selectable = false,
    checked = false,
    onToggleSelect,
}: {
    task: TaskCardDto;
    onOpen: (taskId: string) => void;
    draggable?: boolean;
    overlay?: boolean;
    /** The drawer is open on this card — ring it and make sure it is on screen. */
    selected?: boolean;
    /** 0 for root cards; increments for each level of nesting. */
    depth?: number;
    /** Whether the parent's subtasks are in this same column (only then can it be toggled). */
    hasVisibleChildren?: boolean;
    /** How many subtasks live here — used in the aria-label so screen readers announce the state. */
    childCount?: number;
    expanded?: boolean;
    onToggleExpand?: () => void;
    /** Bulk mode: show the checkbox and make a click toggle instead of opening the drawer. */
    selectable?: boolean;
    checked?: boolean;
    onToggleSelect?: (taskId: string) => void;
}) {
    const sortable = useSortable({ id: task.id, disabled: !draggable });
    const tone = dueTone(task.dueDate, task.status, task.isOverdue);

    // Keep our own handle to the node so we can scroll it into view; when draggable, dnd-kit also
    // needs the same element, so the two refs are composed here rather than fighting over it.
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const setRefs = (el: HTMLDivElement | null) => {
        nodeRef.current = el;
        if (draggable) sortable.setNodeRef(el);
    };

    // When this card becomes the open one, bring it into view (nearest, so a card already on screen
    // does not jump) — the drawer covers the right edge, so scroll horizontally too.
    useEffect(() => {
        if (selected) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, [selected]);

    const style = draggable && !selectable
        ? { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
        : undefined;

    // In bulk mode the card is a checkbox, not a link: opening a drawer per card while somebody
    // is clicking down a list of them would leave a wall of drawers stacked behind the bar.
    const activate = () => (selectable ? onToggleSelect?.(task.id) : onOpen(task.id));

    const card = (
        <div
            ref={draggable ? setRefs : nodeRef}
            style={style}
            {...(draggable ? sortable.attributes : {})}
            {...(draggable ? sortable.listeners : {})}
            onClick={activate}
            data-task-card={task.id}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') activate();
            }}
            role="button"
            tabIndex={0}
            aria-current={selected ? 'true' : undefined}
            aria-pressed={selectable ? checked : undefined}
            aria-label={`${selectable ? (checked ? 'Deselect' : 'Select') : 'Open'} task ${task.title}`}
            className={clsx(
                overlay ? 'board-card-ghost' : selected ? 'board-card-selected' : 'board-card',
                draggable && sortable.isDragging && 'opacity-40',
                selectable && 'cursor-default',
                checked && 'ring-2 ring-brand-400',
            )}
        >
            <p className="flex items-start gap-1.5 text-sm font-medium text-ink">
                {selectable ? (
                    // The pointer must not reach dnd-kit's sensor, or the first click of a bulk
                    // selection would look like the start of a drag.
                    <span
                        className="mt-0.5 shrink-0"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={checked}
                            onChange={() => onToggleSelect?.(task.id)}
                            aria-label={`Select ${task.title}`}
                            tabIndex={-1}
                        />
                    </span>
                ) : null}
                {task.status === 'done' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-done" /> : null}
                {task.isMilestone ? <Flag className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> : null}
                {task.kind === 'epic' ? (
                    <span className="mt-0.5 inline-flex shrink-0 items-center rounded bg-brand-500/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-600" title="Epic">
                        Epic
                    </span>
                ) : null}
                <span className={clsx('min-w-0 flex-1', task.status === 'done' && 'text-ink-muted line-through', task.parentTaskId && !expanded && 'text-ink-soft')}>{task.title}</span>
            </p>

            {task.kind === 'epic' && task.epicProgress && task.epicProgress.total > 0 ? (
                <div className="mt-2 flex items-center gap-2" title={`${task.epicProgress.done} of ${task.epicProgress.total} child tasks done`}>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                        <div
                            className="h-full rounded-full bg-brand-500 transition-all"
                            style={{ width: `${Math.round((task.epicProgress.done / task.epicProgress.total) * 100)}%` }}
                        />
                    </div>
                    <span className="tabular-nums text-[11px] text-ink-faint">
                        {task.epicProgress.done}/{task.epicProgress.total}
                    </span>
                </div>
            ) : null}

            {task.labels.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                    {task.labels.map((label) => (
                        <li key={label.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${label.color}1a`, color: label.color }}>
                            {label.name}
                        </li>
                    ))}
                </ul>
            ) : null}

            {/* Custom-field values (Phase 6). Two at most: a card is scanned, not read, and the
                drawer below it holds the rest. */}
            <FieldChips task={task} />

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
                {/* Creation-order label inside the project. Display only: it is renumbered when a
                    task is deleted, so it is never used as a key or in a link. */}
                {task.number !== null ? (
                    <span className="tabular-nums text-ink-faint" title="Position in this project (display only)">
                        #{task.number}
                    </span>
                ) : null}
                <span className={clsx('inline-flex items-center gap-1', DUE_CLASS[tone])}>
                    <CalendarDays className="h-3.5 w-3.5" />
                    {dueLabel(task.dueDate)}
                </span>

                {task.priority !== 'none' ? (
                    <span className={clsx('inline-flex items-center gap-1 font-medium', PRIORITY_CLASS[task.priority])}>{PRIORITY_LABEL[task.priority]}</span>
                ) : null}

                {/* Logged time only earns a slot once there is some. Turns red past the estimate, which is
                    the one number on the card that says "this is taking longer than we thought". */}
                {task.loggedMins ? (
                    <span
                        className={clsx(
                            'inline-flex items-center gap-1 tabular-nums',
                            task.estimateMins && task.loggedMins > task.estimateMins ? 'text-danger' : 'text-ink-faint',
                        )}
                        title={
                            task.estimateMins
                                ? `${formatMins(task.loggedMins)} logged of ${formatMins(task.estimateMins)} estimated`
                                : `${formatMins(task.loggedMins)} logged`
                        }
                    >
                        <Clock className="h-3.5 w-3.5" />
                        {formatMins(task.loggedMins)}
                    </span>
                ) : null}

                <span className="inline-flex items-center gap-2 text-ink-faint">
                    {task.commentCount > 0 ? (
                        <span className="inline-flex items-center gap-1" title={`${task.commentCount} comments`}>
                            <MessageSquare className="h-3.5 w-3.5" />
                            {task.commentCount}
                        </span>
                    ) : null}
                    {task.attachments.length > 0 ? (
                        <span className="inline-flex items-center gap-1" title={`${task.attachments.length} attachments`}>
                            <Paperclip className="h-3.5 w-3.5" />
                            {task.attachments.length}
                        </span>
                    ) : null}
                    {task.subtaskCount > 0 ? (
                        hasVisibleChildren ? (
                            <button
                                type="button"
                                onClick={(event) => {
                                    // The card root is `role=button` for open-on-click; without
                                    // stopPropagation the same click would also fire the drawer.
                                    event.stopPropagation();
                                    onToggleExpand?.();
                                }}
                                aria-expanded={expanded}
                                aria-label={expanded ? `Collapse ${childCount} subtask${childCount === 1 ? '' : 's'}` : `Expand ${childCount} subtask${childCount === 1 ? '' : 's'}`}
                                title={expanded ? 'Hide subtasks' : 'Show subtasks'}
                                className={clsx(
                                    'inline-flex items-center gap-1 rounded px-1 tabular-nums transition',
                                    expanded ? 'bg-subtle text-ink' : 'hover:bg-subtle hover:text-ink',
                                )}
                            >
                                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                <ListTree className="h-3.5 w-3.5" />
                                {childCount}
                            </button>
                        ) : (
                            // Subtasks exist but none are in this column (filtered out, or moved to
                            // another section). Non-interactive so we don't imply an empty toggle.
                            <span className="inline-flex items-center gap-1" title={`${task.subtaskCount} subtask${task.subtaskCount === 1 ? '' : 's'} elsewhere`}>
                                <ListTree className="h-3.5 w-3.5" />
                                {task.subtaskCount}
                            </span>
                        )
                    ) : null}
                </span>

                <span className="ml-auto flex items-center gap-2">
                    <span className={clsx('status-dot', STATUS_TOKEN[task.status])} title={STATUS_LABEL[task.status]} />
                    <AvatarStack users={task.assignees} max={3} />
                </span>
            </div>
        </div>
    );

    if (depth === 0) return card;

    return (
        <div className="relative ml-6 border-l border-line pl-3">
            {/* Horizontal tick connecting the child to the parent's rail. Aligned with the top of
                the card body so it visually hangs off the rail, not off the card border. */}
            <span className="absolute -left-3 top-4 h-px w-2 bg-line" aria-hidden />
            {card}
        </div>
    );
}
