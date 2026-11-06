'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Play, Plus, Trash2 } from 'lucide-react';
import {
    useCycles,
    useCloseCycle,
    useCreateCycle,
    useDeleteCycle,
    useUpdateCycle,
} from '~/lib/hooks';
import { formatDate } from '~/lib/format';
import type { CycleDto, CycleStatus } from '~/lib/types';
import { Button, Field, Input, Modal, Skeleton } from '../ui';

const STATUS_TONE: Record<CycleStatus, string> = {
    draft: 'bg-slate-100 text-slate-600',
    active: 'bg-brand-500/10 text-brand-700',
    closed: 'bg-amber-100 text-amber-700',
};

function todayPlus(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/**
 * Sprint (cycle) management for one project.
 *
 * Lists cycles newest-first with their scope, lets a manager open a two-week draft, activate
 * it (which auto-closes the previous active one) and close it, returning unfinished work to the
 * backlog. Deleting only detaches — tasks always survive.
 */
export function CyclesModal({ projectId, canEdit, onClose }: { projectId: string; canEdit: boolean; onClose: () => void }) {
    const cycles = useCycles(projectId);
    const create = useCreateCycle(projectId);
    const update = useUpdateCycle(projectId);
    const close = useCloseCycle(projectId);
    const remove = useDeleteCycle(projectId);

    const [draft, setDraft] = useState({ name: '', startsAt: todayPlus(0), endsAt: todayPlus(14) });
    const [showForm, setShowForm] = useState(false);

    const submit = () => {
        if (!draft.name.trim()) return;
        create.mutate(
            { name: draft.name.trim(), startsAt: `${draft.startsAt}T00:00:00.000Z`, endsAt: `${draft.endsAt}T00:00:00.000Z` },
            {
                onSuccess: () => {
                    setDraft({ name: '', startsAt: todayPlus(0), endsAt: todayPlus(14) });
                    setShowForm(false);
                },
            },
        );
    };

    return (
        <Modal title="Cycles" description="Time-boxed slices of this project's backlog." onClose={onClose} width="max-w-2xl">
            {cycles.isLoading ? <Skeleton className="h-40" /> : null}

            {!cycles.isLoading && (cycles.data?.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-ink-muted">No cycles yet. Create one to start planning a sprint.</p>
            ) : null}

            <ul className="divide-y divide-line">
                {cycles.data?.map((cycle) => (
                    <CycleRow
                        key={cycle.id}
                        cycle={cycle}
                        canEdit={canEdit}
                        busy={update.isPending || close.isPending || remove.isPending}
                        onActivate={() => update.mutate({ cycleId: cycle.id, patch: { status: 'active' } })}
                        onCloseCycle={() => close.mutate(cycle.id)}
                        onDelete={() => remove.mutate(cycle.id)}
                    />
                ))}
            </ul>

            {canEdit ? (
                showForm ? (
                    <div className="mt-4 space-y-3 rounded-lg bg-canvas p-3">
                        <Field label="Name">
                            <Input value={draft.name} autoFocus placeholder="Cycle 3" onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))} />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Starts">
                                <Input type="date" value={draft.startsAt} onChange={(event) => setDraft((d) => ({ ...d, startsAt: event.target.value }))} />
                            </Field>
                            <Field label="Ends">
                                <Input type="date" value={draft.endsAt} onChange={(event) => setDraft((d) => ({ ...d, endsAt: event.target.value }))} />
                            </Field>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                                Cancel
                            </Button>
                            <Button size="sm" variant="primary" loading={create.isPending} disabled={!draft.name.trim()} onClick={submit}>
                                Create cycle
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button size="sm" variant="secondary" className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)}>
                        New cycle
                    </Button>
                )
            ) : null}
        </Modal>
    );
}

function CycleRow({
    cycle,
    canEdit,
    busy,
    onActivate,
    onCloseCycle,
    onDelete,
}: {
    cycle: CycleDto;
    canEdit: boolean;
    busy: boolean;
    onActivate: () => void;
    onCloseCycle: () => void;
    onDelete: () => void;
}) {
    const pct = cycle.taskCount > 0 ? Math.round((cycle.doneCount / cycle.taskCount) * 100) : 0;
    return (
        <li className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{cycle.name}</span>
                    <span className={clsx('chip rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase', STATUS_TONE[cycle.status])}>{cycle.status}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                    #{cycle.number} · {formatDate(cycle.startsAt)} – {formatDate(cycle.endsAt)} · {cycle.doneCount}/{cycle.taskCount} done{cycle.taskCount > 0 ? ` (${pct}%)` : ''}
                </p>
            </div>
            {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                    {cycle.status !== 'active' ? (
                        <Button size="sm" variant="ghost" disabled={busy} icon={<Play className="h-3.5 w-3.5" />} onClick={onActivate}>
                            Start
                        </Button>
                    ) : (
                        <Button size="sm" variant="ghost" disabled={busy} icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={onCloseCycle}>
                            Close
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={`Delete ${cycle.name}`} onClick={onDelete} className="text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            ) : null}
        </li>
    );
}
