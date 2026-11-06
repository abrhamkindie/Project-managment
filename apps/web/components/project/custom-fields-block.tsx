'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useSetTaskFieldValues, useTaskFields } from '~/lib/hooks';
import type { CustomFieldDto, TaskDetailDto } from '~/lib/types';
import { Field, Input, Select } from '../ui';

/**
 * Custom fields on one task (Phase 6).
 *
 * The block is drawn from `GET /tasks/:id/fields`, which returns the definitions this task may carry
 * *and* the values it holds — one request, so the drawer never offers a field the server would refuse
 * a value for. A task with no fields available shows nothing at all: shapes are created in settings,
 * and an empty "Custom fields" header is a question nobody asked.
 *
 * Saving is per field, not per form. That is what lets two people share a drawer: a choice one of
 * them makes cannot overwrite the text the other is typing, because only the key that changed is
 * sent. Pickers commit on change — a choice is finished the moment it is made — and free input commits
 * on blur, so a half-typed number is never sent as a refusal.
 *
 * The draft is optimistic and is rolled back if the API says no, which is the only way a value the
 * type cannot hold (a number in a date field) stays visibly wrong instead of looking saved.
 */
export function CustomFieldsBlock({ task, canEdit }: { task: TaskDetailDto; canEdit: boolean }) {
    const fields = useTaskFields(task.id);
    const save = useSetTaskFieldValues(task.id, task.projectId, task.project.orgId);
    // Only what the person is editing is held locally; everything else reads from the server value.
    const [draft, setDraft] = useState<Record<string, string>>({});

    const stored = useMemo(() => new Map((fields.data?.values ?? []).map((row) => [row.fieldId, row.value])), [fields.data]);
    const definitions = fields.data?.items ?? [];

    const valueOf = (fieldId: string) => draft[fieldId] ?? stored.get(fieldId) ?? '';

    const commit = (fieldId: string, next: string) => {
        // Tabbing out of an untouched box is not an edit, and a no-op write would still noise up the
        // task's activity feed.
        if (next === (stored.get(fieldId) ?? '')) {
            setDraft((prev) => drop(prev, fieldId));
            return;
        }
        setDraft((prev) => ({ ...prev, [fieldId]: next }));
        save.mutate(
            { [fieldId]: next },
            // Refused? Put the screen back to what the database still holds and let the toast speak.
            { onError: () => setDraft((prev) => drop(prev, fieldId)) },
        );
    };

    if (fields.isLoading || definitions.length === 0) return null;

    return (
        <section className="mb-6">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                <SlidersHorizontal className="h-4 w-4 text-ink-faint" />
                Custom fields
            </h3>

            <div className="grid gap-2 sm:grid-cols-2">
                {definitions.map((field) => (
                    <Field key={field.id} label={field.name} hint={field.projectId ? undefined : 'Workspace-wide'}>
                        <FieldInput
                            field={field}
                            value={valueOf(field.id)}
                            disabled={!canEdit}
                            busy={save.isPending}
                            onChange={(next) => setDraft((prev) => ({ ...prev, [field.id]: next }))}
                            onCommit={(next) => commit(field.id, next)}
                        />
                    </Field>
                ))}
            </div>
        </section>
    );
}

function drop(draft: Record<string, string>, fieldId: string): Record<string, string> {
    const rest = { ...draft };
    delete rest[fieldId];
    return rest;
}

/**
 * The one control for the five shapes.
 *
 * Each offers exactly the answers its type can hold: an empty choice everywhere, because clearing a
 * field is a value like any other, and a picker rather than a text box for a select, since inventing
 * an option is the one mistake this API refuses loudly.
 */
function FieldInput({
    field,
    value,
    disabled,
    busy,
    onChange,
    onCommit,
}: {
    field: CustomFieldDto;
    value: string;
    disabled: boolean;
    busy: boolean;
    onChange: (value: string) => void;
    onCommit: (value: string) => void;
}) {
    if (field.type === 'select' || field.type === 'checkbox') {
        const choices: [string, string][] =
            field.type === 'checkbox'
                ? [['true', 'Yes'], ['false', 'No']]
                : field.options.map((option) => [option, option] as [string, string]);
        return (
            <Select value={value} disabled={disabled || busy} aria-label={field.name} onChange={(event) => onCommit(event.target.value)}>
                <option value="">Not set</option>
                {choices.map(([option, label]) => (
                    <option key={option} value={option}>
                        {label}
                    </option>
                ))}
            </Select>
        );
    }

    if (field.type === 'date') {
        return <Input type="date" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={() => onCommit(value)} />;
    }

    return (
        <Input
            type={field.type === 'number' ? 'number' : 'text'}
            value={value}
            disabled={disabled}
            inputMode={field.type === 'number' ? 'numeric' : undefined}
            step={field.type === 'number' ? 'any' : undefined}
            maxLength={field.type === 'number' ? undefined : 2000}
            aria-label={field.name}
            placeholder={field.type === 'number' ? '0' : undefined}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => onCommit(value)}
        />
    );
}
