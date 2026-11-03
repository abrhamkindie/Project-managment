'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError } from '~/lib/api';
import { restoreSession, useLogin, useRegister } from '~/lib/hooks';
import { homeFor } from '~/lib/paths';
import { Button, ErrorNote, Field, Input } from './ui';

/**
 * Sign-in and sign-up in one form.
 *
 * Validation is mirrored here from the API schema (`apps/api/src/domain/schemas.ts`) purely so
 * a typo is caught before a round trip — the server stays the authority, and its field errors
 * are mapped into the same place as the local ones.
 */

const Email = z.string().trim().toLowerCase().min(1, 'Enter your email address').email('Enter a valid email address');
const Name = z.string().trim().min(1, 'Required').max(60);

const loginSchema = z.object({ email: Email, password: z.string().min(1, 'Enter your password') });
const registerSchema = z.object({
    firstName: Name,
    lastName: Name,
    email: Email,
    // Same rules the API enforces, so the hint under the field is not a lie.
    password: z.string().min(8, 'Use at least 8 characters').regex(/[a-zA-Z]/, 'Include at least one letter').regex(/[0-9]/, 'Include at least one number'),
    organizationName: z.string().trim().max(80).optional(),
});

type FormErrors = Record<string, string>;

export function AuthForm({ mode, redirectTo }: { mode: 'login' | 'register'; redirectTo?: string }) {
    const router = useRouter();
    const login = useLogin(redirectTo);
    const register = useRegister(redirectTo);
    const mutation = mode === 'login' ? login : register;

    const [values, setValues] = useState({ firstName: '', lastName: '', email: '', password: '', organizationName: '' });
    const [errors, setErrors] = useState<FormErrors>({});

    // Already signed in (or restorable): do not show a form that cannot be used.
    useEffect(() => {
        let active = true;
        restoreSession().then((session) => {
            if (session && active) router.replace(redirectTo ?? homeFor(session));
        });
        return () => {
            active = false;
        };
    }, [redirectTo, router]);

    const set = (key: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) => {
        setValues((current) => ({ ...current, [key]: event.target.value }));
        setErrors((current) => ({ ...current, [key]: '' }));
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();

        const schema = mode === 'login' ? loginSchema : registerSchema;
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
            const next: FormErrors = {};
            for (const issue of parsed.error.issues) {
                const key = issue.path.join('.');
                if (key && !next[key]) next[key] = issue.message;
            }
            setErrors(next);
            return;
        }

        try {
            // `organizationName` is optional on the API too, so an empty box is left out rather than sent as "".
            if (mode === 'login') {
                await login.mutateAsync({ email: values.email, password: values.password });
            } else {
                await register.mutateAsync({
                    firstName: values.firstName,
                    lastName: values.lastName,
                    email: values.email,
                    password: values.password,
                    organizationName: values.organizationName.trim() || undefined,
                });
            }
        } catch {
            /* Failures are rendered from `mutation.error`; nothing else to do here. */
        }
    };

    // A failed write is either field-level (validation) or a single message (bad credentials, email taken).
    const serverErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors : {};
    const errorOf = (key: string) => errors[key] || serverErrors[key];

    return (
        <div className="space-y-6">
            <header className="space-y-1">
                <h2 className="text-2xl font-semibold text-ink">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
                <p className="text-sm text-ink-muted">
                    {mode === 'login' ? 'Sign in to your workspace.' : 'Set up a workspace and start assigning work in seconds.'}
                </p>
            </header>

            <form onSubmit={submit} className="space-y-4" noValidate>
                {mode === 'register' ? (
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="First name" error={errorOf('firstName')} required>
                            <Input name="firstName" autoComplete="given-name" value={values.firstName} onChange={set('firstName')} />
                        </Field>
                        <Field label="Last name" error={errorOf('lastName')} required>
                            <Input name="lastName" autoComplete="family-name" value={values.lastName} onChange={set('lastName')} />
                        </Field>
                    </div>
                ) : null}

                <Field label="Email" error={errorOf('email')} required>
                    <Input type="email" name="email" autoComplete="email" value={values.email} onChange={set('email')} />
                </Field>

                <Field
                    label="Password"
                    error={errorOf('password')}
                    hint={mode === 'register' ? 'At least 8 characters, with a letter and a number.' : undefined}
                    required
                >
                    <Input
                        type="password"
                        name="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        value={values.password}
                        onChange={set('password')}
                    />
                </Field>

                {mode === 'register' ? (
                    <Field label="Workspace name" error={errorOf('organizationName')} hint="Optional — we will create a personal workspace for you.">
                        <Input name="organizationName" placeholder="Acme Inc." value={values.organizationName} onChange={set('organizationName')} />
                    </Field>
                ) : null}

                <ErrorNote error={mutation.error} />

                <Button type="submit" variant="primary" loading={mutation.isPending} className="w-full">
                    {mode === 'login' ? 'Sign in' : 'Create account'}
                </Button>
            </form>

            <p className="text-sm text-ink-muted">
                {mode === 'login' ? (
                    <>
                        No account yet?{' '}
                        <Link href="/register" className="link">
                            Create one
                        </Link>
                    </>
                ) : (
                    <>
                        Already registered?{' '}
                        <Link href="/login" className="link">
                            Sign in
                        </Link>
                    </>
                )}
            </p>
        </div>
    );
}
