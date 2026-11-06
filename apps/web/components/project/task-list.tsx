'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
    CalendarDays,
    ChevronDown,
    ChevronRight,
    Flag,
    ListTree,
    MessageSquare,
    Paperclip,
} from 'lucide-react';
import {
    DUE_CLASS,
    PRIORITY_BORDER,
    PRIORITY_CLASS,
    PRIORITY_LABEL,
    dueLabel,
    dueTone,
} from '~/lib/format';
import { useUpdateTask } from '~/lib/hooks';
import type { BoardDto, CustomFieldDto, TaskCardDto } from '~/lib/types';
import { AvatarStack } from '../ui';
import { QuickAdd } from './quick-add';
import { fieldValueOf, useCustomFieldList } from './fields';

/**
 * List view of a project.
 *
 * Rows are single-line and read as: [expand?] [toggle] title … [meta icons right]. Subtasks nest
 * under their parent with a chevron and a drawn connector rail, so a task with three children
 * reads as a small tree rather than four siblings who happen to look alike.
 *
 * The section header carries the status meaning (list is grouped by column, and columns map to
 * statuses on the board), so per-row status dots are dropped. Priority tints the left border
 * instead of consuming a chip slot.
 *
 * `columnIds` turns custom fields into real columns: each one gets a fixed-width cell at the right of
 * every row. They are opt-in because a row is one line, and six fields would push the title off the
 * screen — which is exactly the trade the columns menu is there to let a reader make.
 */
export function TaskList({
    orgId,
    projectId,
    board,
    canEdit,
    onOpen,
    selectedTaskId = null,
    selectable = false,
    selectedIds,
    onToggleSelect,
    onToggleMany,
    columnIds = [],
}: {
    orgId: string;
    projectId: string;
    board: BoardDto;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    /** The task whose drawer is open, so its row can be highlighted and scrolled into view. */
    selectedTaskId?: string | null;
    /** Bulk mode: rows get a checkbox and clicking one selects instead of opening the drawer. */
    selectable?: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (taskId: string) => void;
    onToggleMany?: (taskIds: string[], selected: boolean) => void;
    /** Custom-field ids to show as columns, in the order the picker listed them. */
    columnIds?: string[];
}) {
    const definitions = useCustomFieldList();
    // Definition order, not the order they were ticked: a stable column order survives re-ticking.
    const columns = useMemo(
        () => definitions.filter((field) => columnIds.includes(field.id)),
        [definitions, columnIds],
    );

    const groups = useMemo(() => {
        const out = board.sections.map((section) => ({
            key: section.id,
            name: section.name,
            tasks: section.tasks,
            isDone: section.isDone,
            total: section.total,
            truncated: section.truncated,
        }));
        if (board.unassigned.length > 0) {
            out.push({ key: 'unassigned', name: 'No column', tasks: board.unassigned, isDone: false, total: board.unassigned.length, truncated: false });
        }
        return out;
    }, [board]);

    return (
        <div className="space-y-4">
            {groups.map((group) => (
                <SectionGroup
                    key={group.key}
                    group={group}
                    orgId={orgId}
                    projectId={projectId}
                    canEdit={canEdit}
                    onOpen={onOpen}
                    selectedTaskId={selectedTaskId}
                    selectable={selectable}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleMany={onToggleMany}
                    columns={columns}
                />
            ))}
        </div>
    );
}

interface TreeNode {
    task: TaskCardDto;
    children: TreeNode[];
}

/**
 * Turn a flat list of tasks into a forest keyed by `parentTaskId`.
 * If a subtask's parent isn't in the same set (e.g. filtered out, or in a different section), the
 * subtask surfaces as a root — nothing is ever lost by nesting.
 */
function buildTree(tasks: TaskCardDto[]): TreeNode[] {
    const nodes = new Map<string, TreeNode>();
    for (const task of tasks) nodes.set(task.id, { task, children: [] });
    const roots: TreeNode[] = [];
    for (const node of nodes.values()) {
        const parent = node.task.parentTaskId ? nodes.get(node.task.parentTaskId) : null;
        if (parent && parent !== node) parent.children.push(node);
        else roots.push(node);
    }
    return roots;
}

