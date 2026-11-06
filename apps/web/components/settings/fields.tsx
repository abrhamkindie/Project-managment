'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
    CUSTOM_FIELD_TYPES,
    CUSTOM_FIELD_TYPE_HINT,
    CUSTOM_FIELD_TYPE_LABEL,
} from '~/lib/format';
import {
    useCreateCustomField,
    useCustomFields,
    useDeleteCustomField,
    useProjects,
    useUpdateCustomField,
} from '~/lib/hooks';
import { isManagerPlus } from '~/lib/roles';
import type { CustomFieldDto, CustomFieldType, OrgRole } from '~/lib/types';
import { Button, ErrorNote, Field, Input, Select, Spinner } from '../ui';
import { PanelBlock } from './shared';

/**
 * Custom field definitions (Phase 6).
 *
 * A definition is either workspace-wide vocabulary every project sees, or narrowed to one project.
 * The scope selector is really a filter over the same list endpoint: workspace shows only the shared
 * fields, a project shows those plus its own — exactly what `fetchCustomFields` returns, so what is on
 * screen is what a task form in that scope will offer.
 *
 * Only the shape can be edited here. The type is fixed once created, because every value is stored as
 * a plain string and retyping a field would silently reinterpret the ones already typed.
 */

/** A blank-row sentinel for the scope picker: '' means workspace-wide, no project. */
const WORKSPACE = '';

export function CustomFieldsPanel({ orgId, role }: { orgId: string; role: OrgRole }) {
    const [scope, setScope] = useState(WORKSPACE);
    const projectId = scope || undefined;
    const fields = useCustomFields(orgId, projectId);
    const projects = useProjects(orgId, { pageSize: 100 });

    // Workspace-wide shapes rewrite every team's task form, so they are a manager call; a
    // project-scoped one follows that project's own edit rule, which the API re-checks regardless.
    const canManage = isManagerPlus(role);

    return (
        <PanelBlock title="Custom fields" icon={<Pencil className="h-3.5 w-3.5" />}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
                <Field label="Scope" hint="A workspace-wide field appears in every project; a project field only in that one.">
                    <Select value={scope} onChange={(event) => setScope(event.target.value)}>
                        <option value={WORKSPACE}>Workspace-wide</option>
                        {(projects.data?.items ?? []).map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.name}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>

            {fields.isLoading ? <Spinner label="Loading fields…" /> : null}
            <ErrorNote error={fields.error} />

            <ul className="divide-y divide-line rounded-lg border border-line">
                {(fields.data ?? []).map((field) => (
                    <li key={field.id}>
                        <FieldRow field={field} orgId={orgId} projectId={projectId} scopeLabel={scope ? 'project' : 'workspace'} canManage={canManage} />
                    </li>
                ))}
                {fields.data && fields.data.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-ink-muted">No custom fields in this scope.</li>
                ) : null}
            </ul>

            {canManage ? <CreateFieldForm orgId={orgId} projectId={projectId} /> : null}
        </PanelBlock>
    );
}

function FieldRow({
    field,
    orgId,
    projectId,
    scopeLabel,
    canManage,
}: {
    field: CustomFieldDto;
    orgId: string;
    projectId?: string;
    scopeLabel: string;
    canManage: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const update = useUpdateCustomField(orgId, projectId);
    const remove = useDeleteCustomField(orgId, projectId);

    return (
        <div className="px-3 py-2.5">
            <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-ink">{field.name}</span>
                        <span className="text-xs text-ink-faint">{CUSTOM_FIELD_TYPE_LABEL[field.type]}</span>
                        {field.projectId ? null : <span className="text-xs text-ink-faint">· {scopeLabel}</span>}
                    </span>
                    {field.type === 'select' ? (
                        <span className="mt-0.5 block truncate text-xs text-ink-faint">{field.options.join(' · ')}</span>
                    ) : null}
                </span>
                {canManage ? (
                    <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing((current) => !current)}>
                            {editing ? 'Cancel' : 'Edit'}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            aria-label={`Delete ${field.name}`}
                            loading={remove.isPending && remove.variables === field.id}
                            onClick={() => remove.mutate(field.id)}
                        />
                    </>
                ) : null}
            </div>

            {editing ? (
                <EditFieldForm
                    field={field}
                    orgId={orgId}
                    projectId={projectId}
                    onCancel={() => setEditing(false)}
                    onSave={(patch) =>
                        update.mutate({ fieldId: field.id, patch }, { onSuccess: () => setEditing(false) })
                    }
                    saving={update.isPending}
                    error={update.error}
                />
            ) : null}
        </div>
    );
}

