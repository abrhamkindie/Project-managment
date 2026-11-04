import type { Metadata } from 'next';
import { ResetPasswordForm } from '~/components/reset-password-form';

export const metadata: Metadata = {
    title: 'Choose a new password',
    // The token is a bearer credential in the query string; keep the page out of indexes.
    robots: { index: false, follow: false },
};

/**
 * Password recovery step 2. The token arrives in the query string from the email link and is
 * handed to the client component untouched, so the screen stays reloadable until it is used.
 */
export default async function ResetPasswordPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const token = typeof params.token === 'string' && params.token ? params.token : undefined;
    return <ResetPasswordForm token={token} />;
}
