'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    Archive,
    Calendar,
    CheckCircle2,
    ChevronRight,
    Clock,
    Copy,
    Download,
    File as FileIcon,
    FileText,
    Flag,
    GripVertical,
    Image as ImageIcon,
    Link2,
    ListTree,
    MoreHorizontal,
    Paperclip,
    Plus,
    Sheet,
    Tag,
    Trash2,
    UserPlus,
    X,
} from 'lucide-react';
import clsx from 'clsx';
import {
    PRIORITY_LABEL,
    STATUS_LABEL,
    STATUS_ORDER,
    STATUS_TOKEN,
    formatSize,
    fullName,
    relativeTime,
    toDateInput,
    fromDateInput,
    formatDate,
    dueLabel,
    dueTone,
    DUE_CLASS,
    PRIORITY_CLASS,
} from '~/lib/format';
import {
    useAttachments,
    useDeleteTask,
    useLabels,
    usePeople,
    useSetAssignees,
    useSetLabels,
    useTask,
    useUpdateTask,
} from '~/lib/hooks';
import type { AttachmentDto, TaskCardDto, TaskDetailDto, TaskPriority } from '~/lib/types';
import { Avatar, Button, EmptyState, Menu, MenuItem, Spinner, Tabs, Textarea } from '../ui';
import { UserPicker } from '../user-picker';
import { Discussion } from './discussion';
import { QuickAdd } from './quick-add';

/**
 * Task detail drawer, laid out as a single column so the eye reads top-to-bottom without
 * hunting across a sidebar. Reference: Craftboard / Dribbble 23761306.
 *
 * Zones:
 *   1. Breadcrumb bar — project · column, plus copy-link / more / close
 *   2. Big title (inline editable)
 *   3. Property rows — icon + label on the left, editable value on the right, one per line
 *   4. Description card
 *   5. Attachment cards (grid) with a trailing "+" card
 *   6. Tabs — Subtasks · Comments · Activities
 *   7. Meta footer + Danger zone
 *
 * Fields save on blur or on select-change; the URL owns which task is open (see `ProjectWorkspace`).
 */
export function TaskDrawer({
    orgId,
    projectId,
    taskId,
    sections,
    viewerId,
    canEdit,
    onClose,
    onOpenTask,
}: {
    orgId: string;
    projectId: string;
    taskId: string;
    sections: { id: string; name: string; isDone: boolean }[];
    viewerId: string;
    canEdit: boolean;
    onClose: () => void;
    onOpenTask: (taskId: string) => void;
}) {
    const detail = useTask(taskId);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <>
            <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden />
            <aside
                className="animate-drawer fixed right-0 top-0 z-40 flex h-full w-full max-w-full flex-col border-l border-line bg-surface shadow-2xl md:w-[640px]"
                aria-label="Task details"
            >
                {detail.isLoading ? (
                    <>
                        <SlimHeader onClose={onClose} />
                        <div className="grid flex-1 place-items-center">
                            <Spinner />
                        </div>
                    </>
                ) : detail.isError || !detail.data ? (
                    <>
                        <SlimHeader onClose={onClose} />
                        <div className="flex-1 overflow-y-auto p-4">
                            <EmptyState
                                title="This task could not be loaded"
                                description="It may have been deleted, or you may no longer have access to its project."
                            />
                        </div>
                    </>
                ) : (
                    <DrawerBody
                        task={detail.data}
                        orgId={orgId}
                        projectId={projectId}
                        sections={sections}
                        viewerId={viewerId}
                        canEdit={canEdit}
                        onClose={onClose}
                        onOpenTask={onOpenTask}
                    />
                )}
            </aside>
        </>
    );
}

