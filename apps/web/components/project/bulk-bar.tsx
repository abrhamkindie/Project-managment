'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { PRIORITY_LABEL, STATUS_LABEL } from '~/lib/format';
import { useBulkTasks, usePeople } from '~/lib/hooks';
import type { BulkTaskBody, TaskPriority, TaskStatus } from '~/lib/types';
import { Button, Select } from '../ui';

/** Mirrors `bulkTaskSchema`'s `ids.max(100)`; sending more is a 400 we can prevent locally. */
const MAX_IDS = 100;

type Action = 'status' | 'priority' | 'move' | 'assign' | 'delete';

const ACTION_LABEL: Record<Action, string> = {
    status: 'Set status',
    priority: 'Set priority',
    move: 'Move to column',
    assign: 'Change assignees',
    delete: 'Delete tasks',
};

/** `<Select>` hands back a string; the enum call sites all want the narrowed type. */
function pick<T extends string>(event: ChangeEvent<HTMLSelectElement>): T {
    return event.target.value as T;
}

/**
 * The checkbox bulk bar.
 *
 * One action at a time, applied to the selected ids in a single request. The server loops the
 * ordinary single-task services, so permissions, activity rows and realtime events behave exactly
 * as they do when editing one card — which is why a partial failure is reported instead of rolled
 * back, and why the selection keeps the failed ids: retrying only the stragglers should be possible.
 */
export function BulkBar({
    orgId,
    sections,
    selectedIds,
    onClear,
    onResult,
}: {
    orgId: string;
    sections: { id: string; name: string; isDone: boolean }[];
    selectedIds: string[];
    onClear: () => void;
    /** Called with the ids that failed, so the caller can narrow the selection to them. */
    onResult: (failedIds: string[]) => void;
}) {
    const bulk = useBulkTasks(orgId);
    const { people } = usePeople(orgId);
    const [action, setAction] = useState<Action>('status');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [sectionId, setSectionId] = useState('');
    const [inheritStatus, setInheritStatus] = useState(false);
    const [assigneeId, setAssigneeId] = useState('');
    const [assignMode, setAssignMode] = useState<'add' | 'replace' | 'remove'>('add');
    // Deleting a hundred tasks from a floating bar should not be one accidental click away, so the
    // Apply button arms first and the select itself has to be touched again to disarm.
    const [armed, setArmed] = useState(false);

    // A column list that changes under us (someone renamed it) should not strand the picker on a
    // dead id, so fall back to the first column rather than submitting an empty `sectionId`.
    const resolvedSectionId = useMemo(
        () => (sections.some((section) => section.id === sectionId) ? sectionId : sections[0]?.id ?? ''),
        [sections, sectionId],
    );

    const count = selectedIds.length;
    const tooMany = count > MAX_IDS;
    const isDelete = action === 'delete';

    const body = (): BulkTaskBody => {
        switch (action) {
            case 'status':
                return { ids: selectedIds, action, status };
            case 'priority':
                return { ids: selectedIds, action, priority };
            case 'move':
                return { ids: selectedIds, action, sectionId: resolvedSectionId, inheritSectionStatus: inheritStatus };
            case 'assign':
                return { ids: selectedIds, action, assigneeIds: assigneeId ? [assigneeId] : [], assignMode };
            case 'delete':
                return { ids: selectedIds, action };
        }
    };

    const ready = !tooMany && !bulk.isPending && (action !== 'move' || resolvedSectionId !== '') && (action !== 'assign' || assigneeId !== '');

    const apply = () => {
        // First click on a delete only arms it; the button label and the note both change, so the
        // second click is a deliberate act rather than the tail of a double-click.
        if (isDelete && !armed) {
            setArmed(true);
            return;
        }
        bulk.mutate(body(), {
            onSuccess: (result) => {
                setArmed(false);
                onResult(result.failed.map((failure) => failure.id));
            },
        });
    };

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
            <div
                role="toolbar"
                aria-label="Bulk actions"
                className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2 shadow-pop"
            >
                <span className={clsx('rounded-md px-2 py-1 text-xs font-semibold tabular-nums', tooMany ? 'bg-gray-100 text-danger' : 'bg-brand-50 text-brand-700')}>
                    {tooMany ? `${count} selected — max ${MAX_IDS}` : `${count} selected`}
                </span>

                <Select
                    aria-label="Bulk action"
                    className="w-40"
                    value={action}
                    onChange={(event) => {
                        setAction(pick<Action>(event));
                        setArmed(false);
                    }}
                >
                    {(Object.keys(ACTION_LABEL) as Action[]).map((value) => (
                        <option key={value} value={value}>
                            {ACTION_LABEL[value]}
                        </option>
                    ))}
                </Select>

                {action === 'status' ? (
                    <Select aria-label="New status" className="w-36" value={status} onChange={(event) => setStatus(pick<TaskStatus>(event))}>
                        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((value) => (
                            <option key={value} value={value}>
                                {STATUS_LABEL[value]}
                            </option>
                        ))}
                    </Select>
                ) : null}

                {action === 'priority' ? (
                    <Select aria-label="New priority" className="w-32" value={priority} onChange={(event) => setPriority(pick<TaskPriority>(event))}>
                        {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((value) => (
                            <option key={value} value={value}>
                                {PRIORITY_LABEL[value]}
                            </option>
                        ))}
                    </Select>
                ) : null}

                {action === 'move' ? (
                    <>
                        <Select aria-label="Target column" className="w-40" value={resolvedSectionId} onChange={(event) => setSectionId(event.target.value)}>
                            {sections.length === 0 ? <option value="">No columns</option> : null}
                            {sections.map((section) => (
                                <option key={section.id} value={section.id}>
                                    {section.name}
                                </option>
                            ))}
                        </Select>
                        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                            <input
                                type="checkbox"
                                className="checkbox"
                                checked={inheritStatus}
                                onChange={(event) => setInheritStatus(event.target.checked)}
                            />
                            Adopt column status
                        </label>
                    </>
                ) : null}

                {action === 'assign' ? (
                    <>
                        <Select aria-label="Assignment mode" className="w-28" value={assignMode} onChange={(event) => setAssignMode(pick<'add' | 'replace' | 'remove'>(event))}>
                            <option value="add">Add</option>
                            <option value="replace">Replace</option>
                            <option value="remove">Remove</option>
                        </Select>
                        <Select aria-label="Person" className="w-44" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                            <option value="">Choose a member…</option>
                            {people.map((person) => (
                                <option key={person.id} value={person.id}>
                                    {person.firstName} {person.lastName}
                                </option>
                            ))}
                        </Select>
                    </>
                ) : null}

                {isDelete ? (
                    <span className="text-xs text-danger">
                        {armed ? `Delete ${count} ${count === 1 ? 'task' : 'tasks'} — click Apply again to confirm.` : 'Deletes cannot be undone.'}
                    </span>
                ) : null}

                <Button
                    size="sm"
                    variant={isDelete ? 'danger' : 'primary'}
                    disabled={!ready}
                    loading={bulk.isPending}
                    onClick={apply}
                >
                    {isDelete && armed ? 'Confirm delete' : 'Apply'}
                </Button>

                <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClear} aria-label="Clear selection">
                    Clear
                </Button>
            </div>
        </div>
    );
}
