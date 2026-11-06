import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { DONE_STATUSES, recurrenceRuleSchema, type RecurrenceRule } from '../domain/enums.js';
import { resolveSectionForStatus } from './task.internal.js';

const DAY_MS = 86_400_000;

/**
 * Recurring tasks.
 *
 * A task carries a `RecurrenceRule` (JSON in `Task.recurrence`). Whenever an instance is
 * completed — or its due window has slipped into the past — the hourly sweep clones the next
 * instance forward. The clone keeps the same rule and points back at its predecessor through
 * `recurrenceSourceId`, so a chain always has exactly one live instance and never forks.
 *
 * All date maths runs in UTC so it is daylight-saving safe: adding a day is 24h of real time,
 * adding a month clamps to the last valid day (Jan 31 → Feb 28/29).
 */

function addDaysUtc(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
}

/** Add N calendar months in UTC, clamping the day to the target month's length. */
function addMonthsUtc(date: Date, months: number): Date {
    const d = new Date(date);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}

/** ISO weekday of a UTC date: 1 = Monday … 7 = Sunday. */
function isoDay(date: Date): number {
    const dow = date.getUTCDay();
    return dow === 0 ? 7 : dow;
}

/** The next instant strictly after `from` that satisfies the rule. Pure + UTC-based. */
export function nextOccurrence(rule: RecurrenceRule, from: Date, _tz?: string): Date {
    const interval = Math.max(1, rule.interval ?? 1);
    switch (rule.freq) {
        case 'daily':
            return addDaysUtc(from, interval);
        case 'weekly': {
            const days = rule.byDays?.length ? rule.byDays : null;
            if (days) {
                // Step forward day-by-day to the next allowed weekday, keeping the time-of-day.
                let candidate = addDaysUtc(from, 1);
                for (let guard = 0; guard < 7 * interval + 7; guard += 1) {
                    if (days.includes(isoDay(candidate))) return candidate;
                    candidate = addDaysUtc(candidate, 1);
                }
                return candidate;
            }
            return addDaysUtc(from, 7 * interval);
        }
        case 'monthly':
            return addMonthsUtc(from, interval);
    }
}

/** Parse the stored JSON back into a validated rule, or null when absent/invalid. */
export function parseRecurrence(raw: string | null | undefined): RecurrenceRule | null {
    if (!raw) return null;
    try {
        return recurrenceRuleSchema.parse(JSON.parse(raw));
    } catch {
        return null;
    }
}

/** Advance a rule from `base` until the occurrence is strictly in the future. */
function nextFuture(rule: RecurrenceRule, base: Date, now: Date): Date {
    let date = nextOccurrence(rule, base);
    let guard = 0;
    while (date.getTime() <= now.getTime() && guard < 1000) {
        date = nextOccurrence(rule, date);
        guard += 1;
    }
    return date;
}

/**
 * Clone the next instance for every recurring task that is done or overdue and has not already
 * spawned a successor. Returns how many new tasks were created.
 */
export async function materializeRecurrences(now = new Date()): Promise<{ created: number }> {
    const candidates = await prisma.task.findMany({
        where: {
            recurrence: { not: null },
            deletedAt: null,
            OR: [{ status: { in: DONE_STATUSES } }, { dueDate: { lt: now } }],
        },
        include: {
            assignees: { select: { userId: true, isPrimary: true } },
            labels: { select: { labelId: true } },
        },
    });

    let created = 0;
    for (const source of candidates) {
        const rule = parseRecurrence(source.recurrence);
        if (!rule) continue;

        // One live link per chain: skip a source that has already produced its successor.
        const successor = await prisma.task.findFirst({
            where: { recurrenceSourceId: source.id, deletedAt: null },
            select: { id: true },
        });
        if (successor) continue;

        let dueDate: Date | null;
        let startDate: Date | null;
        if (source.dueDate) {
            dueDate = nextFuture(rule, source.dueDate, now);
            // Preserve the original start→due spacing.
            startDate = source.startDate
                ? new Date(source.startDate.getTime() + (dueDate.getTime() - source.dueDate.getTime()))
                : null;
        } else if (source.startDate) {
            startDate = nextFuture(rule, source.startDate, now);
            dueDate = null;
        } else {
            dueDate = nextOccurrence(rule, now);
            startDate = null;
        }

        const sectionId = await resolveSectionForStatus(source.projectId, 'todo');
        const last = await prisma.task.findFirst({
            where: { projectId: source.projectId, sectionId, deletedAt: null },
            orderBy: { position: 'desc' },
            select: { position: true },
        });

        await prisma.task.create({
            data: {
                projectId: source.projectId,
                sectionId,
                parentTaskId: source.parentTaskId,
                title: source.title,
                description: source.description,
                status: 'todo',
                priority: source.priority,
                dueDate,
                startDate,
                estimateMins: source.estimateMins,
                isMilestone: source.isMilestone,
                kind: source.kind,
                // A fresh instance lands in the backlog; the planner re-scopes it per cycle.
                cycleId: null,
                recurrence: source.recurrence,
                recurrenceSourceId: source.id,
                position: (last?.position ?? 0) + 1000,
                createdById: source.createdById,
                completedAt: null,
                assignees: { create: source.assignees.map((a) => ({ userId: a.userId, isPrimary: a.isPrimary })) },
                labels: source.labels.length ? { create: source.labels.map((l) => ({ labelId: l.labelId })) } : undefined,
            },
        });
        created += 1;
    }

    if (created > 0) logger.info({ created }, 'recurrence materialisation finished');
    return { created };
}
