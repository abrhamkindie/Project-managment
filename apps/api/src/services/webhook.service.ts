import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { hmacSha256, randomToken } from '../lib/crypto.js';
import { NotFound } from '../domain/errors.js';
import { WEBHOOK_EVENTS, type ActivityType, type WebhookEvent } from '../domain/enums.js';
import type { CreateWebhookInput, UpdateWebhookInput } from '../domain/schemas.js';

/**
 * Outbound webhooks.
 *
 * The activity write path (`services/activity.ts`) is the single fan-out point: it queues one
 * `WebhookDelivery` row per matching subscription and returns. Sending happens later, in the
 * scheduler sweep, so a dead receiver slows nothing down and can never fail the user's request.
 *
 * Payloads are signed with HMAC-SHA256 over `"<timestamp>.<raw body>"` using the per-webhook
 * secret. The timestamp is part of the signed string, which is what lets a receiver reject a
 * captured payload replayed hours later.
 */

/** Days a finished delivery stays in the log before housekeeping prunes it. */
const DELIVERY_RETENTION_DAYS = 30;
const BACKOFF_BASE_SECONDS = 30;
/** Deliveries claimed per sweep attempt; keeps one slow receiver from starving the rest. */
const SWEEP_BATCH = 50;

/**
 * Activity types mapped to the public event names. Several activity rows collapse into
 * `task.updated` because subscribers care about "something changed", not about which field moved.
 */
const EVENT_BY_ACTIVITY: Partial<Record<ActivityType, WebhookEvent>> = {
    'task.created': 'task.created',
    'task.updated': 'task.updated',
    'task.moved': 'task.updated',
    'task.bulk_updated': 'task.updated',
    'task.status_changed': 'task.status_changed',
    'task.completed': 'task.completed',
    'task.assigned': 'task.assigned',
    'comment.added': 'comment.added',
    'project.updated': 'project.updated',
    'project.member_added': 'member.added',
};

/** One activity row can imply two events (a move into Done is both a status change and a completion). */
export function eventsForActivity(type: ActivityType, meta: Record<string, unknown> = {}): WebhookEvent[] {
    const events = new Set<WebhookEvent>();
    const direct = EVENT_BY_ACTIVITY[type];
    if (direct) events.add(direct);
    if (type === 'task.status_changed' && meta.to === 'done') events.add('task.completed');
    return [...events];
}

/** `t=<unix seconds>,v1=<hex hmac>` — the shape most off-the-shelf receivers already parse. */
export function signatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
    return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

/**
 * Receiver-side verification, exported so the contract is testable without a listener and so
 * documented client snippets can call the same code path.
 */
export function verifySignature(header: string, secret: string, body: string, toleranceSeconds = 300, now = Date.now()): boolean {
    const parts = new Map(header.split(',').map((piece) => piece.split('=').map((bit) => bit.trim()) as [string, string]));
    const timestamp = Number(parts.get('t'));
    const provided = parts.get('v1');
    if (!Number.isFinite(timestamp) || !provided) return false;
    if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
    const expected = hmacSha256(secret, `${timestamp}.${body}`);
    const left = Buffer.from(expected);
    const right = Buffer.from(provided);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Exponential backoff, in seconds: 30s, 2m, 8m, ... capped at a day so a receiver that comes back
 * next week still gets the queue drained instead of having silently aged out.
 */
export function backoffSeconds(attempts: number): number {
    return Math.min(86_400, BACKOFF_BASE_SECONDS * 4 ** Math.max(0, attempts - 1));
}

export interface QueuedEvent {
    orgId: string;
    event: WebhookEvent;
    projectId?: string | null;
    taskId?: string | null;
    data: Record<string, unknown>;
}

/**
 * Insert pending deliveries for every active subscription to `event`.
 *
 * Returns how many were queued, which is also the cheap way for callers to find out whether
 * anybody is listening before doing extra work (like loading a task snapshot).
 */
export async function queueEvent(event: QueuedEvent): Promise<number> {
    const hooks = await prisma.webhook.findMany({
        where: { orgId: event.orgId, active: true, events: { contains: `"${event.event}"` } },
        select: { id: true, events: true },
    });
    const matching = hooks.filter((hook) => parseEvents(hook.events).includes(event.event));
    if (matching.length === 0) return 0;

    const id = crypto.randomUUID();
    const dispatchedAt = new Date().toISOString();
    await prisma.webhookDelivery.createMany({
        data: matching.map((hook) => ({
            webhookId: hook.id,
            event: event.event,
            payload: JSON.stringify({
                // One id per firing (not per delivery) so subscribers can correlate the same event
                // across hooks; retries of a single row keep that row's id in the header instead.
                eventId: id,
                event: event.event,
                orgId: event.orgId,
                projectId: event.projectId ?? null,
                taskId: event.taskId ?? null,
                dispatchedAt,
                data: event.data,
            }),
        })),
    });
    return matching.length;
}

export function parseEvents(raw: string): WebhookEvent[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item): item is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(item as string)) : [];
    } catch {
        return [];
    }
}

