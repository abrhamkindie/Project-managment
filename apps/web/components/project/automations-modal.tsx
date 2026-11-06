'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import {
    AUTOMATION_ACTIONS,
    AUTOMATION_ACTION_LABEL,
    AUTOMATION_TRIGGERS,
    AUTOMATION_TRIGGER_LABEL,
    PRIORITY_LABEL,
    STATUS_LABEL,
    WEBHOOK_EVENTS,
    WEBHOOK_EVENT_LABEL,
} from '~/lib/format';
import {
    useAutomationRules,
    useCreateAutomation,
    useDeleteAutomation,
    useLabels,
    usePeople,
    useUpdateAutomation,
} from '~/lib/hooks';
import type {
    AutomationActionDto,
    AutomationActionKind,
    AutomationRuleDto,
    AutomationTriggerEvent,
    CreateAutomationBody,
    TaskPriority,
    TaskStatus,
} from '~/lib/types';
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Skeleton } from '../ui';

/**
 * Project automations: a trigger, optional filters, and a list of fixed action primitives.
 *
 * There is no expression language on the server (`domain/enums.ts` lists the primitives), so the
 * builder can be nothing but dropdowns — and every `value` control below is a picker over the same
 * data the rest of the project uses: statuses, priorities, this workspace's people and labels.
 * A rule the API could not honour is not offerable here.
 *
 * Editing reuses the create form: a rule is a whole document, and patching one field of a stored
 * JSON blob would either lose the rest or need a second shape to keep it honest.
 */

/** The form's own draft shape: strings, with "" meaning "not set". */
interface Draft {
    name: string;
    event: AutomationTriggerEvent;
    from: TaskStatus | '';
    to: TaskStatus | '';
    priority: TaskPriority | '';
    hasLabelId: string;
    actions: { kind: AutomationActionKind; value: string }[];
}

const EMPTY: Draft = { name: '', event: 'task.status_changed', from: '', to: '', priority: '', hasLabelId: '', actions: [{ kind: 'set_priority', value: '' }] };

const STATUSES = Object.keys(STATUS_LABEL) as TaskStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as TaskPriority[];

const toDraft = (rule: AutomationRuleDto): Draft => ({
    name: rule.name,
    event: rule.trigger.event,
    from: rule.trigger.conditions?.from ?? '',
    to: rule.trigger.conditions?.to ?? '',
    priority: rule.trigger.conditions?.priority ?? '',
    hasLabelId: rule.trigger.conditions?.hasLabelId ?? '',
    actions: rule.actions.map((action) => ({ kind: action.kind, value: String(action.value) })),
});

/** Actions take their value from a picker, so an unset one is not a rule yet. */
function build(body: Draft): CreateAutomationBody | null {
    const conditions = {
        ...(body.from ? { from: body.from } : {}),
        ...(body.to ? { to: body.to } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.hasLabelId ? { hasLabelId: body.hasLabelId } : {}),
    };
    const actions = body.actions.filter((action) => action.value !== '');
    if (body.name.trim().length < 2 || actions.length === 0 || actions.length > 6) return null;
    return {
        name: body.name.trim(),
        trigger: { event: body.event, ...(Object.keys(conditions).length ? { conditions } : {}) },
        actions: actions.map((action) => ({ kind: action.kind, value: action.value })),
    };
}

