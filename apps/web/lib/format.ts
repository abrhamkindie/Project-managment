import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import type { ActivityDto, TaskPriority, TaskStatus } from './types';

/**
 * Presentation helpers: the API sends ISO strings and machine enums, and every screen needs
 * the same human reading of them. Keeping the mapping here is what makes a status chip in a
 * board column and the same status in the activity feed look identical.
 */

export const STATUS_LABEL: Record<TaskStatus, string> = {
    todo: 'Backlog',
    in_progress: 'In progress',
    in_review: 'In review',
    done: 'Done',
    canceled: 'Canceled',
};

/** Tailwind tokens declared in tailwind.config.ts. */
export const STATUS_TOKEN: Record<TaskStatus, string> = {
    todo: 'bg-state-todo',
    in_progress: 'bg-state-progress',
    in_review: 'bg-state-review',
    done: 'bg-state-done',
    canceled: 'bg-state-canceled',
};

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'canceled'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
    none: 'No priority',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
};

export const PRIORITY_CLASS: Record<TaskPriority, string> = {
    none: 'text-ink-faint',
    low: 'text-ink-muted',
    medium: 'text-sky-600',
    high: 'text-state-high',
    urgent: 'text-state-urgent',
};

/** Left-border tint used by list rows so a column of mixed-priority tasks sorts itself visually. */
export const PRIORITY_BORDER: Record<TaskPriority, string> = {
    none: 'border-l-transparent',
    low: 'border-l-ink-faint/60',
    medium: 'border-l-sky-500',
    high: 'border-l-state-high',
    urgent: 'border-l-state-urgent',
};

export const HEALTH_LABEL: Record<string, string> = {
    on_track: 'On track',
    at_risk: 'At risk',
    off_track: 'Off track',
    empty: 'No tasks',
};

export const HEALTH_CLASS: Record<string, string> = {
    on_track: 'bg-green-50 text-green-700 border-green-200',
    at_risk: 'bg-amber-50 text-amber-700 border-amber-200',
    off_track: 'bg-red-50 text-red-700 border-red-200',
    empty: 'bg-gray-50 text-ink-muted border-line',
};

/** Swatches offered when a project or label is created; the API requires `#rrggbb`. */
export const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#f43f5e', '#a855f7'];
export const LABEL_COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#b45309', '#334155'];

const toDate = (value?: string | null) => {
    if (!value) return null;
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
};

/**
 * Due dates and project start dates are calendar days, not instants.
 *
 * A date picker sends `YYYY-MM-DD` and the API keeps it as the UTC day, so the day is read back
 * from the first ten characters of the ISO string rather than from a local `Date`. Converting
 * through the local zone would move the label a day for anyone west of Greenwich — a card due
 * today would read as due yesterday.
 */
const DAY_MS = 86_400_000;

export const dayKeyOf = (value?: string | null): string | null =>
    value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

const dayDate = (value?: string | null): Date | null => {
    const key = dayKeyOf(value);
    if (!key) return null;
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
};

