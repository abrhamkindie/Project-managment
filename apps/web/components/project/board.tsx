'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MeasuringStrategy,
    PointerSensor,
    closestCorners,
    pointerWithin,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { moveTaskLocally, neighbours } from '~/lib/board-cache';
import { useMoveTask, useSections } from '~/lib/hooks';
import { keys } from '~/lib/queries';
import type { BoardDto, TaskCardDto } from '~/lib/types';
import { BoardColumn, sectionIdFromDroppable } from './board-column';
import { Input } from '../ui';
import { TaskCard } from './task-card';

/** Where a dropped card ends up: which column, and which card it now sits in front of. */
interface Drop {
    sectionId: string;
    list: TaskCardDto[];
    beforeId: string | null;
}

/** Arrow keys as grid steps: `y` walks down a column, `x` hops to the neighbouring one. */
const ARROWS: Record<string, { axis: 'x' | 'y'; delta: number }> = {
    ArrowUp: { axis: 'y', delta: -1 },
    ArrowDown: { axis: 'y', delta: 1 },
    ArrowLeft: { axis: 'x', delta: -1 },
    ArrowRight: { axis: 'x', delta: 1 },
};

/**
 * Resolve `over.id` into a column and a position.
 *
 * A drop can land on a card or on the empty part of a column, and those two need different
 * answers: the card gives a neighbour, the column means "append". The Unassigned pool is not a
 * target at all — the API has no way to move a card out of a section.
 */
function resolveDrop(board: BoardDto, dragId: string, overId: string, below: boolean): Drop | null {
    if (dragId === overId) return null;
    const asColumn = sectionIdFromDroppable(overId);

    const owner =
        asColumn === undefined
            ? board.sections.find((section) => section.tasks.some((task) => task.id === overId))
            : board.sections.find((section) => section.id === asColumn);
    if (!owner) return null;

    const list = owner.tasks.filter((task) => task.id !== dragId);
    if (asColumn !== undefined) return { sectionId: owner.id, list, beforeId: null };

    const index = list.findIndex((task) => task.id === overId);
    if (index < 0) return { sectionId: owner.id, list, beforeId: null };
    return { sectionId: owner.id, list, beforeId: below ? (list[index + 1]?.id ?? null) : (list[index]?.id ?? null) };
}

/** Did the pointer pass the lower half of the card it is hovering? That decides before/after. */
function isBelow(event: DragEndEvent): boolean {
    const active = event.active.rect.current.translated;
    const over = event.over?.rect;
    if (!active || !over) return false;
    return active.top + active.height / 2 > over.top + over.height / 2;
}

/**
 * Where a drag currently counts as hovering.
 *
 * `pointerWithin` is the accurate answer whenever the pointer is actually over a card or column, so
 * it is preferred. Only when the pointer is in a gap — between two cards, or past the last card in a
 * short column — does `closestCorners` take over to pick the nearest slot. Using `closestCorners`
 * alone makes cross-column drops land in whatever is geometrically closest, not what is under the
 * cursor, which is what makes a drop feel like it "grabs the wrong thing".
 */
const boardCollisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    return within.length > 0 ? within : closestCorners(args);
};

/**
 * The Kanban board.
 *
 * Drag is only enabled once a project has columns, because without them every card lives in the
 * pool and the API would accept no drop.
 */
