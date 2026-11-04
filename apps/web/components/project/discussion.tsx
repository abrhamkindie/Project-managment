'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AtSign, PencilLine, Send, Trash2 } from 'lucide-react';
import { formatDateTime, fullName, relativeTime } from '~/lib/format';
import { useComments, usePeople } from '~/lib/hooks';
import type { LightUser, TaskDetailDto, TimelineEntry } from '~/lib/types';
import { Avatar, Button, Select, Textarea } from '../ui';

/** What `usePeople` hands back: a member row's user, without the org-role wrapper. */
type Person = LightUser & { isActive: boolean };

/** Mirrors the API's `LINK_MENTION`, so what it notifies for is what we render as a mention. */
const MENTION = /@\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * The conversation under a task.
 *
 * Only comment entries from the timeline are rendered here; activity rows live in their own
 * tab (see `ActivitiesPanel` in drawer.tsx). The API returns one merged list so the order a
 * reader sees is the order things actually happened.
 */
export function Discussion({ task, orgId, viewerId, canComment }: { task: TaskDetailDto; orgId: string; viewerId: string; canComment: boolean }) {
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
                <p className="text-sm text-ink-muted">No comments yet. Comments notify the people who follow this task, and @mentions notify someone directly.</p>
            ) : (
                <ul className="space-y-2.5">
                    {entries.map((entry) => (
                        <TimelineRow
                            key={entry.id}
                            entry={entry}
                            orgId={orgId}
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
                <Composer
                    orgId={orgId}
                    value={draft}
                    onChange={setDraft}
                    onSubmit={submit}
                    submitLabel="Comment"
                    pending={comments.add.isPending}
                    placeholder="Add a comment… (⌘/Ctrl + Enter to send)"
                    ariaLabel="Add a comment"
                />
            ) : null}

            {/* The merged timeline is capped server-side, so comments beyond the window are absent
                rather than hidden by this filter. Be precise about which is which. */}
            {task.olderHidden > 0 ? (
                <p className="text-xs text-ink-faint">
                    Older discussion is not loaded here — {task.olderHidden} {task.olderHidden === 1 ? 'entry' : 'entries'} predate the window this view reads.
                </p>
            ) : null}
        </section>
    );
}

/**
 * A comment box with a mention picker.
 *
 * The picker writes the API's own mention syntax (`@[First Last](userId)`) at the caret, which is
 * unambiguous and survives a rename; a bare `@Jane Doe` also works because the server resolves
 * names against the organization, but the id form never silently matches two people.
 */
function Composer({
    orgId,
    value,
    onChange,
    onSubmit,
    submitLabel,
    pending,
    placeholder,
    ariaLabel,
    autoFocus = false,
    rows = 2,
    disableSubmit = false,
    onEscape,
    secondary,
}: {
    orgId: string;
    value: string;
    onChange: (next: string) => void;
    onSubmit: () => void;
    submitLabel: string;
    pending: boolean;
    placeholder: string;
    ariaLabel: string;
    autoFocus?: boolean;
    rows?: number;
    /** Extra reason to refuse the submit, on top of "empty" — e.g. an edit that changed nothing. */
    disableSubmit?: boolean;
    onEscape?: () => void;
    /** Rendered left of the submit button, for a Cancel action in the edit flow. */
    secondary?: ReactNode;
}) {
    // `Textarea` does not forward a ref, so the caret is read through the wrapper instead of
    // teaching every shared form control about mentions.
    const host = useRef<HTMLDivElement>(null);

    const insert = (person: Person) => {
        const token = `@[${fullName(person)}](${person.id})`;
        const node = host.current?.querySelector('textarea');
        if (!node) {
            onChange(value ? `${value.replace(/\s+$/, '')} ${token}` : token);
            return;
        }
        const start = node.selectionStart ?? value.length;
        const end = node.selectionEnd ?? start;
        onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
        // Put the caret back after React has written the new value, or the next keystroke lands
        // at the end of the box instead of where the author was typing.
        requestAnimationFrame(() => {
            node.focus();
            const caret = start + token.length;
            node.setSelectionRange(caret, caret);
        });
    };

    return (
        <div ref={host} className="space-y-1.5">
            <Textarea
                autoFocus={autoFocus}
                value={value}
                maxLength={20000}
                rows={rows}
                placeholder={placeholder}
                aria-label={ariaLabel}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSubmit();
                    if (event.key === 'Escape') onEscape?.();
                }}
            />
            <div className="flex items-center gap-2">
                <MentionPicker orgId={orgId} onPick={insert} />
                {secondary}
                <Button className="ml-auto" variant="primary" size="sm" icon={<Send className="h-4 w-4" />} loading={pending} disabled={!value.trim() || disableSubmit} onClick={onSubmit}>
                    {submitLabel}
                </Button>
            </div>
        </div>
    );
}

