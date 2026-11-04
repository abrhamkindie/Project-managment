'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CheckCircle2, Circle, Ellipsis, Trash2, PencilLine } from 'lucide-react';
import clsx from 'clsx';
import { useSections } from '~/lib/hooks';
import type { BoardSectionDto, TaskCardDto } from '~/lib/types';
import { Button, Input, Menu, MenuItem, Modal } from '../ui';
import { QuickAdd } from './quick-add';
import { TaskCard } from './task-card';

const DROP_PREFIX = 'col:';

/**
 * Droppable ids are namespaced so a column and a card can never be confused when dnd-kit hands
 * back `over.id`. `null` is the Unassigned pool, which is readable but never a drop target.
 */
export function columnDroppableId(sectionId: string | null): string {
    return `${DROP_PREFIX}${sectionId ?? 'unassigned'}`;
}

export function sectionIdFromDroppable(id: string): string | null | undefined {
    if (!id.startsWith(DROP_PREFIX)) return undefined;
    const rest = id.slice(DROP_PREFIX.length);
    return rest === 'unassigned' ? null : rest;
}

/**
 * One Kanban column.
 *
 * The header is the only place a manager touches the board's shape (rename, mark the column as
 * the "done" column, delete it); everything below is cards.
 */
export function BoardColumn({
    orgId,
    projectId,
    section,
    tasks,
    draggable,
    droppable,
    canEdit,
    canAdd,
    canDelete,
    onOpen,
    selectedTaskId = null,
}: {
    orgId: string;
    projectId: string;
    /** `null` renders the Unassigned pool. */
    section: BoardSectionDto | null;
    tasks: TaskCardDto[];
    draggable: boolean;
    droppable: boolean;
    canEdit: boolean;
    /** Only a project with no columns at all may create straight into the pool. */
    canAdd: boolean;
    /** The API refuses to delete a project's last column, so the menu must too. */
    canDelete: boolean;
    onOpen: (taskId: string) => void;
    /** The task whose drawer is open, so its card can be highlighted and scrolled into view. */
    selectedTaskId?: string | null;
}) {
    const sections = useSections(projectId);
    const [draft, setDraft] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    const drop = useDroppable({ id: columnDroppableId(section?.id ?? null), disabled: !droppable });

    // Build a forest keyed on parentTaskId using only the tasks that live in this column.
    // A subtask whose parent is in another column is not nested — it just sits here as its own
    // root, so nothing disappears when parents and children get split across sections.
    const { visible, childrenByParent, depthByTaskId } = useMemo(() => {
        const inThisColumn = new Set(tasks.map((t) => t.id));
        const kidsByParent = new Map<string, TaskCardDto[]>();
        const roots: TaskCardDto[] = [];
        for (const t of tasks) {
            const parentId = t.parentTaskId;
            if (parentId && inThisColumn.has(parentId)) {
                const arr = kidsByParent.get(parentId) ?? [];
                arr.push(t);
                kidsByParent.set(parentId, arr);
            } else {
                roots.push(t);
            }
        }
        const out: TaskCardDto[] = [];
        const depths = new Map<string, number>();
        const walk = (list: TaskCardDto[], depth: number) => {
            for (const t of list) {
                out.push(t);
                depths.set(t.id, depth);
                if (expandedIds.has(t.id)) {
                    const kids = kidsByParent.get(t.id);
                    if (kids) walk(kids, depth + 1);
                }
            }
        };
        walk(roots, 0);
        return { visible: out, childrenByParent: kidsByParent, depthByTaskId: depths };
    }, [tasks, expandedIds]);

    const toggle = (id: string) =>
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const commit = (event?: FormEvent) => {
        event?.preventDefault();
        const next = draft?.trim();
        setDraft(null);
        if (!section || !next || next === section.name) return;
        sections.update.mutate({ sectionId: section.id, patch: { name: next } });
    };

    return (
        <section
            ref={drop.setNodeRef}
            aria-label={section?.name ?? 'Unassigned'}
            className={clsx(
                'flex max-h-full w-[290px] shrink-0 flex-col rounded-xl border bg-surface',
                drop.isOver && droppable ? 'column-drop' : 'border-line',
            )}
        >
            <header className="flex items-center gap-2 px-3 pb-1 pt-3">
                {draft !== null ? (
                    <form onSubmit={commit} className="min-w-0 flex-1">
                        <Input
                            autoFocus
                            value={draft}
                            maxLength={120}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => commit()}
                            aria-label="Column name"
                        />
                    </form>
                ) : (
                    <h2
                        className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
                        onDoubleClick={() => canEdit && section && setDraft(section.name)}
                    >
                        {section?.name ?? 'Unassigned'}
                    </h2>
                )}

                {section?.isDone ? <CheckCircle2 className="h-4 w-4 shrink-0 text-state-done" aria-label="Done column" /> : null}

                {section && canEdit ? (
                    <Menu
                        trigger={(open) => (
                            <button
                                type="button"
                                aria-label={`Options for ${section.name}`}
                                className={clsx('rounded-md p-1 text-ink-faint transition hover:bg-gray-100 hover:text-ink', open && 'bg-gray-100 text-ink')}
                            >
                                <Ellipsis className="h-4 w-4" />
                            </button>
                        )}
                    >
                        <MenuItem icon={<PencilLine className="h-4 w-4" />} onSelect={() => setDraft(section.name)}>
                            Rename column
                        </MenuItem>
                        <MenuItem
                            icon={section.isDone ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            onSelect={() => sections.update.mutate({ sectionId: section.id, patch: { isDone: !section.isDone } })}
                        >
                            {section.isDone ? 'Mark as active' : 'Mark as done'}
                        </MenuItem>
                        <MenuItem
                            tone="danger"
                            icon={<Trash2 className="h-4 w-4" />}
                            disabled={!canDelete}
                            onSelect={() => setConfirming(true)}
                        >
                            Delete column
                        </MenuItem>
                    </Menu>
                ) : null}

                <span className="text-xs text-ink-faint">{tasks.length}</span>
            </header>

            <SortableContext items={visible.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
                    {visible.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onOpen={onOpen}
                            draggable={draggable}
                            selected={task.id === selectedTaskId}
                            depth={depthByTaskId.get(task.id) ?? 0}
                            hasVisibleChildren={childrenByParent.has(task.id)}
                            childCount={childrenByParent.get(task.id)?.length ?? 0}
                            expanded={expandedIds.has(task.id)}
                            onToggleExpand={() => toggle(task.id)}
                        />
                    ))}
                    {visible.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">
                            {section ? 'Drop a card here' : 'Nothing waiting for a column'}
                        </p>
                    ) : null}
                </div>
            </SortableContext>

            {canEdit && (section || canAdd) ? (
                <footer className="border-t border-line p-2.5">
                    <QuickAdd
                        orgId={orgId}
                        label="Add task"
                        body={
                            section
                                ? { projectId, sectionId: section.id, status: section.isDone ? 'done' : 'todo' }
                                : { projectId }
                        }
                    />
                </footer>
            ) : null}

            {confirming && section ? (
                <Modal
                    title={`Delete “${section.name}”?`}
                    description={
                        tasks.length > 0
                            ? `${tasks.length} card${tasks.length === 1 ? '' : 's'} will move to the first remaining column.`
                            : 'This column is empty, so nothing else changes.'
                    }
                    onClose={() => setConfirming(false)}
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setConfirming(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                loading={sections.remove.isPending}
                                onClick={() => {
                                    sections.remove.mutate(section.id);
                                    setConfirming(false);
                                }}
                            >
                                Delete column
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm text-ink-soft">Columns cannot be restored once deleted.</p>
                </Modal>
            ) : null}
        </section>
    );
}