export function Board({
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
}: {
    orgId: string;
    projectId: string;
    board: BoardDto;
    canEdit: boolean;
    onOpen: (taskId: string) => void;
    /** The task whose drawer is open, so its card can be highlighted and scrolled into view. */
    selectedTaskId?: string | null;
    /** Bulk mode — cards take checkboxes and dragging is switched off. */
    selectable?: boolean;
    selectedIds?: Set<string>;
    onToggleSelect?: (taskId: string) => void;
    onToggleMany?: (taskIds: string[], selected: boolean) => void;
}) {
    const client = useQueryClient();
    const move = useMoveTask();
    const gridRef = useRef<HTMLDivElement | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const sensors = useSensors(
        // A small threshold keeps a click on a card from being read as the start of a drag.
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    // Dragging and bulk selection are mutually exclusive: a pointerdown that might become a drag is
    // also the click that toggles a checkbox, and letting both win makes selection unreliable.
    const dragEnabled = canEdit && board.sections.length > 0 && !selectable;

    const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

    const onDragCancel = () => setActiveId(null);

    const onDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        const over = event.over;
        if (!over) return;
        const taskId = String(event.active.id);
        const drop = resolveDrop(board, taskId, String(over.id), isBelow(event));
        if (!drop) return;

        // Patch whatever is in the cache now, not the snapshot we rendered from — a realtime move may
        // have landed while the card was still in the air.
        client.setQueryData(keys.board(projectId), (current: BoardDto | undefined) =>
            current ? moveTaskLocally(current, taskId, drop.sectionId, drop.beforeId) : current,
        );

        move.mutate(
            { taskId, move: { sectionId: drop.sectionId, ...neighbours(drop.list, drop.beforeId) } },
            {
                // The local order was a guess about a write that failed; ask for the truth back.
                onError: () => void client.invalidateQueries({ queryKey: keys.board(projectId) }),
            },
        );
    };

    const activeTask = activeId ? board.sections.flatMap((section) => section.tasks).find((task) => task.id === activeId) : undefined;

    /**
     * Arrow-key roving between cards.
     *
     * dnd-kit already gives a keyboard drag (Space, then arrows) its own arrow handling; this only
     * runs when no drag is in progress, and treats a card as a grid cell: up/down walks the column,
     * left/right hops to the neighbour column keeping the row index. Focus, not selection — the
     * drawer still opens on Enter, which the card itself handles.
     */
    const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (activeId || event.defaultPrevented) return;
        const step = ARROWS[event.key];
        if (!step) return;
        const card = (event.target as HTMLElement).closest<HTMLElement>('[data-task-card]');
        if (!card) return;
        const columns = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-board-column]') ?? [])];
        const columnIndex = columns.findIndex((column) => column.contains(card));
        if (columnIndex < 0) return;
        const cards = [...columns[columnIndex].querySelectorAll<HTMLElement>('[data-task-card]')];
        const index = cards.indexOf(card);
        if (step.axis === 'y') {
            const next = cards[Math.max(0, Math.min(cards.length - 1, index + step.delta))];
            if (next && next !== card) {
                event.preventDefault();
                next.focus();
            }
            return;
        }
        const target = columns[columnIndex + step.delta];
        if (!target) return;
        const targets = [...target.querySelectorAll<HTMLElement>('[data-task-card]')];
        const next = targets[Math.min(index, targets.length - 1)];
        if (next) {
            event.preventDefault();
            next.focus();
        }
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={boardCollisionDetection}
            // Recompute every droppable's rect while a card is in the air: a column grows and shrinks
            // as the sortable list reflows, and the default (measure once at drag start) leaves the
            // hit areas a card-length out of date, which is the main reason a drop lands in the wrong
            // place only "sometimes".
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
        >
            <div ref={gridRef} onKeyDown={onGridKeyDown} className="scroll-x flex h-full min-h-0 items-stretch gap-3 px-4 pb-4">
                {board.sections.map((section) => (
                    <BoardColumn
                        key={section.id}
                        orgId={orgId}
                        projectId={projectId}
                        section={section}
                        tasks={section.tasks}
                        draggable={dragEnabled}
                        droppable={canEdit}
                        canEdit={canEdit}
                        canAdd={false}
                        canDelete={board.sections.length > 1}
                        onOpen={onOpen}
                        selectedTaskId={selectedTaskId}
                        selectable={selectable}
                        selectedIds={selectedIds}
                        onToggleSelect={onToggleSelect}
                        onToggleMany={onToggleMany}
                    />
                ))}

                {board.unassigned.length > 0 || board.sections.length === 0 ? (
                    <BoardColumn
                        orgId={orgId}
                        projectId={projectId}
                        section={null}
                        tasks={board.unassigned}
                        draggable={false}
                        droppable={false}
                        canEdit={canEdit}
                        canAdd={board.sections.length === 0}
                        canDelete={false}
                        onOpen={onOpen}
                        selectedTaskId={selectedTaskId}
                        selectable={selectable}
                        selectedIds={selectedIds}
                        onToggleSelect={onToggleSelect}
                        onToggleMany={onToggleMany}
                    />
                ) : null}

                {canEdit ? <AddSection projectId={projectId} /> : null}
            </div>

            <DragOverlay dropAnimation={{ duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                {activeTask ? <TaskCard task={activeTask} onOpen={() => { }} overlay /> : null}
            </DragOverlay>
        </DndContext>
    );
}

/** Columns are added at the end; their order is adjusted by dragging cards out of them for now. */
function AddSection({ projectId }: { projectId: string }) {
    const sections = useSections(projectId);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        sections.create.mutate(
            { name: trimmed },
            {
                onSuccess: () => {
                    setName('');
                },
            },
        );
    };

    if (!open) {
        return (
            <button type="button" className="flex w-[220px] shrink-0 items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-ink-muted transition hover:border-brand-300 hover:text-brand-700" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" />
                Add column
            </button>
        );
    }

    return (
        <form onSubmit={submit} className="w-[260px] shrink-0 space-y-1.5 rounded-xl border border-line bg-surface p-2.5">
            <Input
                autoFocus
                value={name}
                maxLength={120}
                placeholder="Column name"
                aria-label="New column name"
                onChange={(event) => setName(event.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
                <button type="button" className="link text-xs" onClick={() => setOpen(false)}>
                    Cancel
                </button>
                <button type="submit" className="link text-xs" disabled={!name.trim() || sections.create.isPending}>
                    Add
                </button>
            </div>
        </form>
    );
}
