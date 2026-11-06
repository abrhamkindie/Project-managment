'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Bookmark, X } from 'lucide-react';
import { useCreateSavedFilter, useDeleteSavedFilter, useSavedFilters } from '~/lib/hooks';
import type { SavedFilterDto } from '~/lib/types';

/**
 * Saved filters strip.
 *
 * A filter is just the screen's current facet state stored under a name, per user (private by
 * construction — the API only ever returns the caller's rows). Applying one hands the stored values
 * back to the caller, so the expensive part (re-picking label/cycle/mine, or a date bucket) is skipped.
 *
 * The bar stays agnostic about the payload: callers encode their state into a JSON record and decode
 * it on apply. Rows scoped to another project are hidden; rows with no projectId are org-wide.
 */

export interface FilterState {
    term: string;
    mineOnly: boolean;
    labelId: string;
    cycleId: string;
    /** Custom-field filter (Phase 6): an id plus the text, number, date or option to match. */
    fieldId: string;
    fieldValue: string;
}

/** Only non-default facets are worth persisting; keeps `params` small and forward-compatible. */
export function boardFilterParams(state: FilterState): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (state.term.trim()) params.term = state.term;
    if (state.mineOnly) params.mineOnly = true;
    if (state.labelId) params.labelId = state.labelId;
    if (state.cycleId) params.cycleId = state.cycleId;
    // A field filter is only meaningful as a pair, so it is stored — and restored — as one.
    if (state.fieldId && state.fieldValue.trim()) {
        params.fieldId = state.fieldId;
        params.fieldValue = state.fieldValue;
    }
    return params;
}

export function boardFilterState(params: Record<string, unknown>): FilterState {
    return {
        term: typeof params.term === 'string' ? params.term : '',
        mineOnly: params.mineOnly === true,
        labelId: typeof params.labelId === 'string' ? params.labelId : '',
        cycleId: typeof params.cycleId === 'string' ? params.cycleId : '',
        fieldId: typeof params.fieldId === 'string' ? params.fieldId : '',
        fieldValue: typeof params.fieldValue === 'string' ? params.fieldValue : '',
    };
}

export function SavedFilterBar({
    orgId,
    projectId = null,
    params,
    onApply,
}: {
    orgId: string;
    /** Row this filter list is scoped to; org-wide rows (no project) always show alongside it. */
    projectId?: string | null;
    /** Current screen state, already encoded. Empty record means nothing to save. */
    params: Record<string, unknown>;
    onApply: (stored: Record<string, unknown>) => void;
}) {
    const filters = useSavedFilters(orgId);
    const create = useCreateSavedFilter(orgId);
    const remove = useDeleteSavedFilter(orgId);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    const rows = (filters.data ?? []).filter((filter) => filter.projectId === null || filter.projectId === projectId);
    const dirty = Object.keys(params).length > 0;

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed || !dirty) return;
        create.mutate(
            { name: trimmed, projectId, params },
            {
                onSuccess: () => {
                    setName('');
                    setNaming(false);
                },
            },
        );
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {rows.map((filter) => (
                <SavedChip
                    key={filter.id}
                    filter={filter}
                    onDelete={() => remove.mutate(filter.id)}
                    onApply={() => onApply(filter.params)}
                />
            ))}

            {naming ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5">
                    <input
                        autoFocus
                        value={name}
                        maxLength={80}
                        placeholder="Filter name"
                        aria-label="Saved filter name"
                        className="w-32 bg-transparent text-xs outline-none placeholder:text-ink-faint"
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') submit();
                            if (event.key === 'Escape') setNaming(false);
                        }}
                    />
                    <button type="button" className="link text-xs" disabled={create.isPending} onClick={submit}>
                        Save
                    </button>
                    <button type="button" aria-label="Cancel" className="text-ink-faint hover:text-ink" onClick={() => setNaming(false)}>
                        <X className="h-3.5 w-3.5" />
                    </button>
                </span>
            ) : (
                <button
                    type="button"
                    disabled={!dirty}
                    title={dirty ? 'Save the current filters' : 'Pick a filter first'}
                    onClick={() => setNaming(true)}
                    className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                        dirty ? 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink' : 'border-line text-ink-faint opacity-50',
                    )}
                >
                    <Bookmark className="h-3.5 w-3.5" />
                    Save filter
                </button>
            )}
        </div>
    );
}

function SavedChip({ filter, onApply, onDelete }: { filter: SavedFilterDto; onApply: () => void; onDelete: () => void }) {
    return (
        <span className="inline-flex items-center rounded-full border border-line bg-surface text-xs transition hover:border-line-strong">
            <button type="button" onClick={onApply} className="max-w-[160px] truncate px-2.5 py-1 text-ink-muted hover:text-ink" title={filter.name}>
                {filter.name}
            </button>
            <button type="button" aria-label={`Delete ${filter.name}`} onClick={onDelete} className="pr-1.5 text-ink-faint transition hover:text-state-urgent">
                <X className="h-3 w-3" />
            </button>
        </span>
    );
}
