import type { Config } from 'tailwindcss';

/**
 * Design tokens live here so the UI has one palette to lean on.
 * `brand` matches the default project color, and the status/priority colors are the same
 * ones the API returns for projects and labels, so a chip looks the same everywhere.
 */
const config: Config = {
    content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#312e81',
                },
                canvas: '#f7f8fa',
                surface: '#ffffff',
                line: '#e5e7eb',
                ink: { DEFAULT: '#111827', soft: '#374151', muted: '#6b7280', faint: '#9ca3af' },
                // Keyed by the friendly name, mapped from API statuses in lib/format.ts.
                state: {
                    todo: '#94a3b8',
                    progress: '#3b82f6',
                    review: '#a855f7',
                    done: '#22c55e',
                    canceled: '#eab308',
                    urgent: '#dc2626',
                    high: '#ea580c',
                },
                danger: '#dc2626',
            },
            boxShadow: {
                card: '0 1px 2px 0 rgb(16 24 40 / 0.06), 0 1px 3px 0 rgb(16 24 40 / 0.10)',
                pop: '0 10px 30px -12px rgb(16 24 40 / 0.28)',
            },
            fontFamily: {
                // No webfont download: the platform must render identically offline.
                sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
            },
            borderRadius: { xl: '0.75rem', '2xl': '1rem' },
        },
    },
    plugins: [],
};

export default config;
