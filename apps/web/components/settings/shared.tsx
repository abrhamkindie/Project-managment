'use client';

import { useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { CREDENTIAL_STATUS_LABEL } from '~/lib/format';
import type { CredentialStatus } from '~/lib/types';
import { Badge, Button } from '../ui';

/**
 * Pieces the integration panels share, kept next to each other so a secret, a heading and an empty
 * list look the same in every one of them.
 */

export function PanelBlock({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
    return (
        <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {icon}
                    {title}
                </h3>
                {action}
            </div>
            {children}
        </div>
    );
}

/**
 * A credential the API only ever sends once.
 *
 * Tokens, webhook secrets and share URLs are stored hashed (or, for a share, only reachable through
 * the record that created it), so this box is the only place the plaintext will ever appear again:
 * it is selectable, copyable and impossible to lose without an explicit acknowledgement.
 */
export function SecretNote({ label, secret, onDismiss }: { label: string; secret: string[]; onDismiss: () => void }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        try {
            // A rejected promise means the browser refused clipboard access, which is a UI
            // nicety, not an error: the text below is still there to select by hand.
            navigator.clipboard.writeText(secret.join('\n')).then(
                () => setCopied(true),
                () => undefined,
            );
        } catch {
            /* Insecure origin or no clipboard API at all. */
        }
    };

    return (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{label}</p>
                <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </div>
            <p className="text-xs text-amber-800/80">
                This is the only time it is shown. Copy it now — there is no way to read it again.
            </p>
            <div className="space-y-1">
                {secret.map((value) => (
                    <code key={value} className="block select-all break-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink">
                        {value}
                    </code>
                ))}
            </div>
            <Button size="sm" onClick={onDismiss}>
                I have saved it
            </Button>
        </div>
    );
}

/** One chip for every credential-shaped row: tokens, shares, and anything else with a life span. */
export function CredentialBadge({ status }: { status: CredentialStatus }) {
    const tone = status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'danger';
    return <Badge tone={tone}>{CREDENTIAL_STATUS_LABEL[status]}</Badge>;
}
