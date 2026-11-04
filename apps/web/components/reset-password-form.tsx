'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { z } from 'zod';
import { messageOf, usePasswordResetState, useResetPassword } from '~/lib/hooks';
import { Button, ErrorNote, Field, Input, Spinner } from './ui';

/**
 * "Forgot password" step 2 (`/reset-password?token=…`).
 *
 * The link is checked with the API before any typing happens, so an expired or already-used
 * token says so on arrival instead of after a rejected submit. The check is a one-shot read
 * (`retry: false`) and the token is never written to storage — it lives only in this URL.
 */

// Mirrors `passwordSchema` in the API, so a weak choice is caught before the round trip.
const NewPassword = z
    .string()
    .min(8, 'Use at least 8 characters')
    .regex(/[a-zA-Z]/, 'Include at least one letter')
    .regex(/[0-9]/, 'Include at least one number');

export function ResetPasswordForm({ token }: { token?: string }) {
    const state = usePasswordResetState(token);
    const reset = useResetPassword();
    const [values, setValues] = useState({ password: '', confirm: '' });
    const [errors, setErrors] = useState<Record<string, string>>({});

    if (!token) {
        return (
            <DeadLink
                body="This address has no reset token in it. Open the link from the email we sent, or request a new one."
            />
        );
    }

    if (state.isPending) {
        return (
            <div className="card flex items-center gap-3 p-5">
                <Spinner label="Checking your link…" />
            </div>
        );
    }

    if (state.isError || state.data?.valid !== true) {
        return (
            <DeadLink body="This reset link has expired or was already used. Request a new one — it is free and the old link stops working." />
        );
    }

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const parsed = z
            .object({ password: NewPassword, confirm: z.string() })
            .refine((data) => data.password === data.confirm, { path: ['confirm'], message: 'The passwords do not match' });
        const result = parsed.safeParse(values);
        if (!result.success) {
            const next: Record<string, string> = {};
            for (const issue of result.error.issues) {
                const key = issue.path.join('.');
                if (key && !next[key]) next[key] = issue.message;
            }
            setErrors(next);
            return;
        }
        setErrors({});
        reset.mutate({ token, password: values.password });
    };

    return (
        <div className="space-y-6">
            <header className="space-y-1">
                <h2 className="text-2xl font-semibold text-ink">Choose a new password</h2>
                <p className="text-sm text-ink-muted">
                    For <strong className="font-medium text-ink">{state.data.email}</strong>. Signing in again will be
                    needed on every device — resetting a password ends all active sessions.
                </p>
            </header>

            <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="New password" error={errors.password} hint="At least 8 characters, with a letter and a number." required>
                    <Input
                        type="password"
                        name="password"
                        autoComplete="new-password"
                        autoFocus
                        value={values.password}
                        onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
                    />
                </Field>
                <Field label="Confirm password" error={errors.confirm} required>
                    <Input
                        type="password"
                        name="confirm"
                        autoComplete="new-password"
                        value={values.confirm}
                        onChange={(event) => setValues((current) => ({ ...current, confirm: event.target.value }))}
                    />
                </Field>

                <ErrorNote error={reset.error ? messageOf(reset.error) : null} />

                <Button type="submit" variant="primary" loading={reset.isPending} className="w-full" icon={<KeyRound className="h-4 w-4" />}>
                    Change password
                </Button>
            </form>

            <Link href="/forgot-password" className="link block text-sm">
                Send me a new link instead
            </Link>
        </div>
    );
}

function DeadLink({ body }: { body: string }) {
    return (
        <div className="space-y-5">
            <header className="space-y-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-danger">
                    <ShieldAlert className="h-5 w-5" />
                </span>
                <h1 className="text-2xl font-semibold text-ink">This link is no longer valid</h1>
                <p className="text-sm text-ink-muted">{body}</p>
            </header>
            <Link href="/forgot-password" className="btn btn-primary w-full">
                Request a new link
            </Link>
            <Link href="/login" className="link block text-sm">
                Back to sign in
            </Link>
        </div>
    );
}