export function AutomationsModal({
    projectId,
    orgId,
    canEdit,
    onClose,
}: {
    projectId: string;
    orgId: string;
    canEdit: boolean;
    onClose: () => void;
}) {
    const rules = useAutomationRules(projectId);
    const create = useCreateAutomation(projectId);
    const update = useUpdateAutomation(projectId);
    const remove = useDeleteAutomation(projectId);
    const labels = useLabels(orgId);
    const roster = usePeople(orgId);

    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [editing, setEditing] = useState<string | null>(null);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
    const setAction = (index: number, value: Partial<{ kind: AutomationActionKind; value: string }>) =>
        setDraft((current) => ({ ...current, actions: current.actions.map((action, at) => (at === index ? { ...action, ...value } : action)) }));

    const body = build(draft);
    const pending = create.isPending || update.isPending;

    const startEdit = (rule: AutomationRuleDto) => {
        setEditing(rule.id);
        setDraft(toDraft(rule));
    };

    const submit = () => {
        if (!body) return;
        const done = () => {
            setEditing(null);
            setDraft(EMPTY);
        };
        if (editing) update.mutate({ id: editing, ...body }, { onSuccess: done });
        else create.mutate(body, { onSuccess: done });
    };

    return (
        <Modal title="Automations" description="Rules that run when something happens in this project." onClose={onClose} width="max-w-2xl">
            <div className="space-y-5">
                <ul className="space-y-2">
                    {rules.isLoading ? <Skeleton className="h-16 w-full" /> : null}
                    {(rules.data ?? []).map((rule) => (
                        <li key={rule.id} className="rounded-lg border border-line p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                                        {rule.name}
                                        {rule.active ? <Badge tone="success">On</Badge> : <Badge>Paused</Badge>}
                                        {editing === rule.id ? <Badge tone="brand">Editing</Badge> : null}
                                    </p>
                                    <p className="mt-1 text-xs text-ink-muted">{describeRule(rule, { labels: labels.data ?? [], people: roster.people })}</p>
                                </div>
                                {canEdit ? (
                                    <div className="flex shrink-0 gap-1">
                                        <Button size="sm" variant="ghost" loading={update.isPending && update.variables?.id === rule.id} onClick={() => update.mutate({ id: rule.id, active: !rule.active })}>
                                            {rule.active ? 'Pause' : 'Resume'}
                                        </Button>
                                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} aria-label="Edit rule" onClick={() => startEdit(rule)} />
                                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label="Delete rule" onClick={() => remove.mutate(rule.id)} />
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    ))}
                    {rules.data && rules.data.length === 0 ? (
                        <li className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-ink-muted">No rules yet. Nothing happens automatically in this project.</li>
                    ) : null}
                </ul>

                {canEdit ? (
                    <div className="space-y-3 rounded-lg border border-line bg-subtle/40 p-3">
                        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                            <Zap className="h-3.5 w-3.5" />
                            {editing ? 'Edit rule' : 'New rule'}
                        </h3>
                        <ErrorNote error={create.error ?? update.error} />

                        <Field label="Name">
                            <Input value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder="Urgent bugs go to review" maxLength={80} />
                        </Field>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="When">
                                <Select value={draft.event} onChange={(event) => set('event', event.target.value as AutomationTriggerEvent)}>
                                    {AUTOMATION_TRIGGERS.map((event) => (
                                        <option key={event} value={event}>
                                            {AUTOMATION_TRIGGER_LABEL[event]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Only if the task has this label">
                                <Select value={draft.hasLabelId} onChange={(event) => set('hasLabelId', event.target.value)}>
                                    <option value="">Any label</option>
                                    {(labels.data ?? []).map((label) => (
                                        <option key={label.id} value={label.id}>
                                            {label.name}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            {draft.event === 'task.status_changed' ? (
                                <>
                                    <Field label="From status">
                                        <Select value={draft.from} onChange={(event) => set('from', event.target.value as TaskStatus | '')}>
                                            <option value="">Any</option>
                                            {STATUSES.map((status) => (
                                                <option key={status} value={status}>
                                                    {STATUS_LABEL[status]}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field label="To status">
                                        <Select value={draft.to} onChange={(event) => set('to', event.target.value as TaskStatus | '')}>
                                            <option value="">Any</option>
                                            {STATUSES.map((status) => (
                                                <option key={status} value={status}>
                                                    {STATUS_LABEL[status]}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                </>
                            ) : null}
                            <Field label="Priority is">
                                <Select value={draft.priority} onChange={(event) => set('priority', event.target.value as TaskPriority | '')}>
                                    <option value="">Any</option>
                                    {PRIORITIES.map((priority) => (
                                        <option key={priority} value={priority}>
                                            {PRIORITY_LABEL[priority]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </div>

                        <div className="space-y-2">
                            <p className="label">Then</p>
                            {draft.actions.map((action, index) => (
                                <div key={index} className="flex flex-wrap items-end gap-2">
                                    <div className="min-w-[10rem]">
                                        <Field label={index === 0 ? undefined : ' '}>
                                            <Select
                                                value={action.kind}
                                                onChange={(event) =>
                                                    // The value belongs to the kind, so changing one invalidates the other.
                                                    setDraft((current) => ({
                                                        ...current,
                                                        actions: current.actions.map((entry, at) => (at === index ? { kind: event.target.value as AutomationActionKind, value: '' } : entry)),
                                                    }))
                                                }
                                            >
                                                {AUTOMATION_ACTIONS.map((kind) => (
                                                    <option key={kind} value={kind}>
                                                        {AUTOMATION_ACTION_LABEL[kind]}
                                                    </option>
                                                ))}
                                            </Select>
                                        </Field>
                                    </div>
                                    <ActionValue
                                        action={action}
                                        labels={labels.data ?? []}
                                        people={roster.people}
                                        onChange={(value) => setAction(index, { value })}
                                    />
                                    {draft.actions.length > 1 ? (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            icon={<Trash2 className="h-3.5 w-3.5" />}
                                            aria-label="Remove action"
                                            onClick={() => setDraft((current) => ({ ...current, actions: current.actions.filter((_, at) => at !== index) }))}
                                        />
                                    ) : null}
                                </div>
                            ))}
                            <Button
                                size="sm"
                                variant="ghost"
                                icon={<Plus className="h-3.5 w-3.5" />}
                                disabled={draft.actions.length >= 6}
                                onClick={() => setDraft((current) => ({ ...current, actions: [...current.actions, { kind: 'notify', value: '' }] }))}
                            >
                                Add action
                            </Button>
                        </div>

                        <div className="flex gap-2">
                            <Button variant="primary" size="sm" loading={pending} disabled={!body} onClick={submit}>
                                {editing ? 'Save rule' : 'Create rule'}
                            </Button>
                            {editing ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setEditing(null);
                                        setDraft(EMPTY);
                                    }}
                                >
                                    Cancel edit
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-ink-muted">You can see the rules for this project but not change them.</p>
                )}
            </div>
        </Modal>
    );
}

/** The value control that matches an action's kind — a picker wherever the API expects an id. */
function ActionValue({
    action,
    labels,
    people,
    onChange,
}: {
    action: { kind: AutomationActionKind; value: string };
    labels: { id: string; name: string }[];
    people: { id: string; firstName: string; lastName: string }[];
    onChange: (value: string) => void;
}) {
    // One shape for every kind: `Field` owns no layout of its own, so the width lives on the wrapper.
    let options: { value: string; label: string }[] = [];
    let placeholder = 'Choose…';
    if (action.kind === 'set_status') options = STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));
    else if (action.kind === 'set_priority') options = PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }));
    else if (action.kind === 'assign') {
        options = people.map((person) => ({ value: person.id, label: `${person.firstName} ${person.lastName}` }));
        placeholder = 'Choose a person…';
    } else if (action.kind === 'add_label') {
        options = labels.map((label) => ({ value: label.id, label: label.name }));
        placeholder = 'Choose a label…';
    } else if (action.kind === 'webhook') {
        options = WEBHOOK_EVENTS.map((event) => ({ value: event, label: WEBHOOK_EVENT_LABEL[event] }));
        placeholder = 'Choose an event…';
    }

    return (
        <div className="min-w-[9rem] flex-1">
            <Field label=" ">
                {action.kind === 'notify' ? (
                    // The only free-text value: it becomes the notification title for task watchers.
                    <Input value={action.value} onChange={(event) => onChange(event.target.value)} placeholder="Message title" maxLength={120} />
                ) : (
                    <Select value={action.value} onChange={(event) => onChange(event.target.value)}>
                        <option value="">{placeholder}</option>
                        {options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
        </div>
    );
}

/** One sentence per rule, so a list of them reads like a policy and not like JSON. */
function describeRule(rule: AutomationRuleDto, { labels, people }: { labels: { id: string; name: string }[]; people: { id: string; firstName: string; lastName: string }[] }): string {
    const conditions = rule.trigger.conditions ?? {};
    // A deleted label or an ex-member still has to be described: fall back to the raw id rather
    // than dropping the action, because the rule does still carry it.
    const nameOf = <T extends { id: string }>(list: T[], id: string | undefined, label: (entry: T) => string): string => {
        const entry = id ? list.find((candidate) => candidate.id === id) : undefined;
        return entry ? label(entry) : '';
    };
    const filters = [
        conditions.from ? `from ${STATUS_LABEL[conditions.from]}` : '',
        conditions.to ? `to ${STATUS_LABEL[conditions.to]}` : '',
        conditions.priority ? `priority ${PRIORITY_LABEL[conditions.priority]}` : '',
        conditions.hasLabelId ? `labelled ${nameOf(labels, conditions.hasLabelId, (label) => label.name) || 'that label'}` : '',
    ].filter(Boolean);

    const actions = rule.actions
        .map((action: AutomationActionDto) => {
            const value = String(action.value);
            switch (action.kind) {
                case 'set_status':
                    return `set status to ${STATUS_LABEL[value as TaskStatus] ?? value}`;
                case 'set_priority':
                    return `set priority to ${PRIORITY_LABEL[value as TaskPriority] ?? value}`;
                case 'assign':
                    return `assign ${nameOf(people, value, (person) => `${person.firstName} ${person.lastName}`) || 'someone'}`;
                case 'add_label':
                    return `add ${nameOf(labels, value, (label) => label.name) || 'a label'}`;
                case 'notify':
                    return `notify watchers: “${value}”`;
                default:
                    return `send ${WEBHOOK_EVENT_LABEL[value as keyof typeof WEBHOOK_EVENT_LABEL] ?? value} to webhooks`;
            }
        })
        .join(', then ');

    return `${AUTOMATION_TRIGGER_LABEL[rule.trigger.event]}${filters.length ? ` (${filters.join(', ')})` : ''} → ${actions}.`;
}
