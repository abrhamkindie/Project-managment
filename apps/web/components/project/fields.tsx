'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fieldValueLabel } from '~/lib/format';
import type { CustomFieldDto, CustomFieldFilterDto, TaskCardDto } from '~/lib/types';

/**
 * Custom fields as the views see them (Phase 6).
 *
 * A card carries values by field id only — the definitions are workspace-wide, so repeating a name
 * and a type on every card would be waste and a lie at the same time. That means anything that draws
 * a value needs the definition list in hand, and threading it through board → column → card would
 * touch three components that have no interest in it. One provider at the project screen is the
 * whole plumbing, and the list arrives on the same cache key the settings panel and the drawer use.
 */

const FieldListContext = createContext<CustomFieldDto[]>([]);

export function FieldDictionaryProvider({ fields, children }: { fields: CustomFieldDto[]; children: ReactNode }) {
    return <FieldListContext.Provider value={fields}>{children}</FieldListContext.Provider>;
}

/** The visible definitions, in the order the API sorted them (by name). */
export function useCustomFieldList(): CustomFieldDto[] {
    return useContext(FieldListContext);
}

/** The same list keyed by id, for the places that hold a value and need the field behind it. */
export function useFieldDictionary(): Map<string, CustomFieldDto> {
    const fields = useCustomFieldList();
    return useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
}

/** A card's values as `[definition, value]` pairs, in definition order; unknown ids drop out. */
export function fieldValuesOf(task: TaskCardDto, fields: CustomFieldDto[]): [CustomFieldDto, string][] {
    if (!task.fields?.length) return [];
    const byId = new Map(task.fields.map((row) => [row.fieldId, row.value]));
    return fields
        .filter((field) => byId.has(field.id))
        .map((field) => [field, byId.get(field.id)!]);
}

/** One field on one card, already readable — '' when the card holds nothing for it. */
export function fieldValueOf(task: TaskCardDto, field: CustomFieldDto): string {
    const row = task.fields?.find((candidate) => candidate.fieldId === field.id);
    return row ? fieldValueLabel(field, row.value) : '';
}

/**
 * The chips a card shows.
 *
 * `max` is small on purpose: a board column is 290px wide and a card that becomes a wall of metadata
 * stops being scannable. The rest collapse into a count, and the drawer shows everything.
 */
export function FieldChips({ task, max = 2 }: { task: TaskCardDto; max?: number }) {
    const fields = useCustomFieldList();
    const values = fieldValuesOf(task, fields);
    if (values.length === 0) return null;

    return (
        <ul className="mt-2 flex flex-wrap items-center gap-1">
            {values.slice(0, max).map(([field, value]) => (
                <li
                    key={field.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-subtle px-1.5 py-0.5 text-[11px] text-ink-muted"
                    title={`${field.name}: ${fieldValueLabel(field, value)}`}
                >
                    <span className="shrink-0 text-ink-faint">{field.name}</span>
                    <span className="truncate font-medium text-ink-soft">{fieldValueLabel(field, value) || '—'}</span>
                </li>
            ))}
            {values.length > max ? <li className="text-[11px] tabular-nums text-ink-faint">+{values.length - max}</li> : null}
        </ul>
    );
}

/**
 * Does this card satisfy one field filter?
 *
 * Mirrors the server's rule exactly — text is a substring, everything else compares its stored string
 * — because the board and the list filter what they already have in memory, and a chip that disagrees
 * with the filter that produced it would look like a bug in whichever one changed.
 */
export function taskMatchesFieldFilter(task: TaskCardDto, filter: CustomFieldFilterDto, fields: CustomFieldDto[]): boolean {
    const field = fields.find((candidate) => candidate.id === filter.fieldId);
    if (!field) return false;
    const stored = task.fields?.find((row) => row.fieldId === field.id)?.value;
    if (stored === undefined) return false;

    const needle = typeof filter.value === 'string' ? filter.value.trim() : String(filter.value);
    if (!needle) return true;
    if (field.type === 'text') return stored.toLowerCase().includes(needle.toLowerCase());
    if (field.type === 'checkbox') return stored === (needle === 'true' ? 'true' : 'false');
    return stored === needle;
}
