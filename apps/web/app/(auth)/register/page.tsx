import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '~/components/auth-form';
import { homeFor, safeNext } from '~/lib/paths';
import { getSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Create account' };

/**
 * Sign-up.
 *
 * `?invite=` is the token from an invitation e-mail: creating the account should return the
 * visitor to the invite screen, where the join is completed with the new session.
 */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const token = typeof params.invite === 'string' ? params.invite : undefined;
    const next = safeNext(params.next) ?? (token ? `/invite?token=${encodeURIComponent(token)}` : undefined);

    const session = await getSession();
    if (session) redirect(next ?? homeFor(session));
    return <AuthForm mode="register" redirectTo={next} />;
}
