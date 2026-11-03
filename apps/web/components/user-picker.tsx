'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fullName } from '~/lib/format';
import type { LightUser } from '~/lib/types';
import { Avatar } from './ui';

/**
 * Multi-select over the people of a workspace.
 *
 * One component because the same choice appears in four places (project members, task
 * assignees, teams, invitations) and each of them needs search plus a visible selection.
 */
export function UserPicker({
    users,
    value,
    onChange,
    label,
    emptyHint = 'Nobody to pick from yet.',
}: {
    users: LightUser[];
    value: string[];
    onChange: (next: string[]) => void;
    label?: string;
    emptyHint?: string;
}) {
    const [term, setTerm] = useState('');
    const selected = new Set(value);

    const visible = useMemo(() => {
        const needle = term.trim().toLowerCase();
        if (!needle) return users;
        return users.filter((user) => fullName(user).toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle));
    }, [users, term]);

    const toggle = (userId: string) => {
        onChange(selected.has(userId) ? value.filter((candidate) => candidate !== userId) : [...value, userId]);
    };

    return (
        <div className="space-y-1.5">
            {label ? <span className="label">{label}</span> : null}
            {value.length > 0 ? (
                <ul className="flex flex-wrap gap-1">
                    {value.map((userId) => {
                        const user = users.find((candidate) => candidate.id === userId);
                        if (!user) return null;
                        return (
                            <li key={userId}>
                                <button type="button" onClick={() => toggle(userId)} className="chip bg-brand-50 text-brand-700 hover:bg-brand-100" aria-label={`Remove ${fullName(user)}`}>
                                    <Avatar user={user} size="xs" />
                                    {fullName(user)}
                                    <span aria-hidden>×</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input className="field pl-8" placeholder="Search people" value={term} onChange={(event) => setTerm(event.target.value)} aria-label={label ?? 'Search people'} />
            </div>

            <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
                {visible.length === 0 ? <li className="px-2 py-3 text-sm text-ink-muted">{emptyHint}</li> : null}
                {visible.map((user) => (
                    <li key={user.id}>
                        <label className="nav-item cursor-pointer gap-2">
                            <input type="checkbox" className="checkbox" checked={selected.has(user.id)} onChange={() => toggle(user.id)} />
                            <Avatar user={user} size="sm" />
                            <span className="min-w-0 flex-1 truncate">
                                {fullName(user)}
                                <span className="ml-1.5 text-xs text-ink-faint">{user.email}</span>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
        </div>
    );
}