/** Whole days between a calendar day and today, negative when it is in the past. */
export function daysFromToday(value?: string | null): number | null {
    const key = dayKeyOf(value);
    if (!key) return null;
    const today = new Date().toISOString().slice(0, 10);
    return Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** `Mar 4` for this year, `Mar 4, 2025` otherwise — the Asana convention users expect. */
export function formatDate(value?: string | null): string {
    const date = dayDate(value) ?? toDate(value);
    if (!date) return '—';
    return format(date, date.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

export function formatDateTime(value?: string | null): string {
    const date = toDate(value);
    if (!date) return '—';
    return format(date, 'MMM d, yyyy · HH:mm');
}

export function relativeTime(value?: string | null): string {
    const date = toDate(value);
    if (!date) return '—';
    return `${formatDistanceToNowStrict(date)} ago`;
}

export type DueTone = 'none' | 'normal' | 'soon' | 'overdue' | 'done';

/** Colour language for due dates: red only when the day has passed, amber when it is close. */
export function dueTone(dueDate: string | null | undefined, status: TaskStatus, isOverdue: boolean): DueTone {
    if (!dueDate || status === 'done' || status === 'canceled') return 'none';
    if (isOverdue) return 'overdue';
    const days = daysFromToday(dueDate);
    if (days === null) return 'none';
    return days <= 2 ? 'soon' : 'normal';
}

export const DUE_CLASS: Record<DueTone, string> = {
    none: 'text-ink-faint',
    normal: 'text-ink-muted',
    soon: 'text-amber-600',
    overdue: 'text-state-urgent',
    done: 'text-ink-faint',
};

export function dueLabel(dueDate: string | null | undefined): string {
    const days = daysFromToday(dueDate);
    if (days === null) return 'No due date';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return formatDate(dueDate);
}

export function initials(firstName?: string | null, lastName?: string | null): string {
    const letters = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`;
    return (letters || '?').toUpperCase();
}

export function fullName(user?: { firstName: string; lastName: string } | null): string {
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'Someone';
}

/** Deterministic avatar tint from the id, so a person keeps their colour across screens. */
export function avatarTint(seed: string): string {
    // Solid hues with white glyphs: high contrast and identical in light and dark.
    const palette = ['bg-brand-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-teal-500', 'bg-fuchsia-500'];
    let hash = 0;
    for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
    return `${palette[hash % palette.length] ?? 'bg-gray-500'} text-white`;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatHours(hours: number | null | undefined): string {
    if (hours === null || hours === undefined) return '—';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 48) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
}

export function percent(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `${Math.round(value)}%`;
}

/** `2026-11-03`, the value shape `<input type="date">` expects. */
export const toDateInput = (value?: string | null) => dayKeyOf(value) ?? '';

export const fromDateInput = (value: string): string | null => {
    const key = dayKeyOf(value);
    // The bare UTC day is what the API compares, so a round trip cannot shift the date.
    return key ? `${key}T00:00:00.000Z` : null;
};

/**
 * One line of prose per audit event type. Unknown types fall back to a readable label
 * instead of crashing: the activity table is append-only and can outlive the UI.
 */
export function describeActivity(activity: ActivityDto): string {
    const meta = activity.meta as Record<string, string | number | boolean | (string | number)[] | undefined>;
    // Project and organization events name their subject under `name` instead of `title`.
    const title = typeof meta.title === 'string' ? meta.title : typeof meta.name === 'string' ? meta.name : '';
    const fields = Array.isArray(meta.changed) ? meta.changed.map(String).join(', ') : '';
    switch (activity.type) {
        case 'task.created':
            return `created “${title}”`;
        case 'task.updated':
            return fields ? `updated ${fields} on “${title}”` : `updated “${title}”`;
        case 'task.assigned':
            return `assigned “${title}”`;
        case 'task.unassigned':
            return `removed an assignee from “${title}”`;
        case 'task.status_changed': {
            const from = STATUS_LABEL[meta.from as TaskStatus] ?? String(meta.from ?? '');
            const to = STATUS_LABEL[meta.to as TaskStatus] ?? String(meta.to ?? '');
            return `moved “${title}” from ${from} to ${to}`;
        }
        case 'task.completed':
            return `completed “${title}”`;
        case 'task.reopened':
            return `reopened “${title}”`;
        case 'task.moved':
            return `moved “${title}” to ${String(meta.section ?? 'another column')}`;
        case 'task.deleted':
            return `deleted “${title}”`;
        case 'subtask.created':
            return `added subtask “${title}”`;
        case 'comment.added':
            return `commented on “${title}”`;
        case 'comment.deleted':
            return `deleted a comment on “${title}”`;
        case 'attachment.added':
            return `attached ${String(meta.filename ?? 'a file')}`;
        case 'label.attached':
            return `changed the labels of “${title}”`;
        case 'project.created':
            return `created project “${title}”`;
        case 'project.updated':
            return `updated project “${title}”`;
        case 'project.member_added':
            return `changed the members of “${title}”`;
        case 'project.member_removed':
            return `removed a member from “${title}”`;
        case 'member.invited':
            return `invited ${String(meta.email ?? 'someone')}`;
        case 'member.role_changed':
            return meta.removed ? 'removed a member' : `set the role to ${String(meta.role ?? '')}`;
        default:
            return activity.type.replace(/[._]/g, ' ');
    }
}