function SlimHeader({ onClose }: { onClose: () => void }) {
    return (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Task</span>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close task details"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

function DrawerBody({
    task,
    orgId,
    projectId,
    sections,
    viewerId,
    canEdit,
    onClose,
    onOpenTask,
}: {
    task: TaskDetailDto;
    orgId: string;
    projectId: string;
    sections: { id: string; name: string; isDone: boolean }[];
    viewerId: string;
    canEdit: boolean;
    onClose: () => void;
    onOpenTask: (taskId: string) => void;
}) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [copied, setCopied] = useState(false);
    const currentSection = sections.find((s) => s.id === task.sectionId);

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Clipboard is unavailable (insecure context / permission denied) — silently no-op.
        }
    };

    return (
        <>
            {/* 1. Breadcrumb bar */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.project.color }} aria-hidden />
                <span className="truncate font-medium text-ink-soft">{task.project.name}</span>
                {currentSection ? (
                    <>
                        <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint" />
                        <span className="truncate text-ink-muted">{currentSection.name}</span>
                    </>
                ) : null}
                {task.parent ? (
                    <>
                        <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint" />
                        <button
                            type="button"
                            onClick={() => onOpenTask(task.parent!.id)}
                            className="inline-flex min-w-0 items-center gap-1 truncate text-ink-muted hover:text-brand-700"
                            title={task.parent.title}
                        >
                            <Link2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{task.parent.title}</span>
                        </button>
                    </>
                ) : null}

                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={copyLink}
                        aria-label="Copy task link"
                        title={copied ? 'Link copied' : 'Copy link'}
                        className={clsx(
                            'flex h-7 w-7 items-center justify-center rounded-md transition',
                            copied ? 'bg-green-50 text-green-700' : 'text-ink-muted hover:bg-subtle hover:text-ink',
                        )}
                    >
                        <Copy className="h-3.5 w-3.5" />
                    </button>
                    {canEdit ? (
                        <Menu
                            trigger={(open) => (
                                <button
                                    type="button"
                                    aria-label="More actions"
                                    className={clsx(
                                        'flex h-7 w-7 items-center justify-center rounded-md transition',
                                        open ? 'bg-subtle text-ink' : 'text-ink-muted hover:bg-subtle hover:text-ink',
                                    )}
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </button>
                            )}
                        >
                            <MenuItem tone="danger" icon={<Trash2 className="h-4 w-4" />} onSelect={() => setConfirmDelete(true)}>
                                Delete task
                            </MenuItem>
                        </Menu>
                    ) : null}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close task details"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-subtle hover:text-ink"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 pb-8 pt-5">
                <TitleBlock task={task} canEdit={canEdit} />
                <PropertyList task={task} sections={sections} canEdit={canEdit} orgId={orgId} />
                <DescriptionBlock task={task} canEdit={canEdit} />
                <AttachmentsBlock task={task} canEdit={canEdit} />
                <BottomTabs task={task} orgId={orgId} projectId={projectId} viewerId={viewerId} canEdit={canEdit} onOpenTask={onOpenTask} />

                <MetaFooter task={task} />
            </div>

            {confirmDelete ? <DeleteDialog task={task} onCancel={() => setConfirmDelete(false)} /> : null}
        </>
    );
}

// ---------------------------------------------------------------- title

function TitleBlock({ task, canEdit }: { task: TaskDetailDto; canEdit: boolean }) {
    const update = useUpdateTask();
    const [title, setTitle] = useState(task.title);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (!editing) setTitle(task.title);
    }, [task.title, editing]);

    const save = () => {
        setEditing(false);
        const next = title.trim();
        if (!next || next === task.title) {
            setTitle(task.title);
            return;
        }
        update.mutate({ taskId: task.id, patch: { title: next } });
    };

    return (
        <h1 className="mb-4">
            <input
                value={title}
                disabled={!canEdit}
                maxLength={200}
                aria-label="Task title"
                onFocus={() => setEditing(true)}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={save}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                }}
                className={clsx(
                    '-mx-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[24px] font-semibold leading-tight tracking-tight text-ink outline-none transition',
                    'hover:border-line focus:border-brand-500 focus:bg-canvas disabled:cursor-default disabled:hover:border-transparent',
                )}
            />
        </h1>
    );
}

