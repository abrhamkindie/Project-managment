'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError, apiHref } from '~/lib/api';
import { restoreSession, useGoogleLogin, useLogin, useMfaVerify, useRegister, useSsoProviders } from '~/lib/hooks';
import { homeFor } from '~/lib/paths';
import { isMfaChallenge } from '~/lib/types';
import { Button, ErrorNote, Field, Input } from './ui';

/** Google Identity Services global types (loaded via script tag). */
declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (opts: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
                    renderButton: (el: HTMLElement, opts: { theme?: string; size?: string; text?: string; width?: number }) => void;
                };
            };
        };
    }
}

/**
 * Sign-in and sign-up in one form.
 *
 * Validation is mirrored here from the API schema (`apps/api/src/domain/schemas.ts`) purely so
 * a typo is caught before a round trip — the server stays the authority, and its field errors
 * are mapped into the same place as the local ones.
 *
 * Two-factor turns this into a two-step flow: a password that passes returns either a session
 * (done) or a challenge, and the challenge is only good at the code step below. The OIDC callback
 * hands its challenge back through the query string, because a browser redirect is the only
 * channel that flow has.
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

export function AuthForm({
    mode,
    redirectTo,
    initialChallenge,
    ssoError = false,
}: {
    mode: 'login' | 'register';
    redirectTo?: string;
    /** A challenge from the OIDC callback (`?mfa=…`): start on the code step, not the password one. */
    initialChallenge?: string;
    /** The IdP sent no usable code; say so once, without exposing which check failed. */
    ssoError?: boolean;
}) {
    const router = useRouter();
    const login = useLogin(redirectTo);
    const register = useRegister(redirectTo);
    const googleLogin = useGoogleLogin(redirectTo);
    const providers = useSsoProviders();
    const mutation = mode === 'login' ? login : register;

    const [values, setValues] = useState({ firstName: '', lastName: '', email: '', password: '', organizationName: '' });
    const [errors, setErrors] = useState<FormErrors>({});
    const [googleReady, setGoogleReady] = useState(false);
    const [challenge, setChallenge] = useState<string | null>(initialChallenge ?? null);
    const googleBtnRef = useRef<HTMLDivElement>(null);

    // Which buttons the API will actually honour, read from the provider registry rather than a
    // build-time env: a web-only client id would render a button whose route answers 400.
    const google = providers.data?.find((entry) => entry.kind === 'token' && entry.clientId);
    const redirectProviders = (providers.data ?? []).filter((entry) => entry.kind === 'redirect');
    const googleClientId = google?.clientId ?? undefined;

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

    // Load Google Identity Services script and initialize.
    // `mutate` from React Query is stable across renders, so the callback is only created once.
    const googleMutate = googleLogin.mutate;
    const handleGoogleCredential = useCallback(
        (response: { credential?: string }) => {
            if (response.credential) {
                googleMutate(response.credential);
            }
        },
        [googleMutate],
    );

    useEffect(() => {
        if (!googleClientId) return;
        // If GIS is already loaded, initialize immediately.
        if (window.google?.accounts?.id) {
            setGoogleReady(true);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => setGoogleReady(true);
        document.head.appendChild(script);
        return () => {
            // Don't remove the script — it may be needed for re-renders.
        };
    }, [googleClientId]);

    useEffect(() => {
        if (!googleReady || !googleClientId || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleCredential,
        });
        if (googleBtnRef.current) {
            googleBtnRef.current.innerHTML = '';
            window.google.accounts.id.renderButton(googleBtnRef.current, {
                theme: 'outline',
                size: 'large',
                text: mode === 'login' ? 'signin_with' : 'signup_with',
                width: 320,
            });
        }
    }, [googleReady, googleClientId, handleGoogleCredential, mode]);

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
                const result = await login.mutateAsync({ email: values.email, password: values.password });
                // The hook only redirects when it got a session; a challenge means ask for the code.
                if (isMfaChallenge(result)) setChallenge(result.challenge);
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

    // Every hook above runs on both steps; this return is the first thing after them, so the
    // challenge step cannot leave a stale password field behind for a second submit to spend.
    if (challenge) {
        return (
            <div className="space-y-6">
                <header className="space-y-1">
                    <h2 className="text-2xl font-semibold text-ink">Confirm it is you</h2>
                    <p className="text-sm text-ink-muted">Enter the six-digit code from your authenticator app, or one of your backup codes.</p>
                </header>
                <MfaCodeStep challenge={challenge} redirectTo={redirectTo} onBack={() => setChallenge(null)} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <header className="space-y-1">
                <h2 className="text-2xl font-semibold text-ink">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
                <p className="text-sm text-ink-muted">
                    {mode === 'login' ? 'Sign in to your workspace.' : 'Set up a workspace and start assigning work in seconds.'}
                </p>
            </header>

            {ssoError ? (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    That sign-in did not finish. Try again, or use your email and password.
                </p>
            ) : null}

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

                {mode === 'login' ? (
                    // Outside the Field: a link inside a <label> would hijack the input's focus.
                    <div className="-mt-2 flex justify-end">
                        <Link href="/forgot-password" className="link text-xs">
                            Forgot your password?
                        </Link>
                    </div>
                ) : null}

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

            {googleClientId ? (
                <>
                    <div className="flex items-center gap-3">
                        <span className="h-px flex-1 bg-line" />
                        <span className="text-xs text-ink-faint">or</span>
                        <span className="h-px flex-1 bg-line" />
                    </div>
                    {googleLogin.isError ? (
                        <ErrorNote error={googleLogin.error} />
                    ) : null}
                    <div ref={googleBtnRef} className="flex justify-center">
                        {!googleReady ? (
                            <Button variant="ghost" className="w-full border border-line" disabled>
                                Loading Google sign-in…
                            </Button>
                        ) : null}
                    </div>
                </>
            ) : null}

            {/* Redirect providers are one link each: `/auth/oidc/start` builds the state and sends
                the browser to the IdP, so there is nothing to initialise here. */}
            {redirectProviders.length ? (
                <div className="space-y-2">
                    {redirectProviders.map((provider) => (
                        <a
                            key={provider.name}
                            href={apiHref(`/auth/oidc/start?returnTo=${encodeURIComponent(redirectTo ?? '/')}`)}
                            className="btn btn-secondary w-full border border-line"
                        >
                            {`Continue with ${provider.label}`}
                        </a>
                    ))}
                </div>
            ) : null}

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

/**
 * The second factor.
 *
 * A wrong code comes back from a throttled endpoint as a plain 401, so nothing is parsed out of
 * the message and the field simply waits for another try. `onBack` is the way out of an expired
 * challenge: it goes back to the password step — which still holds what was typed — instead of
 * resubmitting a token the server has already stopped accepting.
 */
function MfaCodeStep({ challenge, redirectTo, onBack }: { challenge: string; redirectTo?: string; onBack: () => void }) {
    const verify = useMfaVerify(redirectTo);
    const [code, setCode] = useState('');

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                verify.mutate({ challenge, code: code.trim() });
            }}
        >
            <Field label="Code" hint="Six digits from the app, or a backup code if you have lost it.">
                <Input
                    name="code"
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={40}
                    placeholder="123456"
                />
            </Field>

            <ErrorNote error={verify.error} />

            <Button type="submit" variant="primary" loading={verify.isPending} disabled={code.trim().length < 6} className="w-full">
                Verify and sign in
            </Button>

            <button type="button" onClick={onBack} className="link text-xs">
                Use a different account
            </button>
        </form>
    );
}
