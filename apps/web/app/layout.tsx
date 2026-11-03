import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '~/components/toast';
import { QueryProvider } from './providers';
import './globals.css';

/**
 * Root layout.
 *
 * Deliberately session-free: it wraps both the signed-out screens and the workspace, and the
 * providers below are the only shared state in the app (server cache + toasts).
 */

export const viewport: Viewport = {
    themeColor: '#4f46e5',
    width: 'device-width',
    initialScale: 1,
};

export const metadata = {
    title: { default: 'Atlas', template: '%s · Atlas' },
    description: 'Atlas is a project workspace: projects, tasks, assignments and analytics in one place.',
    // A private team tool should not be crawled, and signed-out pages have nothing to index.
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="min-h-full font-sans text-ink">
                <QueryProvider>
                    <ToastProvider>{children}</ToastProvider>
                </QueryProvider>
            </body>
        </html>
    );
}