// ---------------------------------------------------------------- properties

/**
 * Each row is a label:value pair with a leading icon. Values are inline-editable controls that
 * look like plain text until focused — the drawer reads like a document, not a form.
 */
function PropertyList({
    task,
    sections,
    canEdit,
    orgId,
}: {
    task: TaskDetailDto;
    sections: { id: string; name: string; isDone: boolean }[];
    canEdit: boolean;
    orgId: string;
}) {
    const update = useUpdateTask();
    const tone = dueTone(task.dueDate, task.status, task.isOverdue);

    return (
        <div className="mb-5 space-y-1">
            <PropertyRow icon={<CheckCircle2 className="h-4 w-4" />} label="Status">
                <InlineSelect
                    value={task.status}
                    disabled={!canEdit}
                    ariaLabel="Status"
                    onChange={(value) => update.mutate({ taskId: task.id, patch: { status: value as TaskDetailDto['status'] } })}
                    options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                    leading={<span className={clsx('status-dot', STATUS_TOKEN[task.status])} aria-hidden />}
                />
            </PropertyRow>

            <PropertyRow icon={<Flag className="h-4 w-4" />} label="Priority">
                <InlineSelect
                    value={task.priority}
                    disabled={!canEdit}
                    ariaLabel="Priority"
                    onChange={(value) => update.mutate({ taskId: task.id, patch: { priority: value as TaskPriority } })}
                    options={(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                    valueClassName={clsx('font-medium', PRIORITY_CLASS[task.priority])}
                />
            </PropertyRow>

            <PropertyRow icon={<Calendar className="h-4 w-4" />} label="Due date">
                <InlineDate
                    value={toDateInput(task.dueDate)}
                    disabled={!canEdit}
                    ariaLabel="Due date"
                    displayValue={task.dueDate ? dueLabel(task.dueDate) : 'Set a due date'}
                    displayClassName={clsx(task.dueDate && DUE_CLASS[tone])}
                    onChange={(value) => update.mutate({ taskId: task.id, patch: { dueDate: fromDateInput(value) } })}
                />
            </PropertyRow>

            <PropertyRow icon={<Clock className="h-4 w-4" />} label="Start date">
                <InlineDate
                    value={toDateInput(task.startDate)}
                    disabled={!canEdit}
                    ariaLabel="Start date"
                    displayValue={task.startDate ? formatDate(task.startDate) : 'Set a start date'}
                    onChange={(value) => update.mutate({ taskId: task.id, patch: { startDate: fromDateInput(value) } })}
                />
            </PropertyRow>

            {sections.length > 0 ? (
                <PropertyRow icon={<Archive className="h-4 w-4" />} label="Column" hint="Moving to a done column completes the task">
                    <InlineSelect
                        // An empty value means "the pool", which the API cannot move a card back into.
                        value={task.sectionId ?? sections[0]?.id ?? ''}
                        disabled={!canEdit}
                        ariaLabel="Column"
                        onChange={(value) => update.mutate({ taskId: task.id, patch: { sectionId: value } })}
                        options={sections.map((s) => ({ value: s.id, label: s.name }))}
                    />
                </PropertyRow>
            ) : null}

            <PropertyRow icon={<Clock className="h-4 w-4" />} label="Estimate">
                <div className="inline-flex items-center gap-1.5">
                    <input
                        type="number"
                        min={0}
                        max={100000}
                        step={15}
                        value={task.estimateMins ?? ''}
                        disabled={!canEdit}
                        aria-label="Estimate in minutes"
                        placeholder="—"
                        onChange={(event) => update.mutate({ taskId: task.id, patch: { estimateMins: event.target.value ? Number(event.target.value) : null } })}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-line focus:border-brand-500 focus:bg-canvas focus:outline-none"
                    />
                    <span className="text-xs text-ink-faint">minutes</span>
                </div>
            </PropertyRow>

            <AssigneeRow task={task} orgId={orgId} canEdit={canEdit} />
            <TagsRow task={task} orgId={orgId} canEdit={canEdit} />

            <PropertyRow icon={<Flag className="h-4 w-4" />} label="Milestone">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                    <input
                        type="checkbox"
                        className="checkbox"
                        checked={task.isMilestone}
                        disabled={!canEdit}
                        onChange={(event) => update.mutate({ taskId: task.id, patch: { isMilestone: event.target.checked } })}
                    />
                    {task.isMilestone ? 'Yes, this is a milestone' : 'No'}
                </label>
            </PropertyRow>
        </div>
    );
}

function PropertyRow({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex items-start gap-3 py-1.5">
            <div className="flex w-32 shrink-0 items-center gap-2 pt-1 text-sm text-ink-muted">
                <span className="text-ink-faint">{icon}</span>
                <span>{label}</span>
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
                {children}
                {hint ? <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p> : null}
            </div>
        </div>
    );
}

/**
 * A `<select>` styled to look like plain text until hover. The visible label is the current
 * option; the native dropdown handles keyboard + a11y for free.
 */
function InlineSelect({
    value,
    onChange,
    options,
    disabled,
    ariaLabel,
    leading,
    valueClassName,
}: {
    value: string;
    onChange: (next: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
    ariaLabel: string;
    leading?: ReactNode;
    valueClassName?: string;
}) {
    const current = options.find((o) => o.value === value)?.label ?? '—';
    return (
        <label className={clsx('group relative inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition', !disabled && 'hover:bg-canvas cursor-pointer')}>
            {leading}
            <span className={clsx('text-ink', valueClassName)}>{current}</span>
            {!disabled ? (
                <select
                    aria-label={ariaLabel}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            ) : null}
        </label>
    );
}

/** Date input that renders as a text pill until clicked. */
function InlineDate({
    value,
    onChange,
    displayValue,
    displayClassName,
    disabled,
    ariaLabel,
}: {
    value: string;
    onChange: (next: string) => void;
    displayValue: string;
    displayClassName?: string;
    disabled?: boolean;
    ariaLabel: string;
}) {
    return (
        <label className={clsx('group relative inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm transition', !disabled && 'hover:bg-canvas cursor-pointer')}>
            <span className={clsx('text-ink', displayClassName, !value && 'text-ink-faint')}>{displayValue}</span>
            {!disabled ? (
                <input
                    type="date"
                    aria-label={ariaLabel}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
            ) : null}
        </label>
    );
}

function AssigneeRow({ task, orgId, canEdit }: { task: TaskDetailDto; orgId: string; canEdit: boolean }) {
    const assign = useSetAssignees();
    const people = usePeople(orgId);
    const [open, setOpen] = useState(false);

    return (
        <PropertyRow icon={<UserPlus className="h-4 w-4" />} label="Assignee">
            <div className="flex flex-wrap items-center gap-1.5">
                {task.assignees.map((user) => (
                    <span key={user.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas py-0.5 pl-0.5 pr-2 text-xs">
                        <Avatar user={user} size="xs" />
                        <span className="text-ink-soft">{fullName(user)}</span>
                        {user.isPrimary ? <span className="text-[10px] uppercase text-brand-600">lead</span> : null}
                        {canEdit ? (
                            <button
                                type="button"
                                aria-label={`Unassign ${fullName(user)}`}
                                className="text-ink-faint hover:text-danger"
                                onClick={() => assign.mutate({ taskId: task.id, body: { userIds: task.assigneeIds.filter((id) => id !== user.id) } })}
                            >
                                ×
                            </button>
                        ) : null}
                    </span>
                ))}
                {canEdit ? (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-xs text-ink-muted transition hover:border-brand-300 hover:text-brand-700"
                    >
                        <UserPlus className="h-3 w-3" />
                        Invite
                    </button>
                ) : null}
                {task.assignees.length === 0 && !canEdit ? <span className="text-sm text-ink-faint">Unassigned</span> : null}
            </div>

            {open && canEdit ? (
                <div className="mt-2 rounded-lg border border-line bg-surface p-2.5">
                    <UserPicker
                        users={people.people}
                        value={task.assigneeIds}
                        label="Pick who works on this"
                        onChange={(next) => assign.mutate({ taskId: task.id, body: { userIds: next } })}
                    />
                    <div className="mt-2 flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                            Done
                        </Button>
                    </div>
                </div>
            ) : null}
        </PropertyRow>
    );
}

function TagsRow({ task, orgId, canEdit }: { task: TaskDetailDto; orgId: string; canEdit: boolean }) {
    const allLabels = useLabels(orgId);
    const mutate = useSetLabels();
    const ids = task.labels.map((l) => l.id);

    if (!allLabels.data || allLabels.data.length === 0) return null;

    return (
        <PropertyRow icon={<Tag className="h-4 w-4" />} label="Tags">
            <div className="flex flex-wrap gap-1.5">
                {allLabels.data.map((label) => {
                    const active = ids.includes(label.id);
                    return (
                        <button
                            key={label.id}
                            type="button"
                            disabled={!canEdit || mutate.isPending}
                            onClick={() => mutate.mutate({ taskId: task.id, labelIds: active ? ids.filter((id) => id !== label.id) : [...ids, label.id] })}
                            className={clsx(
                                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
                                active ? 'border-transparent font-medium' : 'border-line bg-canvas text-ink-muted opacity-70 hover:opacity-100',
                            )}
                            style={active ? { backgroundColor: `${label.color}1a`, color: label.color } : undefined}
                            aria-pressed={active}
                        >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} aria-hidden />
                            {label.name}
                        </button>
                    );
                })}
            </div>
        </PropertyRow>
    );
}

// ---------------------------------------------------------------- description

function DescriptionBlock({ task, canEdit }: { task: TaskDetailDto; canEdit: boolean }) {
    const update = useUpdateTask();
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? task.description ?? '';

    const save = () => {
        if (draft === null) return;
        const next = draft.trim();
        setDraft(null);
        if (next === (task.description ?? '').trim()) return;
        update.mutate({ taskId: task.id, patch: { description: next || null } });
    };

    return (
        <section className="mb-5">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Description</h3>
            <div className="rounded-lg border border-line bg-canvas/40 p-3 transition focus-within:border-brand-300 focus-within:bg-surface">
                <Textarea
                    value={value}
                    rows={4}
                    disabled={!canEdit}
                    aria-label="Description"
                    placeholder={canEdit ? 'Add details, links or acceptance criteria…' : 'No description.'}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={save}
                    className="min-h-[64px] border-0 bg-transparent px-0 text-sm focus:ring-0"
                />
                {canEdit && draft !== null ? (
                    <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                            Cancel
                        </Button>
                        <Button size="sm" variant="primary" onClick={save}>
                            Save
                        </Button>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

// ---------------------------------------------------------------- attachments

function attachmentIcon(mime: string, name: string): ReactNode {
    const lower = name.toLowerCase();
    if (mime.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-pink-500" />;
    if (mime === 'application/pdf' || lower.endsWith('.pdf')) return <FileText className="h-5 w-5 text-red-500" />;
    if (lower.endsWith('.ai') || lower.endsWith('.psd') || lower.endsWith('.fig') || lower.endsWith('.sketch')) return <FileIcon className="h-5 w-5 text-orange-500" />;
    if (/\.(xlsx?|csv|numbers)$/.test(lower)) return <Sheet className="h-5 w-5 text-emerald-600" />;
    return <FileIcon className="h-5 w-5 text-ink-muted" />;
}

function AttachmentsBlock({ task, canEdit }: { task: TaskDetailDto; canEdit: boolean }) {
    const attachments = useAttachments(task.id);
    const fileInput = useRef<HTMLInputElement>(null);
    const list = task.attachments;

    const downloadAll = () => {
        for (const a of list) {
            const anchor = document.createElement('a');
            anchor.href = a.url;
            anchor.download = a.filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        }
    };

    return (
        <section className="mb-5">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attachment {list.length > 0 ? <span className="normal-case text-ink-soft">({list.length})</span> : null}
                </h3>
                {list.length > 0 ? (
                    <button type="button" onClick={downloadAll} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                        <Download className="h-3.5 w-3.5" />
                        Download All
                    </button>
                ) : null}
            </div>

            <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                aria-label="Upload files"
                onChange={(event) => {
                    for (const file of Array.from(event.target.files ?? [])) attachments.upload.mutate(file);
                    event.target.value = '';
                }}
            />

            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((a) => (
                    <AttachmentCard key={a.id} attachment={a} canEdit={canEdit} onRemove={() => attachments.remove.mutate(a.id)} />
                ))}
                {canEdit ? (
                    <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        disabled={attachments.upload.isPending}
                        className="flex min-h-[72px] items-center justify-center rounded-lg border border-dashed border-line bg-canvas/40 text-ink-faint transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                        aria-label="Attach a file"
                    >
                        {attachments.upload.isPending ? <Spinner /> : <Plus className="h-5 w-5" />}
                    </button>
                ) : null}
                {list.length === 0 && !canEdit ? <p className="col-span-full text-sm text-ink-muted">No files attached.</p> : null}
            </div>
        </section>
    );
}

function AttachmentCard({ attachment, canEdit, onRemove }: { attachment: AttachmentDto; canEdit: boolean; onRemove: () => void }) {
    return (
        <div className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5 transition hover:border-line-strong hover:shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas">
                {attachmentIcon(attachment.mimeType, attachment.filename)}
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={attachment.filename}>
                    {attachment.filename}
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                    <span>{formatSize(attachment.size)}</span>
                    <a href={attachment.url} download={attachment.filename} className="hover:text-brand-700 hover:underline">
                        Download
                    </a>
                </p>
            </div>
            {canEdit ? (
                <button
                    type="button"
                    aria-label={`Delete ${attachment.filename}`}
                    onClick={onRemove}
                    className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------- bottom tabs

type TabKey = 'subtasks' | 'comments' | 'activities';

function BottomTabs({
    task,
    orgId,
    projectId,
    viewerId,
    canEdit,
    onOpenTask,
}: {
    task: TaskDetailDto;
    orgId: string;
    projectId: string;
    viewerId: string;
    canEdit: boolean;
    onOpenTask: (taskId: string) => void;
}) {
    const [tab, setTab] = useState<TabKey>('subtasks');
    const counts = useMemo(() => {
        let comments = 0;
        let activities = 0;
        for (const e of task.timeline) {
            if (e.kind === 'comment') comments += 1;
            else activities += 1;
        }
        return { comments, activities };
    }, [task.timeline]);

    return (
        <section>
            <div className="mb-3 border-b border-line">
                <Tabs<TabKey>
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'subtasks', label: 'Subtasks' },
                        { value: 'comments', label: 'Comments', count: counts.comments },
                        { value: 'activities', label: 'Activities', count: counts.activities },
                    ]}
                />
            </div>

            {tab === 'subtasks' ? <SubtasksPanel task={task} orgId={orgId} projectId={projectId} canEdit={canEdit} onOpenTask={onOpenTask} /> : null}
            {tab === 'comments' ? <Discussion task={task} viewerId={viewerId} canComment={canEdit} /> : null}
            {tab === 'activities' ? <ActivitiesPanel task={task} /> : null}
        </section>
    );
}

function SubtasksPanel({
    task,
    orgId,
    projectId,
    canEdit,
    onOpenTask,
}: {
    task: TaskDetailDto;
    orgId: string;
    projectId: string;
    canEdit: boolean;
    onOpenTask: (taskId: string) => void;
}) {
    const update = useUpdateTask();
    const done = task.subtasks.filter((s) => s.status === 'done' || s.status === 'canceled').length;
    const total = task.subtasks.length;

    return (
        <div className="rounded-lg border border-line bg-surface p-3">
            <header className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">Subtasks</h4>
                {total > 0 ? <ProgressRing done={done} total={total} /> : null}
            </header>

            {total === 0 ? (
                <p className="text-sm text-ink-muted">No subtasks yet.</p>
            ) : (
                <ul className="space-y-2">
                    {task.subtasks.map((sub) => (
                        <SubtaskCard
                            key={sub.id}
                            sub={sub}
                            canEdit={canEdit}
                            onToggle={() =>
                                update.mutate({
                                    taskId: sub.id,
                                    patch: { status: sub.status === 'done' || sub.status === 'canceled' ? 'todo' : 'done' },
                                })
                            }
                            onOpen={() => onOpenTask(sub.id)}
                        />
                    ))}
                </ul>
            )}

            {canEdit ? (
                <div className="mt-3">
                    <QuickAdd orgId={orgId} label="Add subtask" body={{ projectId, parentTaskId: task.id }} onClose={() => { }} />
                </div>
            ) : null}
        </div>
    );
}

/**
 * One subtask rendered as a card, matching the reference: checkbox + title on the top row,
 * an optional note (the subtask description) inside a subtle inset, and a right rail with
 * assignee avatar / due chip / nested-subtask count. A drag affordance appears on hover.
 */
function SubtaskCard({
    sub,
    canEdit,
    onToggle,
    onOpen,
}: {
    sub: TaskCardDto;
    canEdit: boolean;
    onToggle: () => void;
    onOpen: () => void;
}) {
    const closed = sub.status === 'done' || sub.status === 'canceled';
    const tone = sub.isOverdue && !closed ? 'urgent' : closed ? 'done' : sub.dueDate ? 'soft' : null;
    const primary = sub.assignees.find((a) => a.isPrimary) ?? sub.assignees[0] ?? null;
    const extras = Math.max(0, sub.assignees.length - (primary ? 1 : 0));
    const description = sub.description?.trim() ?? '';

    return (
        <li className="group relative rounded-md border border-line bg-surface transition hover:border-line-strong hover:shadow-sm">
            <div className="flex items-start gap-3 p-2.5">
                <input
                    type="checkbox"
                    id={`subtask-${sub.id}`}
                    checked={closed}
                    disabled={!canEdit}
                    onChange={onToggle}
                    aria-label={closed ? `Reopen ${sub.title}` : `Complete ${sub.title}`}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-violet-600 disabled:cursor-not-allowed"
                />
                <label
                    htmlFor={`subtask-${sub.id}`}
                    className={clsx(
                        'min-w-0 flex-1 cursor-pointer text-sm leading-snug',
                        closed ? 'text-ink-faint line-through' : 'text-ink',
                    )}
                    onClick={(event) => {
                        // Clicks on the label toggle the checkbox; shift/ctrl or the title
                        // pill below opens the drawer. Keep plain click = toggle.
                        event.stopPropagation();
                    }}
                >
                    <span className="block truncate">{sub.title}</span>
                    {description ? (
                        <span className="mt-1.5 block rounded bg-canvas px-2 py-1.5 text-xs leading-relaxed text-ink-muted">
                            {description}
                        </span>
                    ) : null}
                </label>
                <div className="flex shrink-0 items-center gap-1.5 text-xs">
                    {sub.subtaskCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-ink-faint" title={`${sub.subtaskCount} nested subtasks`}>
                            <ListTree className="h-3.5 w-3.5" />
                            <span className="tabular-nums">{sub.subtaskCount}</span>
                        </span>
                    ) : null}
                    {sub.dueDate ? (
                        <span
                            className={clsx(
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums',
                                tone === 'urgent' && 'bg-red-50 text-red-700',
                                tone === 'done' && 'bg-emerald-50 text-emerald-700',
                                tone === 'soft' && 'bg-canvas text-ink-muted',
                            )}
                        >
                            <Calendar className="h-3 w-3" />
                            {dueLabel(sub.dueDate)}
                        </span>
                    ) : null}
                    {primary ? (
                        <span className="relative" title={fullName(primary)}>
                            <Avatar user={primary} size="xs" />
                            {extras > 0 ? (
                                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1 text-[9px] font-medium text-surface">
                                    +{extras}
                                </span>
                            ) : null}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={onOpen}
                        aria-label={`Open ${sub.title}`}
                        className="rounded p-1 text-ink-faint opacity-0 transition hover:bg-canvas hover:text-brand-700 focus:opacity-100 group-hover:opacity-100"
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {canEdit ? (
                        <span
                            className="cursor-grab text-ink-faint opacity-0 transition group-hover:opacity-100"
                            aria-hidden
                            title="Drag to reorder"
                        >
                            <GripVertical className="h-3.5 w-3.5" />
                        </span>
                    ) : null}
                </div>
            </div>
        </li>
    );
}

/** Small SVG donut showing done/total. Uses currentColor so it inherits the surrounding text tone. */
function ProgressRing({ done, total }: { done: number; total: number }) {
    const pct = total === 0 ? 0 : done / total;
    const radius = 8;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct);
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <svg width="18" height="18" viewBox="0 0 20 20" className="-rotate-90" aria-hidden>
                <circle cx="10" cy="10" r={radius} stroke="currentColor" strokeWidth="2.5" fill="none" className="text-line" opacity="0.4" />
                <circle
                    cx="10"
                    cy="10"
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className={pct === 1 ? 'text-state-done' : 'text-brand-500'}
                />
            </svg>
            <span className="tabular-nums">
                {done}/{total}
            </span>
        </span>
    );
}

function ActivitiesPanel({ task }: { task: TaskDetailDto }) {
    const activities = useMemo(() => task.timeline.filter((e) => e.kind === 'activity').reverse(), [task.timeline]);
    if (activities.length === 0) {
        return <p className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-muted">Nothing has happened on this task yet.</p>;
    }
    return (
        <ul className="space-y-2 rounded-lg border border-line bg-surface p-3">
            {activities.map((entry) => {
                if (entry.kind !== 'activity') return null;
                return (
                    <li key={entry.id} className="flex items-start gap-2 text-xs text-ink-muted">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" aria-hidden />
                        <p className="flex-1">
                            <span className="font-medium text-ink-soft">{fullName(entry.actor)}</span>{' '}
                            {entry.type.replace(/[._]/g, ' ')}
                            <span className="ml-1.5 whitespace-nowrap text-ink-faint">{relativeTime(entry.createdAt)}</span>
                        </p>
                    </li>
                );
            })}
        </ul>
    );
}

// ---------------------------------------------------------------- footer

function MetaFooter({ task }: { task: TaskDetailDto }) {
    return (
        <p className="mt-6 border-t border-line pt-3 text-xs text-ink-faint">
            Added {relativeTime(task.createdAt)} · Last touched {relativeTime(task.updatedAt)}
        </p>
    );
}

function DeleteDialog({ task, onCancel }: { task: TaskDetailDto; onCancel: () => void }) {
    const remove = useDeleteTask(task.project.id);
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Delete task">
            <div className="card w-full max-w-sm space-y-3 p-4">
                <h3 className="text-sm font-semibold text-ink">Delete this task?</h3>
                <p className="text-sm text-ink-muted">
                    {task.subtaskCount > 0 ? 'Its subtasks go with it. ' : ''}
                    Comments and attachments are removed too. This cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(task.id, { onSuccess: () => onCancel() })}>
                        Delete
                    </Button>
                </div>
            </div>
        </div>
    );
}

// Unused imports kept out of the tree — Select/Input referenced only if we later swap them back in.
