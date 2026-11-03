import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '~/components/toast';
import { QueryProvider } from './providers';
import { ThemeProvider } from '~/lib/theme';
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

/** Runs before paint so the stored/system theme is on `<html>` from the very first frame. */
const THEME_SCRIPT = `(function(){try{var k='atlas-theme';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d)c.add('dark');else c.remove('dark');document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
            </head>
            <body className="min-h-full font-sans text-ink antialiased">
                <ThemeProvider>
                    <QueryProvider>
                        <ToastProvider>{children}</ToastProvider>
                    </QueryProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
