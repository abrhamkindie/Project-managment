import { redirect } from 'next/navigation';
import { homeFor } from '~/lib/paths';
import { getSession } from '~/lib/server-session';

/**
 * `/` is never a screen: it resolves the session and sends the visitor to their workspace,
 * or to sign-in. Doing it on the server avoids a flash of a loading page.
 */
export default async function HomeRoute() {
    const session = await getSession();
    redirect(session ? homeFor(session) : '/login');
}
