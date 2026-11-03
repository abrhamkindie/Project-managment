import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '~/components/auth-form';
import { homeFor, safeNext } from '~/lib/paths';
import { getSession } from '~/lib/server-session';

export const metadata: Metadata = { title: 'Sign in' };

/** `?next=` carries the page a visitor was trying to reach (an invitation link, a deep link). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const next = safeNext((await searchParams).next);
    const session = await getSession();
    if (session) redirect(next ?? homeFor(session));
    return <AuthForm mode="login" redirectTo={next} />;
}
