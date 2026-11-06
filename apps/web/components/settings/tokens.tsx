'use client';

import { useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { API_TOKEN_SCOPES, SCOPE_HINT, formatDateTime, relativeTime } from '~/lib/format';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '~/lib/hooks';
import type { ApiTokenScope, CreatedApiTokenDto } from '~/lib/types';
import { Badge, Button, ErrorNote, Field, Input, Spinner } from '../ui';
import { CredentialBadge, PanelBlock, SecretNote } from './shared';

/**
 * Personal access tokens.
 *
 * A token is a standing credential for the API, so the panel is deliberately plain: no editing
 * (a scope change means a new token), no expiry extension, and revocation from the row that
 * carried it. `*` is listed like any other scope rather than treated as a superset, because that
 * is how the API matches it — checking `read` alongside `*` would be a lie about what was granted.
 */

const DEFAULT_DAYS = '90';

export function ApiTokensPanel() {
    const tokens = useApiTokens();
    const create = useCreateApiToken();
    const revoke = useRevokeApiToken();

    const [name, setName] = useState('');
    const [scopes, setScopes] = useState<ApiTokenScope[]>(['read']);
    const [expiresInDays, setExpiresInDays] = useState(DEFAULT_DAYS);
    const [issued, setIssued] = useState<CreatedApiTokenDto | null>(null);

    const days = Number(expiresInDays);
    const validDays = expiresInDays === '' || (Number.isInteger(days) && days >= 1 && days <= 365);

    const toggle = (scope: ApiTokenScope) =>
        setScopes((current) => (current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope]));

    return (
        <PanelBlock title="API tokens" icon={<KeyRound className="h-3.5 w-3.5" />}>
            <p className="text-xs text-ink-muted">
                Tokens authenticate against <code className="font-mono">Authorization: Bearer zrq_…</code> and carry the scopes you
                grant here. They can read and change work, never create another token.
            </p>

            {issued ? (
                <SecretNote
                    label={`${issued.name} · ${issued.token.slice(0, 8)}…`}
                    secret={[issued.token]}
                    onDismiss={() => setIssued(null)}
                />
            ) : null}

            {tokens.isLoading ? <Spinner label="Loading tokens…" /> : null}
            <ErrorNote error={tokens.error} />

            <ul className="divide-y divide-line rounded-lg border border-line">
                {(tokens.data ?? []).map((token) => (
                    <li key={token.id} className="flex items-start gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm text-ink">{token.name}</span>
                                <CredentialBadge status={token.status} />
                                {token.scopes.map((scope) => (
                                    <Badge key={scope} tone={scope === '*' ? 'warning' : 'neutral'}>
                                        {scope}
                                    </Badge>
                                ))}
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-faint">
                                Created {formatDateTime(token.createdAt)} ·{' '}
                                {token.lastUsedAt ? `last used ${relativeTime(token.lastUsedAt)}` : 'never used'} ·{' '}
                                {token.expiresAt ? `expires ${formatDateTime(token.expiresAt)}` : 'no expiry'}
                            </span>
                        </span>
                        {token.status === 'active' ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                loading={revoke.isPending && revoke.variables === token.id}
                                onClick={() => revoke.mutate(token.id)}
                            >
                                Revoke
                            </Button>
                        ) : null}
                    </li>
                ))}
                {tokens.data && tokens.data.length === 0 ? <li className="px-3 py-3 text-sm text-ink-muted">No tokens yet.</li> : null}
            </ul>

            <form
                className="space-y-3 rounded-lg border border-line bg-subtle/40 p-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate(
                        { name: name.trim(), scopes, ...(expiresInDays === '' ? {} : { expiresInDays: days }) },
                        { onSuccess: (created) => setIssued(created) },
                    );
                }}
            >
                <ErrorNote error={create.error} />
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <Field label="New token" hint="A name you will recognise in a log line.">
                        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="CI deploy" maxLength={60} />
                    </Field>
                    <Field label="Expires in" error={validDays ? undefined : '1–365 days, or leave empty'}>
                        <Input
                            type="number"
                            min={1}
                            max={365}
                            value={expiresInDays}
                            onChange={(event) => setExpiresInDays(event.target.value)}
                            placeholder="never"
                        />
                    </Field>
                </div>
                <fieldset className="space-y-1.5">
                    <legend className="label">Scopes</legend>
                    {API_TOKEN_SCOPES.map((scope) => (
                        <label key={scope} className="flex items-start gap-2">
                            <input type="checkbox" className="checkbox mt-0.5" checked={scopes.includes(scope)} onChange={() => toggle(scope)} />
                            <span>
                                <span className="block text-sm text-ink">{scope}</span>
                                <span className="block text-xs text-ink-faint">{SCOPE_HINT[scope]}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
                <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={create.isPending}
                    disabled={name.trim().length < 2 || scopes.length === 0 || !validDays}
                >
                    Create token
                </Button>
            </form>
        </PanelBlock>
    );
}