// ------------------------------------------------------------------- CRUD (settings)

/** Creating a hook generates its signing secret; it is shown once, like an API token. */
export async function createWebhook(orgId: string, input: CreateWebhookInput) {
    const secret = `whsec_${randomToken(24)}`;
    const row = await prisma.webhook.create({
        data: { orgId, url: input.url, secret, events: JSON.stringify([...new Set(input.events)]), active: input.active },
    });
    return { ...presentWebhook(row), secret };
}

export async function listWebhooks(orgId: string) {
    const rows = await prisma.webhook.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    return rows.map(presentWebhook);
}

function presentWebhook(row: { id: string; url: string; events: string; active: boolean; createdAt: Date; orgId: string }) {
    return { id: row.id, url: row.url, events: parseEvents(row.events), active: row.active, createdAt: row.createdAt, orgId: row.orgId };
}

/** Loads the hook and checks it belongs to this organization (404 rather than leaking ids). */
async function loadWebhook(orgId: string, id: string) {
    const row = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!row) throw new NotFound('No such webhook');
    return row;
}

export async function updateWebhook(orgId: string, id: string, input: UpdateWebhookInput) {
    await loadWebhook(orgId, id);
    const row = await prisma.webhook.update({
        where: { id },
        data: {
            ...(input.url !== undefined ? { url: input.url } : {}),
            ...(input.events !== undefined ? { events: JSON.stringify([...new Set(input.events)]) } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
        },
    });
    return presentWebhook(row);
}

/** Deleting a hook cascades its delivery log, which is the point: nobody audits a retired hook. */
export async function deleteWebhook(orgId: string, id: string) {
    await loadWebhook(orgId, id);
    await prisma.webhook.delete({ where: { id } });
    return { id };
}

/** Rotate the signing secret. Old signatures stop working immediately. */
export async function rotateSecret(orgId: string, id: string) {
    await loadWebhook(orgId, id);
    const secret = `whsec_${randomToken(24)}`;
    await prisma.webhook.update({ where: { id }, data: { secret } });
    return { id, secret };
}

/** URL and secret for the synchronous "send a test" endpoint. Never exposed through the list. */
export async function loadTarget(orgId: string, id: string) {
    const row = await loadWebhook(orgId, id);
    return { url: row.url, secret: row.secret };
}

export async function listDeliveries(orgId: string, webhookId: string, page: number, pageSize: number) {
    const hook = await loadWebhook(orgId, webhookId);
    const where = { webhookId: hook.id };
    const [items, total] = await Promise.all([
        prisma.webhookDelivery.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true, event: true, status: true, attempts: true, responseCode: true, error: true,
                createdAt: true, nextAttemptAt: true, payload: true,
            },
        }),
        prisma.webhookDelivery.count({ where }),
    ]);
    return {
        items: items.map((item) => ({
            ...item,
            /** The body itself is not part of the log list — it can hold task text and would grow fast. */
            payloadBytes: Buffer.byteLength(item.payload),
            payload: undefined,
        })),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
    };
}

// ------------------------------------------------------------------------ dispatch

export interface DeliveryAttempt {
    status: 'success' | 'failed' | 'pending';
    responseCode: number | null;
    error: string | null;
    /** `null` means "no further attempt scheduled"; the column itself is never nullable. */
    nextAttemptAt: Date | null;
}

/**
 * One HTTP attempt against one delivery.
 *
 * `fetchImpl` is a parameter rather than a module import so tests can inject a transport and assert
 * the exact headers the receiver must see; production always uses the global `fetch`.
 */
