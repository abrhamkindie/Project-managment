import { prisma } from '../lib/prisma.js';
import { loadProjectAccess } from './access.js';
import { csvColumns } from './custom-field.service.js';
import { can } from '../domain/permissions.js';
import { Forbidden } from '../domain/errors.js';
import type { AuthUser } from '../types/express.js';

/**
 * CSV export for a project's tasks.
 *
 * Produces a single delimited snapshot ordered the way the board reads (column, then rank) so a
 * download lines up with what the user sees. Quoting follows RFC-4180: any field containing a
 * comma, quote, newline or carriage return is wrapped in double quotes with inner quotes doubled.
 */

const HEADER = [
    'id',
    'title',
    'status',
    'priority',
    'kind',
    'section',
    'cycle',
    'assignees',
    'labels',
    'start_date',
    'due_date',
    'estimate_mins',
    'created_at',
];

function escape(value: string): string {
    if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

/** UTC calendar day for a timestamp, or '' when absent. */
function day(value: Date | null): string {
    return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * One RFC-4180 document: header row first, CRLF between rows, trailing newline.
 *
 * Every download in the app is built here, so the quoting rule exists once — the audit export
 * and the task export must not be able to disagree about what a comma means.
 */
export function csvDocument(header: readonly string[], rows: readonly (readonly string[])[]): string {
    return [header, ...rows].map((cells) => cells.map((cell) => escape(cell)).join(',')).join('\r\n') + '\r\n';
}

/** Columns of `activityCsv`, kept public so a test can assert the shape without parsing rows. */
export const ACTIVITY_CSV_HEADER = ['created_at', 'actor', 'type', 'project', 'task_id', 'activity_id'] as const;

export interface ActivityCsvRow {
    createdAt: Date;
    actorName: string;
    type: string;
    projectName: string | null;
    taskId: string | null;
    id: string;
}

/** Audit rows as CSV. Names are resolved by the caller, so this stays a formatting job. */
export function activityCsv(rows: readonly ActivityCsvRow[]): string {
    return csvDocument(
        ACTIVITY_CSV_HEADER,
        rows.map((row) => [
            row.createdAt.toISOString(),
            row.actorName,
            row.type,
            row.projectName ?? '',
            row.taskId ?? '',
            row.id,
        ]),
    );
}

export async function projectTasksCsv(user: AuthUser, projectId: string, fieldIds: string[] = []): Promise<string> {
    const { project, access } = await loadProjectAccess(user, projectId);
    if (!can.viewProject(access)) throw new Forbidden('You do not have access to this project');

    const tasks = await prisma.task.findMany({
        where: { projectId, deletedAt: null },
        orderBy: [{ section: { position: 'asc' } }, { position: 'asc' }],
        include: {
            section: { select: { name: true } },
            cycle: { select: { name: true } },
            assignees: { include: { user: { select: { firstName: true, lastName: true } } } },
            labels: { include: { label: { select: { name: true } } } },
        },
    });

    // Custom-field columns (Phase 6) append in the order the caller asked for them, so a saved
    // column picker keeps producing the same file even after someone adds a field elsewhere.
    const columns = await csvColumns(project.orgId, projectId, fieldIds);

    const rows = tasks.map((t) => [
        t.id,
        t.title,
        t.status,
        t.priority,
        t.kind,
        t.section?.name ?? '',
        t.cycle?.name ?? '',
        t.assignees.map((a) => `${a.user.firstName} ${a.user.lastName}`.trim()).join('; '),
        t.labels.map((l) => l.label.name).join('; '),
        day(t.startDate),
        day(t.dueDate),
        t.estimateMins === null ? '' : String(t.estimateMins),
        t.createdAt.toISOString(),
        ...columns.cellsFor(t.id),
    ]);

    return csvDocument([...HEADER, ...columns.header], rows);
}
