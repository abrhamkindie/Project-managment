'use client';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { avatarTint, initials } from '~/lib/format';

/**
 * The control set every screen is built from.
 *
 * Shared rather than ad-hoc because the same affordances recur constantly (a task editor,
 * a filter bar, a confirm dialog) and because focus management and keyboard dismissal are
 * easy to get subtly wrong one component at a time.
 */

export function Spinner({ label, className }: { label?: string; className?: string }) {
    return (
        <span role="status" className={clsx('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand-500" aria-hidden />
            {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
        </span>
    );
}

export function Button({
    variant = 'secondary',
    size,
    icon,
    loading,
    className,
    children,
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm';
    icon?: ReactNode;
    loading?: boolean;
}) {
    return (
        <button
            type={rest.type ?? 'button'}
            disabled={rest.disabled || loading}
            className={clsx(
                `btn btn-${variant}`,
                size === 'sm' && 'btn-sm',
                !children && 'btn-icon',
                className,
            )}
            {...rest}
        >
            {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : icon}
            {children}
        </button>
    );
}

export function Field({
    label,
    hint,
    error,
    required,
    children,
}: {
    label?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    children: ReactNode;
}) {
    // Wrapping the control in the label gives an implicit association, so callers never have
    // to thread ids through. Errors are announced because a failing save must not be silent.
    return (
        <label className="block">
            {label ? (
                <span className="label">
                    {label}
                    {required ? <span className="ml-0.5 text-danger">*</span> : null}
                </span>
            ) : null}
            {children}
            {error ? (
                <span className="mt-1 block text-xs text-danger" role="alert">
                    {error}
                </span>
            ) : hint ? (
                <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
            ) : null}
        </label>
    );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
    return <input {...rest} className={clsx('field', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return <textarea {...rest} className={clsx('field min-h-[80px] resize-y', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select {...rest} className={clsx('field appearance-none bg-surface pr-8', className)}>
            {children}
        </select>
    );
}

export function Badge({
    tone = 'neutral',
    className,
    children,
}: {
    tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
    className?: string;
    children: ReactNode;
}) {
    const tones = {
        neutral: 'bg-subtle text-ink-soft border-line',
        brand: 'bg-brand-50 text-brand-700 border-brand-100',
        success: 'bg-green-50 text-green-700 border-green-200',
        warning: 'bg-amber-50 text-amber-700 border-amber-200',
        danger: 'bg-red-50 text-red-700 border-red-200',
    } as const;
    return <span className={clsx('chip', tones[tone], className)}>{children}</span>;
}

export function Avatar({
    user,
    size = 'md',
    className,
}: {
    user: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
}) {
    const dimensions = { xs: 'h-5 w-5 text-[10px]', sm: 'h-6 w-6 text-[11px]', md: 'h-8 w-8 text-xs', lg: 'h-12 w-12 text-sm' }[size];
    const name = user ? `${user.firstName} ${user.lastName}` : 'Unassigned';
    if (!user) {
        return (
            <span
                title="Unassigned"
                className={clsx('inline-flex items-center justify-center rounded-full border border-dashed border-line bg-surface text-ink-faint', dimensions)}
            >
                ?
            </span>
        );
    }
    return user.avatarUrl ? (
        <img src={user.avatarUrl} alt={name} title={name} className={clsx('rounded-full object-cover', dimensions, className)} />
    ) : (
        <span
            title={name}
            className={clsx('inline-flex items-center justify-center rounded-full font-semibold', dimensions, avatarTint(user.id), className)}
        >
            {initials(user.firstName, user.lastName)}
        </span>
    );
}

/** Overlapping strip of assignees, as on an Asana row. */
export function AvatarStack({ users, max = 3 }: { users: { id: string; firstName: string; lastName: string; avatarUrl?: string | null }[]; max?: number }) {
    const shown = users.slice(0, max);
    const extra = users.length - shown.length;
    if (users.length === 0) return null;
    return (
        <span className="flex items-center -space-x-1.5">
            {shown.map((user) => (
                <span key={user.id} className="ring-2 ring-surface rounded-full">
                    <Avatar user={user} size="sm" />
                </span>
            ))}
            {extra > 0 ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-[11px] font-medium text-ink-muted ring-2 ring-surface">
                    +{extra}
                </span>
            ) : null}
        </span>
    );
}

export function ProgressBar({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'success' | 'warning' }) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    const bar = { brand: 'bg-brand-500', success: 'bg-state-done', warning: 'bg-amber-500' }[tone];
    return (
        <span
            className={clsx('block h-1.5 w-full overflow-hidden rounded-full bg-subtle', className)}
            role="progressbar"
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <span className={clsx('block h-full rounded-full transition-all', bar)} style={{ width: `${clamped}%` }} />
        </span>
    );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
            {icon ? <div className="text-ink-faint">{icon}</div> : null}
            <p className="text-sm font-medium text-ink">{title}</p>
            {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
}

export function ErrorNote({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
    if (!error) return null;
    // Callers pass an Error, an ApiError or a plain sentence; all three must be readable.
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong';
    return (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{message}</span>
            {onDismiss ? <button type="button" onClick={onDismiss} className="shrink-0 text-red-500 hover:text-red-700" aria-label="Dismiss"><X className="h-4 w-4" /></button> : null}
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div className={clsx('skeleton', className)} aria-hidden />;
}

/**
 * Modal dialog: focus trapped, `Escape` closes, backdrop click closes.
 * `title` is required because it becomes the accessible name of the dialog.
 */
export function Modal({
    title,
    description,
    onClose,
    children,
    footer,
    width = 'max-w-lg',
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    width?: string;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const heading = useId();

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        // Move focus into the dialog so keyboard users do not start from the page behind it.
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previous?.focus?.();
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-backdrop/50 px-4 py-16 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={heading}
                tabIndex={-1}
                className={clsx('card animate-fade-in w-full bg-elevated outline-none shadow-pop', width)}
            >
                <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                    <div>
                        <h2 id={heading} className="text-base font-semibold text-ink">
                            {title}
                        </h2>
                        {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
                    </div>
                    <Button variant="ghost" onClick={onClose} aria-label="Close">
                        <X className="h-4 w-4" />
                    </Button>
                </header>
                <div className="px-5 py-4">{children}</div>
                {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
            </div>
        </div>
    );
}

/** Small left-aligned menu used for row actions and the account switcher. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: boolean) => ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!container.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div ref={container} className="relative">
            <div onClick={() => setOpen((value) => !value)}>{trigger(open)}</div>
            {open ? (
                <div
                    role="menu"
                    className={clsx('card absolute z-40 mt-1 min-w-[190px] animate-fade-in bg-elevated p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}
                    onClick={() => setOpen(false)}
                >
                    {children}
                </div>
            ) : null}
        </div>
    );
}

export function MenuItem({
    children,
    onSelect,
    tone = 'default',
    disabled,
    icon,
}: {
    children: ReactNode;
    onSelect: () => void;
    tone?: 'default' | 'danger';
    disabled?: boolean;
    icon?: ReactNode;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={onSelect}
            className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition disabled:opacity-50',
                tone === 'danger' ? 'text-danger hover:bg-red-50' : 'text-ink-soft hover:bg-hover',
            )}
        >
            {icon}
            {children}
        </button>
    );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (next: T) => void; options: { value: T; label: string; count?: number }[] }) {
    return (
        <div role="tablist" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-sm">
            {options.map((option) => (
                <button
                    key={option.value}
                    role="tab"
                    type="button"
                    aria-selected={option.value === value}
                    onClick={() => onChange(option.value)}
                    className={clsx(
                        'rounded-md px-3 py-1 text-sm transition',
                        option.value === value ? 'bg-active font-medium text-brand-700' : 'text-ink-muted hover:bg-hover hover:text-ink',
                    )}
                >
                    {option.label}
                    {option.count !== undefined ? <span className="ml-1.5 text-xs text-ink-faint">{option.count}</span> : null}
                </button>
            ))}
        </div>
    );
}
