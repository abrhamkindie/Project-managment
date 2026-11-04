import type { Metadata } from 'next';
import { ForgotPasswordForm } from '~/components/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password' };

/** Password recovery step 1 — a signed-out screen, so it lives in the `(auth)` group. */
export default function ForgotPasswordPage() {
    return <ForgotPasswordForm />;
}
