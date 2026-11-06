'use client';

import { useState } from 'react';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import { formatDateTime } from '~/lib/format';
import { useCreateShare, useProjects, useRevokeShare, useShares } from '~/lib/hooks';
import type { CreatedShareDto } from '~/lib/types';
import { Button, ErrorNote, Field, Input, Select, Spinner } from '../ui';
import { CredentialBadge, PanelBlock, SecretNote } from './shared';

/**
 * Public share links.
 *
 * A link is a read-only snapshot of one project or one task, and the token behind it is hashed on
 * the way in — so the list can show what a link points at and when it dies, but it cannot offer the
 * URL again after creation. Anyone who loses it makes a new link.
 *
 * Revocation is instant: the URL starts answering 404 on the next request, which is the only
 * behaviour that makes an expired-but-still-published page safe to hand out.
 */

/** The API caps a share at 90 days; the picker refuses the rest instead of letting the server say no. */
const MAX_DAYS = 90;

export function SharesPanel({ orgId }: { orgId: string }) {
    const shares = useShares(orgId);
    const projects = useProjects(orgId, { pageSize: 100 });
    const create = useCreateShare(orgId);
    const revoke = useRevokeShare(orgId);

    const [projectId, setProjectId] = useState('');
    const [expiresInDays, setExpiresInDays] = useState('7');
    const [issued, setIssued] = useState<CreatedShareDto | null>(null);

    const days = Number(expiresInDays);
    const validDays = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

    return (
        <PanelBlock title="Share links" icon={<Link2 className="h-3.5 w-3.5" />}>
            {issued ? (
                <div className="space-y-2">
                    <SecretNote label={`Link to ${issued.projectId ? 'a project' : 'a task'}`} secret={[issued.url]} onDismiss={() => setIssued(null)} />
                    <a href={issued.url} target="_blank" rel="noreferrer noopener" className="link inline-flex items-center gap-1 text-xs">
                        <ExternalLink className="h-3 w-3" />
                        Preview it
                    </a>
                </div>
            ) : null}

            {shares.isLoading ? <Spinner label="Loading links…" /> : null}
            <ErrorNote error={shares.error} />

            <ul className="divide-y divide-line rounded-lg border border-line">
                {(shares.data ?? []).map((share) => (
                    <li key={share.id} className="flex items-start gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm text-ink">{share.taskTitle ?? share.projectName ?? 'Deleted object'}</span>
                                <CredentialBadge status={share.status} />
                                <span className="text-xs text-ink-faint">{share.taskTitle ? 'Task' : 'Project'}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-faint">
                                Created {formatDateTime(share.createdAt)} ·{' '}
                                {share.status === 'active'
                                    ? `expires ${formatDateTime(share.expiresAt)}`
                                    : `ended ${formatDateTime(share.revokedAt ?? share.expiresAt)}`}
                            </span>
                        </span>
                        {share.status === 'active' ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                aria-label="Revoke link"
                                loading={revoke.isPending && revoke.variables === share.id}
                                onClick={() => revoke.mutate(share.id)}
                            />
                        ) : null}
                    </li>
                ))}
                {shares.data && shares.data.length === 0 ? <li className="px-3 py-3 text-sm text-ink-muted">Nothing is shared publicly.</li> : null}
            </ul>

            <form
                className="space-y-3 rounded-lg border border-line bg-subtle/40 p-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate({ projectId, expiresInDays: days }, { onSuccess: (created) => setIssued(created) });
                }}
            >
                <ErrorNote error={create.error} />
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <Field label="Project" hint="A snapshot of the board only: no comments, files, history or member list.">
                        <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                            <option value="">Choose a project…</option>
                            {(projects.data?.items ?? []).map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Valid for" error={validDays ? undefined : `1–${MAX_DAYS} days`}>
                        <Input type="number" min={1} max={MAX_DAYS} value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
                    </Field>
                </div>
                <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!projectId || !validDays}>
                    Create link
                </Button>
            </form>
        </PanelBlock>
    );
}
