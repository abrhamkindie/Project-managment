'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Flag, Link2, Paperclip, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER, formatSize, fullName, relativeTime, toDateInput, fromDateInput } from '~/lib/format';
import { useAttachments, useDeleteTask, useLabels, usePeople, useSetAssignees, useSetLabels, useTask, useUpdateTask } from '~/lib/hooks';
import type { TaskDetailDto, TaskPriority } from '~/lib/types';
import { Avatar, Button, EmptyState, Field, Input, Menu, MenuItem, Select, Spinner, Textarea } from '../ui';
import { UserPicker } from '../user-picker';
import { Discussion } from './discussion';
import { QuickAdd } from './quick-add';

/**
 * The task drawer: everything about one card, over the top of the view it came from.
 *
 * Fields save on blur rather than behind a Save button, because a task is edited in passing —
 * a manager sets a due date and moves on. The URL owns which task is open (see `ProjectWorkspace`),
 * so `Back` closes the drawer instead of leaving it stranded.
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
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <>
            <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={onClose} aria-hidden />
            <aside className="animate-drawer fixed right-0 top-0 z-40 flex h-full w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-xl" aria-label="Task details">
                {detail.isLoading ? (
                    <div className="grid flex-1 place-items-center">
                        <Spinner />
                    </div>
                ) : detail.isError || !detail.data ? (
                    <div className="flex-1 overflow-y-auto p-4">
                        <DrawerClose onClose={onClose} />
                        <EmptyState
                            title="This task could not be loaded"
                            description="It may have been deleted, or you may no longer have access to its project."
                        />
                    </div>
                ) : (
                    <>
                        <DrawerClose onClose={onClose} />
                        <div className="flex-1 overflow-y-auto px-5 pb-8">
                            <TaskBody
                                task={detail.data}
                                orgId={orgId}
                                projectId={projectId}
                                sections={sections}
                                viewerId={viewerId}
                                canEdit={canEdit}
                                onOpenTask={onOpenTask}
                                confirmDelete={confirmDelete}
                                setConfirmDelete={setConfirmDelete}
                            />
                        </div>
                    </>
                )}
            </aside>
        </>
    );
}

function DrawerClose({ onClose }: { onClose: () => void }) {
    return (
        <div className="flex items-center justify-end border-b border-line px-3 py-2">
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close task details">
                <X className="h-4 w-4" />
            </Button>
        </div>
    );
}

function TaskBody({
    task,
    orgId,
    projectId,
    sections,
    viewerId,
    canEdit,
    onOpenTask,
    confirmDelete,
    setConfirmDelete,
}: {
    task: TaskDetailDto;
    orgId: string;
    projectId: string;
    sections: { id: string; name: string; isDone: boolean }[];
    viewerId: string;
    canEdit: boolean;
    onOpenTask: (taskId: string) => void;
    confirmDelete: boolean;
    setConfirmDelete: (next: boolean) => void;
}) {
    const update = useUpdateTask();
    const assign = useSetAssignees();
    const labels = useSetLabels();
    const remove = useDeleteTask(orgId);
    const people = usePeople(orgId);
    const allLabels = useLabels(orgId);
    const attachments = useAttachments(task.id);

    const [title, setTitle] = useState(task.title);
    const [editingTitle, setEditingTitle] = useState(false);
    const [description, setDescription] = useState<string | null>(null);
    const [showPeople, setShowPeople] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    // Another tab may have renamed it; adopt the server value unless someone here is mid-edit.
    useEffect(() => {
        if (!editingTitle) setTitle(task.title);
    }, [task.title, editingTitle]);

    const saveTitle = () => {
        setEditingTitle(false);
        const next = title.trim();
        if (!next || next === task.title) {
            setTitle(task.title);
            return;
        }
        update.mutate({ taskId: task.id, patch: { title: next } });
    };

    const saveDescription = () => {
        if (description === null) return;
        const next = description.trim();
        setDescription(null);
        if (next === (task.description ?? '').trim()) return;
        update.mutate({ taskId: task.id, patch: { description: next || null } });
    };

    const labelIds = task.labels.map((label) => label.id);
    const toggleLabel = (labelId: string) => {
        const next = labelIds.includes(labelId) ? labelIds.filter((id) => id !== labelId) : [...labelIds, labelId];
        labels.mutate({ taskId: task.id, labelIds: next });
    };

    const done = task.status === 'done' || task.status === 'canceled';
    const descriptionValue = description ?? task.description ?? '';

    return (
        <div className="space-y-5 pt-4">
            <header className="space-y-2">
                <p className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="status-dot bg-brand-500" aria-hidden />
                    {task.project.name}
                    {task.parent ? (
                        <button
                            type="button"
                            className="link ml-1 inline-flex items-center gap-1"
                            title={task.parent.title}
                            onClick={() => onOpenTask(task.parent!.id)}
                        >
                            <Link2 className="h-3.5 w-3.5" />
                            subtask of “{task.parent.title}”
                        </button>
                    ) : null}
                </p>

                <div className="flex items-start gap-2">
                    <button
                        type="button"
                        className={clsx('mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition', done ? 'border-state-done bg-state-done text-white' : 'border-line text-ink-faint hover:border-brand-300')}
                        aria-label={done ? 'Reopen task' : 'Mark task done'}
                        disabled={!canEdit}
                        onClick={() => update.mutate({ taskId: task.id, patch: { status: done ? 'in_progress' : 'done' } })}
                    >
                        ✓
                    </button>
                    <input
                        value={title}
                        disabled={!canEdit}
                        maxLength={200}
                        aria-label="Task title"
                        onFocus={() => setEditingTitle(true)}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none disabled:cursor-default"
                    />
                </div>
            </header>

            <section className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">
                    <Select value={task.status} disabled={!canEdit} aria-label="Status" onChange={(event) => update.mutate({ taskId: task.id, patch: { status: event.target.value as TaskDetailDto['status'] } })}>
                        {STATUS_ORDER.map((status) => (
                            <option key={status} value={status}>
                                {STATUS_LABEL[status]}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label="Priority">
                    <Select value={task.priority} disabled={!canEdit} aria-label="Priority" onChange={(event) => update.mutate({ taskId: task.id, patch: { priority: event.target.value as TaskPriority } })}>
                        {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((priority) => (
                            <option key={priority} value={priority}>
                                {PRIORITY_LABEL[priority]}
                            </option>
                        ))}
                    </Select>
                </Field>

                {sections.length > 0 ? (
                    <Field label="Column" hint="Moving to a done column completes the task">
                        <Select
                            // An empty value means "the pool", which the API cannot move a card back into.
                            value={task.sectionId ?? sections[0]?.id ?? ''}
                            disabled={!canEdit}
                            aria-label="Column"
                            onChange={(event) => update.mutate({ taskId: task.id, patch: { sectionId: event.target.value } })}
                        >
                            {sections.map((section) => (
                                <option key={section.id} value={section.id}>
                                    {section.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                ) : null}

                <Field label="Due date">
                    <Input type="date" value={toDateInput(task.dueDate)} disabled={!canEdit} aria-label="Due date" onChange={(event) => update.mutate({ taskId: task.id, patch: { dueDate: fromDateInput(event.target.value) } })} />
                </Field>

                <Field label="Start date">
                    <Input type="date" value={toDateInput(task.startDate)} disabled={!canEdit} aria-label="Start date" onChange={(event) => update.mutate({ taskId: task.id, patch: { startDate: fromDateInput(event.target.value) } })} />
                </Field>

                <Field label="Estimate (minutes)">
                    <Input
                        type="number"
                        min={0}
                        max={100000}
                        step={15}
                        value={task.estimateMins ?? ''}
                        disabled={!canEdit}
                        aria-label="Estimate in minutes"
                        placeholder="—"
                        onChange={(event) => update.mutate({ taskId: task.id, patch: { estimateMins: event.target.value ? Number(event.target.value) : null } })}
                    />
                </Field>
            </section>

            <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                    type="checkbox"
                    className="checkbox"
                    checked={task.isMilestone}
                    disabled={!canEdit}
                    onChange={(event) => update.mutate({ taskId: task.id, patch: { isMilestone: event.target.checked } })}
                />
                <Flag className="h-4 w-4 text-brand-500" />
                Milestone
            </label>

            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase text-ink-faint">Assignees</h3>
                    {canEdit && !showPeople ? (
                        <button type="button" className="link text-xs" onClick={() => setShowPeople(true)}>
                            Change
                        </button>
                    ) : null}
                </div>

                <ul className="flex flex-wrap gap-1.5">
                    {task.assignees.length === 0 ? <li className="text-sm text-ink-muted">Nobody owns this yet.</li> : null}
                    {task.assignees.map((assignee) => (
                        <li key={assignee.id} className="chip bg-canvas">
                            <Avatar user={assignee} size="xs" />
                            {fullName(assignee)}
                            {assignee.isPrimary ? <span className="text-[10px] uppercase text-brand-600">lead</span> : null}
                            {canEdit ? (
                                <button type="button" aria-label={`Unassign ${fullName(assignee)}`} className="text-ink-faint hover:text-danger" onClick={() => assign.mutate({ taskId: task.id, body: { userIds: task.assigneeIds.filter((id) => id !== assignee.id) } })}>
                                    ×
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>

                {showPeople && canEdit ? (
                    <div className="space-y-2 rounded-lg border border-line p-2.5">
                        <UserPicker
                            users={people.people}
                            value={task.assigneeIds}
                            label="Pick who works on this"
                            onChange={(next) => assign.mutate({ taskId: task.id, body: { userIds: next } })}
                        />
                        <div className="flex justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setShowPeople(false)}>
                                Done
                            </Button>
                        </div>
                    </div>
                ) : null}
            </section>

            {allLabels.data && allLabels.data.length > 0 ? (
                <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase text-ink-faint">Labels</h3>
                    <div className="flex flex-wrap gap-1.5">
                        {allLabels.data.map((label) => {
                            const active = labelIds.includes(label.id);
                            return (
                                <button
                                    key={label.id}
                                    type="button"
                                    disabled={!canEdit || labels.isPending}
                                    onClick={() => toggleLabel(label.id)}
                                    className={clsx('chip transition', active ? 'border-transparent font-medium' : 'opacity-60 hover:opacity-100')}
                                    style={active ? { backgroundColor: `${label.color}1a`, color: label.color } : undefined}
                                    aria-pressed={active}
                                >
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} aria-hidden />
                                    {label.name}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-ink-faint">Description</h3>
                <Textarea
                    value={descriptionValue}
                    rows={4}
                    disabled={!canEdit}
                    aria-label="Description"
                    placeholder="Add details, links or acceptance criteria…"
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={saveDescription}
                />
                {canEdit && description !== null ? (
                    <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={saveDescription}>
                            Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDescription(null)}>
                            Cancel
                        </Button>
                    </div>
                ) : null}
            </section>

            <Subtasks task={task} orgId={orgId} projectId={projectId} canEdit={canEdit} onOpenTask={onOpenTask} />

            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase text-ink-faint">Attachments</h3>
                    {canEdit ? (
                        <button type="button" className="link text-xs inline-flex items-center gap-1" onClick={() => fileInput.current?.click()}>
                            <Paperclip className="h-3.5 w-3.5" />
                            {attachments.upload.isPending ? 'Uploading' : 'Attach'}
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
                {task.attachments.length === 0 ? <p className="text-sm text-ink-muted">No files yet.</p> : null}
                <ul className="space-y-1">
                    {task.attachments.map((attachment) => (
                        <li key={attachment.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                            <a href={attachment.url} className="min-w-0 flex-1 truncate text-ink-soft hover:text-brand-700" download={attachment.filename}>
                                {attachment.filename}
                            </a>
                            <span className="text-xs text-ink-faint">{formatSize(attachment.size)}</span>
                            {canEdit ? (
                                <button type="button" aria-label={`Delete ${attachment.filename}`} className="text-ink-faint hover:text-danger" onClick={() => attachments.remove.mutate(attachment.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </section>

            <Discussion task={task} viewerId={viewerId} canComment={canEdit} />

            <footer className="flex items-center justify-between border-t border-line pt-3 text-xs text-ink-faint">
                <span>
                    Added {relativeTime(task.createdAt)} · last touched {relativeTime(task.updatedAt)}
                </span>
                {canEdit ? (
                    <Menu
                        trigger={(open) => (
                            <button type="button" className={clsx('link text-xs', open && 'underline')}>
                                More
                            </button>
                        )}
                    >
                        <MenuItem tone="danger" icon={<Trash2 className="h-4 w-4" />} onSelect={() => setConfirmDelete(true)}>
                            Delete task
                        </MenuItem>
                    </Menu>
                ) : null}
            </footer>

            {confirmDelete ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
                    <div role="dialog" aria-modal="true" aria-label="Delete task" className="card w-full max-w-sm space-y-3 p-4">
                        <h3 className="text-sm font-semibold text-ink">Delete this task?</h3>
                        <p className="text-sm text-ink-muted">
                            {task.subtaskCount > 0 ? 'Its subtasks go with it. ' : ''}Comments and attachments are removed too.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                loading={remove.isPending}
                                onClick={() => {
                                    remove.mutate(task.id, { onSuccess: () => setConfirmDelete(false) });
                                }}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** Subtasks are ordinary tasks with a parent, so they reuse the same row behaviour. */