export async function attemptDelivery(
    args: { url: string; secret: string; body: string; deliveryId: string; event: string },
    fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DeliveryAttempt> {
    const timestamp = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.WEBHOOK_TIMEOUT_MS);
    try {
        const response = await fetchImpl(args.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': 'ZORQEN-Webhooks/1',
                // Both are in the clear so a receiver can log and dedupe without verifying first.
                'x-zorqen-delivery': args.deliveryId,
                'x-zorqen-event': args.event,
                'x-zorqen-signature': signatureHeader(args.secret, args.body, timestamp),
            },
            body: args.body,
            signal: controller.signal,
        });
        // Anything 2xx is an acknowledgement; the receiver's body is ignored on purpose.
        if (response.ok) return { status: 'success', responseCode: response.status, error: null, nextAttemptAt: null };
        return { status: 'failed', responseCode: response.status, error: `Receiver responded ${response.status}`, nextAttemptAt: null };
    } catch (error) {
        return { status: 'failed', responseCode: null, error: error instanceof Error ? error.message : 'Transport failed', nextAttemptAt: null };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Run one queued delivery and record the outcome.
 *
 * A failure is only terminal once `WEBHOOK_MAX_ATTEMPTS` is reached; before that the row goes back
 * to `pending` with a backoff timestamp, which is what the sweep reads.
 */
export async function deliver(id: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<DeliveryAttempt | null> {
    const delivery = await prisma.webhookDelivery.findUnique({
        where: { id },
        include: { webhook: { select: { url: true, secret: true, active: true } } },
    });
    if (!delivery) return null;

    if (!delivery.webhook.active) {
        // A hook switched off mid-queue: drop the attempt rather than retrying forever.
        const dropped: DeliveryAttempt = { status: 'failed', responseCode: null, error: 'Webhook is inactive', nextAttemptAt: null };
        await prisma.webhookDelivery.update({ where: { id }, data: { status: dropped.status, error: dropped.error } });
        return dropped;
    }

    const result = await attemptDelivery(
        { url: delivery.webhook.url, secret: delivery.webhook.secret, body: delivery.payload, deliveryId: delivery.id, event: delivery.event },
        fetchImpl,
    );
    const attempts = delivery.attempts + 1;

    if (result.status === 'success') {
        await prisma.webhookDelivery.update({
            where: { id },
            data: { status: 'success', attempts, responseCode: result.responseCode, error: null },
        });
        return result;
    }

    const terminal = attempts >= env.WEBHOOK_MAX_ATTEMPTS;
    // `nextAttemptAt` is a required column, so a terminal row simply keeps "now": the sweep only
    // claims `pending` rows, so nothing reads it again.
    const nextAttemptAt = terminal ? new Date() : new Date(Date.now() + backoffSeconds(attempts) * 1000);
    await prisma.webhookDelivery.update({
        where: { id },
        data: {
            status: terminal ? 'failed' : 'pending',
            attempts,
            responseCode: result.responseCode,
            error: result.error,
            nextAttemptAt,
        },
    });
    return { ...result, status: terminal ? 'failed' : 'pending', nextAttemptAt: terminal ? null : nextAttemptAt };
}

/**
 * Sweep due deliveries. Scheduled by cron, and safe to run on any replica: rows are claimed by
 * `nextAttemptAt`, so two overlapping sweeps only duplicate work, they do not corrupt state.
 */
export async function runWebhookRetries(now = new Date()): Promise<{ attempted: number; delivered: number; failed: number }> {
    const due = await prisma.webhookDelivery.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: SWEEP_BATCH,
        select: { id: true },
    });

    let delivered = 0;
    let failed = 0;
    for (const row of due) {
        const result = await deliver(row.id).catch(() => null);
        if (result?.status === 'success') delivered += 1;
        else failed += 1;
    }
    const counts = { attempted: due.length, delivered, failed };
    if (counts.attempted > 0) logger.info(counts, 'webhook sweep finished');
    return counts;
}

/** Prune the delivery log so a busy org's settings page does not read a million rows. */
export async function pruneDeliveries(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
    const result = await prisma.webhookDelivery.deleteMany({
        where: { status: { in: ['success', 'failed'] }, createdAt: { lt: cutoff } },
    });
    return result.count;
}