function SectionGroup({
    group,
    orgId,
    projectId,
    canEdit,
    onOpen,
    selectedTaskId,
    selectable,
    selectedIds,
    onToggleSelect,
    onToggleMany,
    columns,
}: {
    group: { key: string; name: string; tasks: TaskCardDto[]; isDone: boolean; total: number; truncated: boolean };
    orgId: string;
    projectId: string;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    selectedTaskId: string | null;
    selectable: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (taskId: string) => void;
    onToggleMany?: (taskIds: string[], selected: boolean) => void;
    columns: CustomFieldDto[];
}) {
    const [collapsed, setCollapsed] = useState(false);
    const roots = useMemo(() => buildTree(group.tasks), [group.tasks]);
    const containsSelected = group.tasks.some((t) => t.id === selectedTaskId);
    // Auto-expand the section if the user picked a task inside it (deep link, keyboard nav, etc.).
    useEffect(() => {
        if (containsSelected && collapsed) setCollapsed(false);
    }, [containsSelected, collapsed]);

    const doneCount = group.tasks.filter((t) => t.status === 'done' || t.status === 'canceled').length;
    const checkedCount = selectable ? group.tasks.filter((t) => selectedIds?.has(t.id)).length : 0;
    const allChecked = group.tasks.length > 0 && checkedCount === group.tasks.length;
    const progress =
        group.tasks.length === 0
            ? 'empty'
            : group.isDone && doneCount === group.tasks.length
                ? `${doneCount} done`
                : `${doneCount}/${group.tasks.length}`;

    return (
        <section>
            <header className="mb-1 flex items-center gap-2 px-1">
                {selectable ? (
                    <input
                        type="checkbox"
                        className="checkbox shrink-0"
                        checked={allChecked}
                        disabled={group.tasks.length === 0}
                        aria-label={allChecked ? `Deselect all in ${group.name}` : `Select all in ${group.name}`}
                        onChange={(event) => onToggleMany?.(group.tasks.map((t) => t.id), event.target.checked)}
                    />
                ) : null}
                <button
                    type="button"
                    aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsed((v) => !v)}
                    className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-subtle hover:text-ink"
                >
                    {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                <span className={clsx('status-dot', group.isDone ? 'bg-state-done' : 'bg-brand-500')} aria-hidden />
                <h2 className="text-sm font-semibold text-ink">{group.name}</h2>
                <span className="tabular-nums text-xs text-ink-faint">{progress}</span>
                {group.truncated ? (
                    <span
                        className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-muted"
                        title={`Only the first ${group.tasks.length} cards here are loaded; ${Math.max(0, group.total - group.tasks.length)} more stay on the server.`}
                    >
                        {group.total} in column
                    </span>
                ) : null}
            </header>

            {collapsed ? null : (
                <>
                    <div className="card overflow-hidden">
                        {roots.length === 0 ? (
                            <p className="px-3 py-2 text-xs italic text-ink-faint">No tasks in this column.</p>
                        ) : (
                            <ul>
                                {roots.map((node) => (
                                    <TaskTreeNode
                                        key={node.task.id}
                                        node={node}
                                        depth={0}
                                        canEdit={canEdit}
                                        onOpen={onOpen}
                                        selectedTaskId={selectedTaskId}
                                        selectable={selectable}
                                        selectedIds={selectedIds}
                                        onToggleSelect={onToggleSelect}
                                        columns={columns}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>

                    {canEdit && group.key !== 'unassigned' ? (
                        <div className="mt-1 px-1">
                            <QuickAdd
                                orgId={orgId}
                                label="Add task"
                                body={{ projectId, sectionId: group.key, status: group.isDone ? 'done' : 'todo' }}
                                onClose={() => { }}
                            />
                        </div>
                    ) : null}
                </>
            )}
        </section>
    );
}

/**
 * A row plus its expanded subtree. Kept collapsed by default; the parent's chevron and subtask
 * count together hint that there is more. A sub-subtask recurses into the same component.
 */
function TaskTreeNode({
    node,
    depth,
    canEdit,
    onOpen,
    selectedTaskId,
    selectable,
    selectedIds,
    onToggleSelect,
    columns,
}: {
    node: TreeNode;
    depth: number;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    selectedTaskId: string | null;
    selectable: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (taskId: string) => void;
    columns: CustomFieldDto[];
}) {
    const hasChildren = node.children.length > 0;
    // Auto-expand when a descendant is selected, so a deep-link to a subtask reveals its trail.
    const containsSelected = useMemo(
        () => containsTaskId(node, selectedTaskId),
        [node, selectedTaskId],
    );
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        if (containsSelected) setExpanded(true);
    }, [containsSelected]);

    return (
        <li className={clsx(depth > 0 && 'relative')}>
            {/* Horizontal tick connecting each child to its parent's vertical rail. */}
            {depth > 0 ? <span className="absolute -left-3 top-1/2 h-px w-2 bg-line" aria-hidden /> : null}

            <TaskRow
                task={node.task}
                canEdit={canEdit}
                onOpen={onOpen}
                selected={node.task.id === selectedTaskId}
                hasChildren={hasChildren}
                childCount={node.children.length}
                expanded={expanded}
                onToggleExpand={() => setExpanded((v) => !v)}
                selectable={selectable}
                checked={selectedIds?.has(node.task.id) ?? false}
                onToggleSelect={onToggleSelect}
                columns={columns}
            />

            {hasChildren && expanded ? (
                <ul className={clsx('ml-5 border-l border-line pl-3', depth === 0 ? 'bg-canvas/40' : '')}>
                    {node.children.map((child) => (
                        <TaskTreeNode
                            key={child.task.id}
                            node={child}
                            depth={depth + 1}
                            canEdit={canEdit}
                            onOpen={onOpen}
                            selectedTaskId={selectedTaskId}
                            selectable={selectable}
                            selectedIds={selectedIds}
                            onToggleSelect={onToggleSelect}
                            columns={columns}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function containsTaskId(node: TreeNode, taskId: string | null): boolean {
    if (!taskId) return false;
    if (node.task.id === taskId) return true;
    return node.children.some((c) => containsTaskId(c, taskId));
}

/**
 * One row: single line, meta pushed to the right, priority carried by the left border.
 * The chevron slot is always reserved so columns of rows line up whether or not they have kids.
 */
function TaskRow({
    task,
    canEdit,
    onOpen,
    selected = false,
    hasChildren = false,
    childCount = 0,
    expanded = false,
    onToggleExpand,
    selectable = false,
    checked = false,
    onToggleSelect,
    columns = [],
}: {
    task: TaskCardDto;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    selected?: boolean;
    hasChildren?: boolean;
    childCount?: number;
    expanded?: boolean;
    onToggleExpand?: () => void;
    /** Bulk mode: the row carries a checkbox and its title toggles selection. */
    selectable?: boolean;
    checked?: boolean;
    onToggleSelect?: (taskId: string) => void;
    /** Custom fields drawn as columns at the right of the row. */
    columns?: CustomFieldDto[];
}) {
    const update = useUpdateTask();
    const tone = dueTone(task.dueDate, task.status, task.isOverdue);
    const done = task.status === 'done' || task.status === 'canceled';
    const rowRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [selected]);

    const activate = () => (selectable ? onToggleSelect?.(task.id) : onOpen(task.id));

    return (
        <div
            ref={rowRef}
            aria-current={selected ? 'true' : undefined}
            className={clsx(
                'group flex items-center gap-2 border-l-2 py-2 pr-3 transition',
                // Nested rows drop the priority border — the tree rail is already their accent.
                selected ? 'border-l-brand-500 bg-brand-50' : checked ? 'border-l-brand-400 bg-brand-50/60' : hasChildren || task.priority !== 'none' ? clsx(PRIORITY_BORDER[task.priority], 'hover:bg-canvas') : 'border-l-transparent hover:bg-canvas',
                'pl-1',
            )}
        >
            {/* Chevron slot — always rendered for alignment, only interactive when there are kids. */}
            {hasChildren ? (
                <button
                    type="button"
                    aria-label={expanded ? `Collapse ${childCount} subtask${childCount === 1 ? '' : 's'}` : `Expand ${childCount} subtask${childCount === 1 ? '' : 's'}`}
                    aria-expanded={expanded}
                    onClick={onToggleExpand}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-subtle hover:text-ink"
                >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
            ) : (
                <span className="h-5 w-5 shrink-0" aria-hidden />
            )}

            <button
                type="button"
                disabled={!canEdit}
                aria-label={done ? 'Reopen task' : 'Mark task done'}
                className={clsx(
                    'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] transition',
                    done ? 'border-state-done bg-state-done text-white' : 'border-line text-transparent hover:border-brand-400 hover:text-brand-400',
                )}
                onClick={() => update.mutate({ taskId: task.id, patch: { status: done ? 'in_progress' : 'done' } })}
            >
                ✓
            </button>

            {/* Checkbox slot — reserved even when not selectable, so rows line up across views. */}
            {selectable ? (
                <input
                    type="checkbox"
                    className="checkbox shrink-0"
                    checked={checked}
                    onChange={() => onToggleSelect?.(task.id)}
                    aria-label={`Select ${task.title}`}
                    tabIndex={-1}
                />
            ) : (
                <span className="w-[16px] shrink-0" aria-hidden />
            )}

            {task.number !== null ? (
                // Same display-only ordinal the board card shows, so the same task answers to the
                // same `#N` in both views. Not a link: renumbering on delete would break old URLs.
                <span className="hidden w-12 shrink-0 truncate text-right text-xs tabular-nums text-ink-faint sm:inline" title="Position in this project (display only)">
                    #{task.number}
                </span>
            ) : null}

            <button type="button" className="min-w-0 flex-1 text-left" onClick={activate}>
                <p className={clsx('truncate', done ? 'text-ink-faint line-through' : task.parentTaskId ? 'text-ink-soft' : 'text-ink')}>
                    {task.isMilestone ? <Flag className="mr-1.5 inline h-3.5 w-3.5 text-brand-500" /> : null}
                    {task.title}
                </p>
            </button>

            {/* Meta strip — icons only when non-zero, so a quiet task is one clean line. */}
            <div className="flex shrink-0 items-center gap-2.5 text-xs text-ink-faint">
                {task.priority !== 'none' ? (
                    <span className={clsx('hidden sm:inline font-medium', PRIORITY_CLASS[task.priority])}>{PRIORITY_LABEL[task.priority]}</span>
                ) : null}
                {task.labels.length > 0 ? (
                    <span className="hidden md:flex items-center gap-1">
                        {task.labels.slice(0, 2).map((label) => (
                            <span key={label.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${label.color}1a`, color: label.color }}>
                                {label.name}
                            </span>
                        ))}
                        {task.labels.length > 2 ? <span className="text-ink-faint">+{task.labels.length - 2}</span> : null}
                    </span>
                ) : null}
                {task.subtaskCount > 0 && !expanded ? (
                    <button
                        type="button"
                        onClick={onToggleExpand}
                        className="inline-flex items-center gap-1 rounded px-1 tabular-nums hover:bg-subtle hover:text-ink"
                        title={`Show ${task.subtaskCount} subtask${task.subtaskCount === 1 ? '' : 's'}`}
                    >
                        <ListTree className="h-3.5 w-3.5" />
                        {task.subtaskCount}
                    </button>
                ) : null}
                {task.commentCount > 0 ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {task.commentCount}
                    </span>
                ) : null}
                {task.attachments.length > 0 ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                        <Paperclip className="h-3.5 w-3.5" />
                        {task.attachments.length}
                    </span>
                ) : null}
                {task.dueDate ? (
                    <span className={clsx('inline-flex items-center gap-1 tabular-nums', DUE_CLASS[tone])}>
                        <CalendarDays className="h-3.5 w-3.5" />
                        {dueLabel(task.dueDate)}
                    </span>
                ) : null}
                {/* Field columns, each naming itself: a row this dense has no header line to put a
                    title in, and an unlabelled value is a riddle rather than a column. */}
                {columns.map((field) => {
                    const text = fieldValueOf(task, field);
                    return (
                        <span
                            key={field.id}
                            className="hidden w-32 shrink-0 truncate text-right text-xs lg:inline"
                            title={`${field.name}: ${text || 'not set'}`}
                        >
                            <span className="text-ink-faint">{field.name}: </span>
                            <span className={text ? 'text-ink-soft' : 'italic text-ink-faint'}>{text || '—'}</span>
                        </span>
                    );
                })}
                <AvatarStack users={task.assignees} max={2} />
            </div>
        </div>
    );
}