/** Members come from the org cache, so opening the picker costs no request once the app is loaded. */
function MentionPicker({ orgId, onPick }: { orgId: string; onPick: (person: Person) => void }) {
    const { people } = usePeople(orgId);
    const [picked, setPicked] = useState('');

    if (people.length === 0) return null;

    return (
        <div className="inline-flex items-center gap-1.5">
            <AtSign className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
            <Select
                aria-label="Mention a member"
                className="w-44 text-xs"
                value={picked}
                onChange={(event) => {
                    const person = people.find((p) => p.id === event.target.value);
                    if (person) onPick(person);
                    // Always reset: mentioning the same person twice is a normal thing to do, and a
                    // sticky value would make the second pick a no-op.
                    setPicked('');
                }}
            >
                <option value="">Mention…</option>
                {people.map((person) => (
                    <option key={person.id} value={person.id}>
                        {fullName(person)}
                    </option>
                ))}
            </Select>
        </div>
    );
}

function TimelineRow({
    entry,
    orgId,
    viewerId,
    editing,
    onEdit,
    onCancelEdit,
    onSave,
    onDelete,
}: {
    entry: Extract<TimelineEntry, { kind: 'comment' }>;
    orgId: string;
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
                        <CommentBody text={entry.body} />
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
                    <CommentEditor orgId={orgId} initial={body} onCancel={onCancelEdit} onSave={(value) => onSave(entry.id, value)} />
                )}
            </div>
        </li>
    );
}

/**
 * A stored comment, rendered with its mentions resolved.
 *
 * The body is inserted as React children, never as HTML, so a mention token can be styled without
 * opening an injection path — the writer's own angle brackets still arrive as literal text.
 */
function CommentBody({ text }: { text: string }) {
    const box = 'whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm text-ink';
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(MENTION)) {
        const at = match.index ?? cursor;
        if (at > cursor) parts.push(text.slice(cursor, at));
        parts.push(
            <span key={`${at}-${match[1]}`} className="rounded bg-brand-50 px-1 font-medium text-brand-700">
                @{match[1]}
            </span>,
        );
        cursor = at + match[0].length;
    }
    if (parts.length === 0) return <p className={box}>{text}</p>;
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <p className={box}>{parts}</p>;
}

/** Its own state, so typing in one comment never touches another row. */
function CommentEditor({ orgId, initial, onSave, onCancel }: { orgId: string; initial: string; onSave: (value: string) => void; onCancel: () => void }) {
    const [value, setValue] = useState(initial);
    const clean = value.trim();

    return (
        <div className="mt-1">
            <Composer
                orgId={orgId}
                autoFocus
                rows={3}
                value={value}
                onChange={setValue}
                onSubmit={() => clean && clean !== initial && onSave(clean)}
                submitLabel="Save"
                pending={false}
                placeholder="Edit your comment…"
                ariaLabel="Edit comment"
                disableSubmit={!clean || clean === initial}
                onEscape={onCancel}
                secondary={
                    <Button size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                }
            />
        </div>
    );
}
