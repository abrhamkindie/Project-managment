'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useBeginMfaSetup, useDisableMfa, useEnableMfa, useMfaStatus, useRegenerateRecoveryCodes } from '~/lib/hooks';
import type { MfaSetupDto } from '~/lib/types';
import { Button, ErrorNote, Field, Input, Spinner } from '../ui';
import { PanelBlock, SecretNote } from './shared';

/**
 * Two-factor enrollment.
 *
 * Three states, and the panel shows exactly one of them: off (offer setup), mid-setup (the QR the
 * user has to scan and the code that proves they did), on (backup codes and the way out). The
 * server keeps `pendingSetup` for a secret that was issued but never confirmed, so refreshing this
 * page does not invalidate a QR code somebody is already pointing a phone at — starting over does,
 * which is why "start over" is stated as a deliberate action.
 */

export function TwoFactorPanel() {
    const status = useMfaStatus();
    const [setup, setSetup] = useState<MfaSetupDto | null>(null);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [recovery, setRecovery] = useState<string[] | null>(null);

    const begin = useBeginMfaSetup();
    const enable = useEnableMfa();
    const disable = useDisableMfa();
    const regenerate = useRegenerateRecoveryCodes();

    if (status.isLoading) {
        return (
            <PanelBlock title="Two-factor" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                <Spinner label="Loading security settings…" />
            </PanelBlock>
        );
    }

    const enrolled = status.data?.enabled ?? false;

    return (
        <PanelBlock
            title="Two-factor"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            action={enrolled ? <Button size="sm" variant="ghost" loading={regenerate.isPending} onClick={() => regenerate.mutate(undefined, { onSuccess: (result) => setRecovery(result.recoveryCodes) })}>New backup codes</Button> : null}
        >
            {recovery ? <SecretNote label="Backup codes" secret={recovery} onDismiss={() => setRecovery(null)} /> : null}

            {enrolled ? (
                <div className="space-y-3">
                    <p className="text-sm text-ink-soft">
                        A code from your authenticator is required at sign-in, along with{' '}
                        {status.data?.recoveryCodesLeft ?? 0} unused backup code
                        {status.data?.recoveryCodesLeft === 1 ? '' : 's'}.
                    </p>
                    <form
                        className="space-y-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            disable.mutate(password, { onSuccess: () => setPassword('') });
                        }}
                    >
                        <ErrorNote error={disable.error} />
                        <Field label="Confirm your password to turn two-factor off">
                            <Input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="current-password"
                            />
                        </Field>
                        <Button type="submit" size="sm" variant="danger" loading={disable.isPending} disabled={password.length === 0}>
                            Disable
                        </Button>
                    </form>
                </div>
            ) : setup ? (
                <div className="space-y-3">
                    <p className="text-sm text-ink-soft">
                        Scan this code with your authenticator app, then enter the six digits it shows. Nothing is enforced until that
                        code is accepted.
                    </p>
                    {/* The QR is generated server-side as a data URL: a secret never leaves for a third-party QR service. */}
                    <img src={setup.qrDataUrl} alt="Authenticator setup QR code" className="h-40 w-40 rounded-lg border border-line bg-white p-2" />
                    <p className="break-all font-mono text-xs text-ink-faint">{setup.secret}</p>
                    <p className="text-xs text-ink-muted">
                        Current code right now: <span className="font-mono text-ink">{setup.currentCode}</span> — it rotates every 30
                        seconds, so use the one your app is showing instead if this looks stale.
                    </p>
                    <form
                        className="space-y-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            enable.mutate(code.trim(), {
                                onSuccess: (result) => {
                                    setSetup(null);
                                    setCode('');
                                    setRecovery(result.recoveryCodes);
                                },
                            });
                        }}
                    >
                        <ErrorNote error={enable.error} />
                        <Field label="Authenticator code">
                            <Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={8} />
                        </Field>
                        <div className="flex gap-2">
                            <Button type="submit" variant="primary" size="sm" loading={enable.isPending} disabled={code.trim().length < 6}>
                                Verify and enable
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                loading={begin.isPending}
                                onClick={() => begin.mutate(undefined, { onSuccess: (next) => setSetup(next) })}
                            >
                                Start over
                            </Button>
                        </div>
                    </form>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-ink-soft">
                        {status.data?.pendingSetup
                            ? 'A setup was started and never finished. Scan a fresh code to complete it — the previous one stops working.'
                            : 'Require a six-digit code from an authenticator app at sign-in. A leaked password alone would not be enough to sign in.'}
                    </p>
                    <ErrorNote error={begin.error} />
                    <Button
                        variant="primary"
                        size="sm"
                        loading={begin.isPending}
                        onClick={() => begin.mutate(undefined, { onSuccess: (next) => setSetup(next) })}
                    >
                        Set up two-factor
                    </Button>
                    <p className="text-xs text-ink-faint">Single sign-on accounts without a password cannot use this yet.</p>
                </div>
            )}
        </PanelBlock>
    );
}
