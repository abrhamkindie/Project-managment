import type { Config } from 'tailwindcss';

/**
 * Design tokens.
 *
 * Every color resolves to a CSS custom property (declared in globals.css) so themes are a token
 * swap, not a component rewrite: `bg-surface` reads `--surface`, and `.dark` redefines that one
 * variable. Values are stored as raw RGB channels so Tailwind's `/opacity` modifiers keep working
 * (e.g. `bg-backdrop/60`, `bg-brand-50/60`).
 *
 * `brand` is a tintable ramp (chips, links, active nav); `accent` is the solid control color
 * (primary buttons) that does not invert. The default `gray/green/red/amber/sky` scales are
 * repointed to semantic variables so existing utility classes flip correctly in dark mode.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
    darkMode: 'class',
    content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: token('brand-50'),
                    100: token('brand-100'),
                    200: token('brand-200'),
                    300: token('brand-300'),
                    400: token('brand-400'),
                    500: token('brand-500'),
                    600: token('brand-600'),
                    700: token('brand-700'),
                    800: token('brand-800'),
                    900: token('brand-900'),
                },
                accent: token('accent'),
                'accent-hover': token('accent-hover'),

                // Surfaces, layered from deepest to raised.
                canvas: token('canvas'),
                surface: token('surface'),
                elevated: token('elevated'),
                subtle: token('subtle'),
                hover: token('hover'),
                active: token('active'),
                backdrop: token('backdrop'),

                line: token('line'),
                'line-strong': token('line-strong'),

                ink: {
                    DEFAULT: token('ink'),
                    soft: token('ink-soft'),
                    muted: token('ink-muted'),
                    faint: token('ink-faint'),
                },

                danger: token('danger'),

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

                // Repointed to semantic ramps so existing classes are theme-aware.
                gray: {
                    50: token('gray-50'),
                    100: token('gray-100'),
                    200: token('gray-200'),
                    300: token('gray-300'),
                    400: token('gray-400'),
                    500: token('gray-500'),
                    600: token('gray-600'),
                    700: token('gray-700'),
                    800: token('gray-800'),
                    900: token('gray-900'),
                },
                green: {
                    50: token('green-50'),
                    100: token('green-100'),
                    200: token('green-200'),
                    500: token('green-500'),
                    600: token('green-600'),
                    700: token('green-700'),
                },
                red: {
                    50: token('red-50'),
                    100: token('red-100'),
                    200: token('red-200'),
                    500: token('red-500'),
                    600: token('red-600'),
                    700: token('red-700'),
                },
                amber: {
                    50: token('amber-50'),
                    100: token('amber-100'),
                    200: token('amber-200'),
                    500: token('amber-500'),
                    600: token('amber-600'),
                    700: token('amber-700'),
                    800: token('amber-800'),
                },
                sky: {
                    100: token('sky-100'),
                    500: token('sky-500'),
                    600: token('sky-600'),
                    700: token('sky-700'),
                },
            },
            boxShadow: {
                card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
                pop: '0 12px 32px -8px rgb(15 23 42 / 0.28), 0 2px 6px -2px rgb(15 23 42 / 0.12)',
                none: 'none',
            },
            fontFamily: {
                // No webfont download: the platform must render identically offline.
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
            },
            borderRadius: { xl: '0.75rem', '2xl': '1rem' },
            ringColor: { DEFAULT: token('accent') },
        },
    },
    plugins: [],
};

export default config;
