'use client';

import { useMemo, useState } from 'react';
import { PencilLine, Send, Trash2 } from 'lucide-react';
import { formatDateTime, fullName, relativeTime } from '~/lib/format';
import { useComments } from '~/lib/hooks';
import type { TaskDetailDto, TimelineEntry } from '~/lib/types';
import { Avatar, Button, Textarea } from '../ui';

/**
 * The conversation under a task.
 *
 * Only comment entries from the timeline are rendered here; activity rows live in their own
 * tab (see `ActivitiesPanel` in drawer.tsx). The API returns one merged list so the order a
 * reader sees is the order things actually happened.
 */
export function Discussion({ task, viewerId, canComment }: { task: TaskDetailDto; viewerId: string; canComment: boolean }) {
    const comments = useComments(task.id);
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState<string | null>(null);

    // Filter to comments only — activities are handled by the Activities tab.
    // The composer sits at the bottom, so newest work is nearest the cursor.
    const entries = useMemo(
        () => [...task.timeline].filter((e): e is Extract<TimelineEntry, { kind: 'comment' }> => e.kind === 'comment').reverse(),
        [task.timeline],
    );

    const submit = () => {
        const body = draft.trim();
        if (!body) return;
        comments.add.mutate(body, { onSuccess: () => setDraft('') });
    };

    return (
        <section className="space-y-3" aria-label="Comments">
            <h3 className="text-xs font-semibold uppercase text-ink-faint">Comments</h3>

            {entries.length === 0 ? (
                <p className="text-sm text-ink-muted">No comments yet. Comments mention the people who follow this task.</p>
            ) : (
                <ul className="space-y-2.5">
                    {entries.map((entry) => (
                        <TimelineRow
                            key={entry.id}
                            entry={entry}
                            viewerId={viewerId}
                            editing={editing === entry.id}
                            onEdit={(id) => {
                                setEditing(id);
                            }}
                            onCancelEdit={() => setEditing(null)}
                            onSave={(id, body) => {
                                comments.edit.mutate({ commentId: id, body });
                                setEditing(null);
                            }}
                            onDelete={(id) => comments.remove.mutate(id)}
                        />
                    ))}
                </ul>
            )}

            {canComment ? (
                <div className="space-y-1.5">
                    <Textarea
                        value={draft}
                        maxLength={20000}
                        rows={2}
                        placeholder="Add a comment… (⌘/Ctrl + Enter to send)"
                        aria-label="Add a comment"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
                        }}
                    />
                    <div className="flex items-center justify-end">
                        <Button variant="primary" size="sm" icon={<Send className="h-4 w-4" />} loading={comments.add.isPending} disabled={!draft.trim()} onClick={submit}>
                            Comment
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function TimelineRow({
    entry,
    viewerId,
    editing,
    onEdit,
    onCancelEdit,
    onSave,
    onDelete,
}: {
    entry: Extract<TimelineEntry, { kind: 'comment' }>;
    viewerId: string;
    editing: boolean;
    onEdit: (id: string) => void;
    onCancelEdit: () => void;
    onSave: (id: string, body: string) => void;
    onDelete: (id: string) => void;
}) {
    const mine = entry.author.id === viewerId;
    const body = editing ? entry.body : null;

    return (
        <li className="flex items-start gap-2">
            <Avatar user={entry.author} size="sm" />
            <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-muted">
                    <span className="font-medium text-ink-soft">{fullName(entry.author)}</span>
                    <span className="ml-1.5" title={formatDateTime(entry.createdAt)}>
                        {relativeTime(entry.createdAt)}
                    </span>
                </p>

                {body === null ? (
                    <div className="group mt-1">
                        <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm text-ink">{entry.body}</p>
                        {mine ? (
                            <div className="mt-1 flex gap-3 opacity-0 transition group-hover:opacity-100">
                                <button type="button" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink" onClick={() => onEdit(entry.id)}>
                                    <PencilLine className="h-3.5 w-3.5" />
                                    Edit
                                </button>
                                <button type="button" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-danger" onClick={() => onDelete(entry.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <CommentEditor initial={body} onCancel={onCancelEdit} onSave={(value) => onSave(entry.id, value)} />
                )}
            </div>
        </li>
    );
}

/** Its own state, so typing in one comment never touches another row. */
function CommentEditor({ initial, onSave, onCancel }: { initial: string; onSave: (value: string) => void; onCancel: () => void }) {
    const [value, setValue] = useState(initial);
    const clean = value.trim();

    return (
        <div className="mt-1 space-y-1.5">
            <Textarea
                autoFocus
                rows={3}
                value={value}
                maxLength={20000}
                aria-label="Edit comment"
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && clean && clean !== initial) onSave(clean);
                    if (event.key === 'Escape') onCancel();
                }}
            />
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" variant="primary" disabled={!clean || clean === initial} onClick={() => onSave(clean)}>
                    Save
                </Button>
            </div>
        </div>
    );
}
