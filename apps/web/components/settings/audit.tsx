'use client';

import { useState, type FormEvent } from 'react';
import { Download, History } from 'lucide-react';
import { AUDIT_EVENT_OPTIONS, describeActivity, formatDateTime, fullName, relativeTime } from '~/lib/format';
import { auditExportHref } from '~/lib/queries';
import { useAuditLog, usePeople } from '~/lib/hooks';
import type { AuditQuery } from '~/lib/types';
import { Avatar, Button, ErrorNote, Field, Input, Select, Spinner } from '../ui';
import { PanelBlock } from './shared';

/**
 * Settings → Audit: who did what, narrowed by actor, event type and date range.
 *
 * The filters are applied on submit rather than on every keystroke — each one is part of the cache
 * key, so typing a date range would otherwise fetch a page per character. `before` is not a filter:
 * it is a cursor the API handed back, and paging backwards keeps the filters that produced it.
 *
 * The CSV download is admin-only because that is what the route enforces. A member still gets the
 * feed (private-project rows are filtered out of it server-side), just not a file of it.
 */

const PAGE_LIMIT = 50;

export function AuditPanel({ orgId, admin }: { orgId: string; admin: boolean }) {
    const roster = usePeople(orgId);
    const [applied, setApplied] = useState<AuditQuery>({ limit: PAGE_LIMIT });
    const [userId, setUserId] = useState('');
    const [type, setType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const feed = useAuditLog(orgId, applied);
    const rows = feed.data?.pages.flatMap((page) => page.items) ?? [];

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setApplied({
            limit: PAGE_LIMIT,
            ...(userId ? { userId } : {}),
            ...(type ? { type } : {}),
            // A `<input type="date">` value is a calendar day in the *visitor's* zone; the API
            // compares absolute instants, so both bounds are converted at their local edges.
            ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
            ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
        });
    };

    const reset = () => {
        setUserId('');
        setType('');
        setFrom('');
        setTo('');
        setApplied({ limit: PAGE_LIMIT });
    };

    return (
        <PanelBlock
            title="Audit log"
            icon={<History className="h-3.5 w-3.5" />}
            action={
                admin ? (
                    <a
                        href={auditExportHref(orgId, applied)}
                        className="btn btn-secondary btn-sm"
                        title="Downloads up to 5,000 newest rows matching these filters"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export CSV
                    </a>
                ) : null
            }
        >
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submit}>
                <Field label="Who">
                    <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
                        <option value="">Anyone</option>
                        {roster.people.map((person) => (
                            <option key={person.id} value={person.id}>
                                {fullName(person)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Event">
                    <Select value={type} onChange={(event) => setType(event.target.value)}>
                        <option value="">Any type</option>
                        {AUDIT_EVENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="From">
                    <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </Field>
                <Field label="To">
                    <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </Field>
                <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm" variant="primary" loading={feed.isFetching}>
                        Apply
                    </Button>
                    <Button size="sm" variant="ghost" onClick={reset}>
                        Clear
                    </Button>
                </div>
            </form>

            <ErrorNote error={feed.error} />
            {feed.isLoading ? <Spinner label="Loading history…" /> : null}

            <ul className="divide-y divide-line rounded-lg border border-line">
                {rows.map((row) => (
                    <li key={row.id} className="flex items-start gap-2.5 px-3 py-2.5">
                        <Avatar user={row.actor} size="sm" />
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm text-ink-soft">
                                <span className="text-ink">{fullName(row.actor)}</span> {describeActivity(row)}
                            </span>
                            <span className="block text-xs text-ink-faint">
                                {relativeTime(row.createdAt)} · {formatDateTime(row.createdAt)}
                            </span>
                        </span>
                    </li>
                ))}
                {feed.data && rows.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-ink-muted">Nothing matches these filters.</li>
                ) : null}
            </ul>

            {feed.hasNextPage ? (
                <Button
                    size="sm"
                    loading={feed.isFetchingNextPage}
                    onClick={() => void feed.fetchNextPage()}
                    className="w-full"
                >
                    Load older
                </Button>
            ) : rows.length ? (
                <p className="text-xs text-ink-faint">That is the whole visible history.</p>
            ) : null}
        </PanelBlock>
    );
}