function Subtasks({
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
    const done = task.subtasks.filter((subtask) => subtask.status === 'done' || subtask.status === 'canceled').length;

    return (
        <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-ink-faint">
                Subtasks
                {task.subtasks.length > 0 ? (
                    <span className="normal-case text-ink-faint">
                        {done}/{task.subtasks.length}
                    </span>
                ) : null}
            </h3>

            <ul className="space-y-1">
                {task.subtasks.map((subtask) => {
                    const closed = subtask.status === 'done' || subtask.status === 'canceled';
                    return (
                        <li key={subtask.id} className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={!canEdit}
                                aria-label={closed ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
                                className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px]', closed ? 'border-state-done bg-state-done text-white' : 'border-line hover:border-brand-300')}
                                onClick={() => update.mutate({ taskId: subtask.id, patch: { status: closed ? 'todo' : 'done' } })}
                            >
                                {closed ? '✓' : ''}
                            </button>
                            <button type="button" className={clsx('min-w-0 flex-1 truncate text-left text-sm hover:text-brand-700', closed ? 'text-ink-faint line-through' : 'text-ink-soft')} onClick={() => onOpenTask(subtask.id)}>
                                {subtask.title}
                            </button>
                            {subtask.dueDate ? (
                                <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {toDateInput(subtask.dueDate)}
                                </span>
                            ) : null}
                        </li>
                    );
                })}
            </ul>

            {canEdit ? <QuickAdd orgId={orgId} label="Add subtask" body={{ projectId, parentTaskId: task.id }} /> : null}
        </section>
    );
}