/** The name plus, for a select only, the option list — one per line. Everything else has nothing to edit. */
function EditFieldForm({
    field,
    onCancel,
    onSave,
    saving,
    error,
}: {
    field: CustomFieldDto;
    orgId: string;
    projectId?: string;
    onCancel: () => void;
    onSave: (patch: { name?: string; options?: string[] }) => void;
    saving: boolean;
    error: unknown;
}) {
    const [name, setName] = useState(field.name);
    const [options, setOptions] = useState(field.options.join('\n'));

    const parsedOptions = options
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const nameValid = name.trim().length > 0;
    const optionsValid = field.type !== 'select' || parsedOptions.length > 0;

    const patch: { name?: string; options?: string[] } = {};
    if (name.trim() && name.trim() !== field.name) patch.name = name.trim();
    if (field.type === 'select' && parsedOptions.join('\n') !== field.options.join('\n')) patch.options = parsedOptions;

    return (
        <form
            className="mt-2 space-y-2 rounded-lg border border-line bg-subtle/40 p-3"
            onSubmit={(event) => {
                event.preventDefault();
                onSave(patch);
            }}
        >
            <ErrorNote error={error} />
            <Field label="Name">
                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
            </Field>
            {field.type === 'select' ? (
                <Field label="Options" hint="One per line. Removing one clears it from any task that held it." error={optionsValid ? undefined : 'A dropdown needs at least one option'}>
                    <textarea
                        className="input min-h-24 font-mono text-xs"
                        value={options}
                        onChange={(event) => setOptions(event.target.value)}
                    />
                </Field>
            ) : (
                <p className="text-xs text-ink-faint">The type ({CUSTOM_FIELD_TYPE_LABEL[field.type]}) cannot change once tasks hold values.</p>
            )}
            <div className="flex gap-2">
                <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    loading={saving}
                    disabled={!nameValid || !optionsValid || Object.keys(patch).length === 0}
                >
                    Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}

function CreateFieldForm({ orgId, projectId }: { orgId: string; projectId?: string }) {
    const create = useCreateCustomField(orgId, projectId);
    const [name, setName] = useState('');
    const [type, setType] = useState<CustomFieldType>('text');
    const [options, setOptions] = useState('');

    const parsedOptions = options
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const nameValid = name.trim().length > 0;
    const optionsValid = type !== 'select' || parsedOptions.length > 0;

    return (
        <form
            className="space-y-3 rounded-lg border border-line bg-subtle/40 p-3"
            onSubmit={(event) => {
                event.preventDefault();
                create.mutate(
                    {
                        name: name.trim(),
                        type,
                        projectId: projectId ?? null,
                        options: type === 'select' ? parsedOptions : undefined,
                    },
                    {
                        onSuccess: () => {
                            setName('');
                            setOptions('');
                            setType('text');
                        },
                    },
                );
            }}
        >
            <ErrorNote error={create.error} />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Field label="Field name">
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Release tier" maxLength={60} />
                </Field>
                <Field label="Type" hint={CUSTOM_FIELD_TYPE_HINT[type]}>
                    <Select value={type} onChange={(event) => setType(event.target.value as CustomFieldType)}>
                        {CUSTOM_FIELD_TYPES.map((value) => (
                            <option key={value} value={value}>
                                {CUSTOM_FIELD_TYPE_LABEL[value]}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>
            {type === 'select' ? (
                <Field label="Options" hint="One per line." error={optionsValid ? undefined : 'Add at least one option'}>
                    <textarea className="input min-h-24 font-mono text-xs" value={options} onChange={(event) => setOptions(event.target.value)} />
                </Field>
            ) : null}
            <Button type="submit" variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} loading={create.isPending} disabled={!nameValid || !optionsValid}>
                Add field
            </Button>
        </form>
    );
}
