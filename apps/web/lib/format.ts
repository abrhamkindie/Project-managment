import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import type {
    ActivityDto,
    ApiTokenScope,
    AutomationActionKind,
    AutomationTriggerEvent,
    CredentialStatus,
    CustomFieldDto,
    CustomFieldType,
    TaskPriority,
    TaskStatus,
    WebhookEvent,
} from './types';

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

/**
 * A person's availability in one phrase.
 *
 * Online needs no timestamp — "now" is the whole message — so the clock only appears once the
 * dot has gone grey, which is exactly when a reader starts wondering how long they have been out.
 */
export function presenceLabel(online: boolean, lastSeenAt?: string | null): string {
    if (online) return 'Active now';
    if (!lastSeenAt) return 'No activity yet';
    return `Seen ${relativeTime(lastSeenAt)}`;
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

/** `90` -> `1h 30m`. The compact shape every logged-time read in the UI shares. */
export function formatMins(mins: number | null | undefined): string {
    if (mins === null || mins === undefined) return '—';
    const abs = Math.max(0, Math.round(mins));
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    if (!hours) return `${rest}m`;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** `5_400_000` -> `1:30:00`. The live timer needs seconds, or it looks frozen between minutes. */
export function formatStopwatch(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const pad = (value: number) => String(value).padStart(2, '0');
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
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
        case 'time.started':
            return `started a timer on “${title}”`;
        case 'time.logged':
            return `logged ${formatMins(Number(meta.mins ?? 0))} on “${title}”`;
        case 'time.deleted':
            return meta.mins ? `removed a ${formatMins(Number(meta.mins))} time entry` : 'removed a time entry';
        case 'field.created':
            return `added the field “${title}”`;
        case 'field.updated':
            return `changed the field “${title}”`;
        case 'field.deleted':
            return `deleted the field “${title}”`;
        case 'task.fields_updated':
            return `updated custom fields on “${title}”`;
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

// --------------------------------------------------- integrations & security (Phase 5)

/**
 * The dropdown vocabulary for the integration screens, kept next to the other display maps so a
 * label here and a chip there cannot drift apart. Each list is the client's mirror of an enum in
 * `apps/api/src/domain/enums.ts`; the API test suite pins that side.
 */

export const API_TOKEN_SCOPES: ApiTokenScope[] = ['read', 'write', '*'];

export const SCOPE_HINT: Record<ApiTokenScope, string> = {
    read: 'Read boards, tasks and projects',
    write: 'Create and change work',
    '*': 'Every scope, including the management routes',
};

export const WEBHOOK_EVENTS: WebhookEvent[] = [
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.assigned',
    'task.completed',
    'comment.added',
    'project.updated',
    'member.added',
];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
    'task.created': 'A task is created',
    'task.updated': 'A task is edited',
    'task.status_changed': 'A task moves column',
    'task.assigned': 'A task is assigned',
    'task.completed': 'A task is completed',
    'comment.added': 'A comment is posted',
    'project.updated': 'A project changes',
    'member.added': 'A member joins',
};

export const AUTOMATION_TRIGGERS: AutomationTriggerEvent[] = [
    'task.created',
    'task.status_changed',
    'task.assigned',
    'comment.added',
];

export const AUTOMATION_TRIGGER_LABEL: Record<AutomationTriggerEvent, string> = {
    'task.created': 'When a task is created',
    'task.status_changed': 'When a task changes status',
    'task.assigned': 'When a task is assigned',
    'comment.added': 'When a comment is added',
};

export const AUTOMATION_ACTIONS: AutomationActionKind[] = [
    'set_status',
    'set_priority',
    'assign',
    'add_label',
    'notify',
    'webhook',
];

export const AUTOMATION_ACTION_LABEL: Record<AutomationActionKind, string> = {
    set_status: 'Set status to',
    set_priority: 'Set priority to',
    assign: 'Assign to',
    add_label: 'Add label',
    notify: 'Notify a person',
    webhook: 'Fire a webhook event',
};

/** A status chip for the three credential states, so tokens and shares badge identically. */
export const CREDENTIAL_STATUS_LABEL: Record<CredentialStatus, string> = {
    active: 'Active',
    expired: 'Expired',
    revoked: 'Revoked',
};

export const CREDENTIAL_STATUS_CLASS: Record<CredentialStatus, string> = {
    active: 'bg-state-done',
    expired: 'bg-state-review',
    revoked: 'bg-state-canceled',
};

/**
 * Audit-log event filter. A curated subset, not all thirty-odd activity types: these are the
 * rows an admin is actually asked about, and a 30-entry dropdown is a search box in disguise.
 */
export const AUDIT_EVENT_OPTIONS: { value: string; label: string }[] = [
    { value: 'task.created', label: 'Task created' },
    { value: 'task.status_changed', label: 'Status changed' },
    { value: 'task.assigned', label: 'Task assigned' },
    { value: 'task.deleted', label: 'Task deleted' },
    { value: 'comment.added', label: 'Comment added' },
    { value: 'project.created', label: 'Project created' },
    { value: 'project.updated', label: 'Project changed' },
    { value: 'project.member_added', label: 'Project member added' },
    { value: 'member.invited', label: 'Member invited' },
    { value: 'member.role_changed', label: 'Member role changed' },
    { value: 'cycle.closed', label: 'Cycle closed' },
    { value: 'time.logged', label: 'Time logged' },
    { value: 'task.fields_updated', label: 'Custom field changed' },
];

// --------------------------------------------------------------- custom fields (Phase 6)

/** The shapes a field can take, in the order the definition picker lists them. */
export const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select', 'checkbox'];

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    select: 'Dropdown',
    checkbox: 'Yes / No',
};

/** Said out loud while somebody is choosing a shape, because the five are not equally obvious. */
export const CUSTOM_FIELD_TYPE_HINT: Record<CustomFieldType, string> = {
    text: 'Free text. A filter on it matches any part of what was typed.',
    number: 'Digits only, compared as a number.',
    date: 'One day, no time of day.',
    select: 'One choice from an option list you write here.',
    checkbox: 'Yes or no, nothing in between.',
};

/**
 * How a stored value reads back.
 *
 * Every value is a string in the database — that is the portability rule — so the declared type only
 * ever means anything at the moment it is written or displayed. Blank and absent are the same answer:
 * there is nothing to show.
 */
export function fieldValueLabel(field: Pick<CustomFieldDto, 'type'>, value: string | null | undefined): string {
    if (!value) return '';
    if (field.type === 'checkbox') return value === 'true' ? 'Yes' : 'No';
    if (field.type === 'date') return formatDate(value);
    return value;
}
