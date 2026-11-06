'use client';

import { useState } from 'react';
import { Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { WEBHOOK_EVENT_LABEL, WEBHOOK_EVENTS, formatDateTime, relativeTime } from '~/lib/format';
import { useCreateWebhook, useDeleteWebhook, useRotateWebhookSecret, useTestWebhook, useUpdateWebhook, useWebhookDeliveries, useWebhooks } from '~/lib/hooks';
import type { CreatedWebhookDto, WebhookDto, WebhookEvent } from '~/lib/types';
import { Badge, Button, ErrorNote, Field, Input, Spinner } from '../ui';
import { PanelBlock, SecretNote } from './shared';

/**
 * Outbound webhooks, admin-only because every one of them is a URL the server will be told to POST
 * to. The list carries no secret — it was returned once at creation and rotation is the only way to
 * get another, which is exactly why the rotate button warns instead of quietly swapping it.
 *
 * Deliveries are read per hook and on demand: a log can be long, and the panel has no reason to
 * fetch twenty of them nobody is looking at.
 */

/** The API's own default page size for the delivery log; the pager counts pages of this. */
const DELIVERY_PAGE_SIZE = 25;

export function WebhooksPanel({ orgId }: { orgId: string }) {
    const hooks = useWebhooks(orgId);
    const create = useCreateWebhook(orgId);
    const [url, setUrl] = useState('');
    const [events, setEvents] = useState<WebhookEvent[]>(['task.status_changed']);
    const [issued, setIssued] = useState<CreatedWebhookDto | null>(null);

    const toggle = (event: WebhookEvent) =>
        setEvents((current) => (current.includes(event) ? current.filter((entry) => entry !== event) : [...current, event]));

    return (
        <PanelBlock title="Webhooks" icon={<WebhookIcon className="h-3.5 w-3.5" />}>
            {issued ? (
                <SecretNote
                    label={`Signing secret for ${issued.url}`}
                    secret={[issued.secret]}
                    onDismiss={() => setIssued(null)}
                />
            ) : null}

            {hooks.isLoading ? <Spinner label="Loading webhooks…" /> : null}
            <ErrorNote error={hooks.error} />

            <ul className="divide-y divide-line rounded-lg border border-line">
                {(hooks.data ?? []).map((hook) => (
                    <WebhookRow key={hook.id} orgId={orgId} hook={hook} />
                ))}
                {hooks.data && hooks.data.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-ink-muted">No endpoints are receiving events.</li>
                ) : null}
            </ul>

            <form
                className="space-y-3 rounded-lg border border-line bg-subtle/40 p-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate({ url: url.trim(), events }, { onSuccess: (created) => setIssued(created) });
                }}
            >
                <ErrorNote error={create.error} />
                <Field label="Endpoint URL" hint="https:// is required. The receiver verifies the HMAC signature on each delivery.">
                    <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://hooks.example.com/zorqen" />
                </Field>
                <fieldset className="space-y-1">
                    <legend className="label">Events</legend>
                    <div className="grid gap-1 sm:grid-cols-2">
                        {WEBHOOK_EVENTS.map((event) => (
                            <label key={event} className="flex items-center gap-2">
                                <input type="checkbox" className="checkbox" checked={events.includes(event)} onChange={() => toggle(event)} />
                                <span className="text-sm text-ink-soft">{WEBHOOK_EVENT_LABEL[event]}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!/^https:\/\/\S+$/i.test(url.trim()) || events.length === 0}>
                    Add endpoint
                </Button>
            </form>
        </PanelBlock>
    );
}

function WebhookRow({ orgId, hook }: { orgId: string; hook: WebhookDto }) {
    const update = useUpdateWebhook(orgId);
    const remove = useDeleteWebhook(orgId);
    const rotate = useRotateWebhookSecret(orgId);
    const test = useTestWebhook(orgId);
    const [showLog, setShowLog] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);

    return (
        <li className="space-y-2 px-3 py-2.5">
            <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-xs text-ink">{hook.url}</span>
                        {hook.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                            <Badge key={event} tone="neutral">
                                {WEBHOOK_EVENT_LABEL[event]}
                            </Badge>
                        ))}
                    </span>
                </span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        loading={update.isPending && update.variables?.id === hook.id}
                        onClick={() => update.mutate({ id: hook.id, url: hook.url, events: hook.events, active: !hook.active })}
                    >
                        {hook.active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button size="sm" variant="ghost" loading={test.isPending && test.variables === hook.id} onClick={() => test.mutate(hook.id)}>
                        Test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowLog((current) => !current)}>
                        {showLog ? 'Hide log' : 'Log'}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        loading={rotate.isPending && rotate.variables === hook.id}
                        onClick={() => rotate.mutate(hook.id, { onSuccess: (result) => setSecret(result.secret) })}
                    >
                        Rotate
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label="Delete endpoint" onClick={() => remove.mutate(hook.id)} />
                </div>
            </div>

            {secret ? <SecretNote label="New signing secret" secret={[secret]} onDismiss={() => setSecret(null)} /> : null}
            {test.data ? (
                <p className="text-xs text-ink-muted">
                    {test.data.delivered
                        ? `Test accepted (HTTP ${test.data.responseCode}).`
                        : `Test failed: ${test.data.error ?? `HTTP ${test.data.responseCode ?? 'no response'}`}`}
                </p>
            ) : null}

            {showLog ? <DeliveryLog orgId={orgId} hookId={hook.id} /> : null}
        </li>
    );
}

function DeliveryLog({ orgId, hookId }: { orgId: string; hookId: string }) {
    const [page, setPage] = useState(1);
    const live = useWebhookDeliveries(orgId, hookId, page);
    const rows = live.data?.items ?? [];
    const total = live.data?.total ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / DELIVERY_PAGE_SIZE));

    return (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Deliveries</p>
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                    <Button size="sm" variant="ghost" disabled={page <= 1 || live.isFetching} onClick={() => setPage((current) => current - 1)}>
                        Newer
                    </Button>
                    <span>
                        page {page} of {lastPage}
                    </span>
                    <Button size="sm" variant="ghost" disabled={page >= lastPage || live.isFetching} onClick={() => setPage((current) => current + 1)}>
                        Older
                    </Button>
                </div>
            </div>
            <ErrorNote error={live.error} />
            {live.isLoading ? <Spinner label="Loading deliveries…" /> : null}
            <ul className="space-y-1">
                {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={row.status === 'success' ? 'text-state-done' : row.status === 'failed' ? 'text-danger' : 'text-ink-faint'}>
                            {row.status}
                        </span>
                        <span className="text-ink-soft">{row.event}</span>
                        <span className="text-ink-faint">
                            {formatDateTime(row.createdAt)} · {relativeTime(row.createdAt)} · {row.attempts} attempt
                            {row.attempts === 1 ? '' : 's'} · {row.responseCode ?? '—'} · {row.payloadBytes} bytes
                        </span>
                        {row.error ? <span className="w-full truncate text-danger">{row.error}</span> : null}
                    </li>
                ))}
                {live.data && rows.length === 0 ? <li className="text-xs text-ink-muted">Nothing has been sent to this endpoint yet.</li> : null}
            </ul>
        </div>
    );
}
