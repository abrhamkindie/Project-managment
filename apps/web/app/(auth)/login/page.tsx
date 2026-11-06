import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '~/components/auth-form';
import { homeFor, safeNext } from '~/lib/paths';
import { getSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Sign in' };

/** `?next=` carries the page a visitor was trying to reach (an invitation link, a deep link). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const next = safeNext(params.next);
    const session = await getSession();
    if (session) redirect(next ?? homeFor(session));
    // `?mfa=` is the OIDC callback handing over its second-factor challenge: a redirect is the only
    // channel that flow has, and the form starts on the code step instead of the password one.
    return (
        <AuthForm
            mode="login"
            redirectTo={next}
            initialChallenge={typeof params.mfa === 'string' ? params.mfa : undefined}
            ssoError={params.error === 'sso'}
        />
    );
}
