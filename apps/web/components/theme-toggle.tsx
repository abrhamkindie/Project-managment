'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { useTheme, type Theme } from '~/lib/theme';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * A compact three-way theme switch (light / system / dark). Rendered once in the workspace header
 * and once on the settings screen; `variant="bar"` is the tight header pill, `variant="row"` is the
 * wider segmented control used in settings.
 */
export function ThemeToggle({ variant = 'bar' }: { variant?: 'bar' | 'row' }) {
    const { theme, setTheme } = useTheme();
    return (
        <div
            role="radiogroup"
            aria-label="Theme"
            className={clsx(
                'inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5',
                variant === 'row' && 'w-full',
            )}
        >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    title={label}
                    onClick={() => setTheme(value)}
                    className={clsx(
                        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition',
                        variant === 'row' && 'flex-1',
                        theme === value ? 'bg-active text-brand-700 shadow-sm' : 'text-ink-muted hover:bg-hover hover:text-ink',
                    )}
                >
                    <Icon className="h-3.5 w-3.5" />
                    {variant === 'row' ? label : null}
                </button>
            ))}
        </div>
    );
}
