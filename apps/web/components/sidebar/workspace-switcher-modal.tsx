'use client';

import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { Modal } from '../ui';
import { workspacePath } from '~/lib/paths';
import type { OrganizationSummary, Session } from '~/lib/types';

/**
 * Workspace switcher — every membership the session knows about, current one ticked,
 * plus the entry point to create another. Opened from the sidebar header (and the
 * mobile drawer), which is why it lives with the sidebar module.
 */
export function WorkspaceSwitcherModal({
    session,
    currentOrgId,
    onClose,
    onCreateWorkspace,
}: {
    session: Session;
    currentOrgId: string;
    onClose: () => void;
    onCreateWorkspace: () => void;
}) {
    const router = useRouter();

    return (
        <Modal title="Switch workspace" onClose={onClose}>
            <ul className="space-y-1">
                {session.organizations.map((candidate: OrganizationSummary) => (
                    <li key={candidate.id}>
                        <button
                            type="button"
                            className="nav-item w-full justify-between"
                            onClick={() => {
                                onClose();
                                router.push(workspacePath(candidate.slug, 'dashboard'));
                            }}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-accent text-[11px] font-bold text-[rgb(var(--on-accent))]">
                                    {candidate.name.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="truncate">{candidate.name}</span>
                            </span>
                            <span className="flex items-center gap-2 text-xs text-ink-muted">
                                {candidate.role}
                                {candidate.id === currentOrgId ? <Check className="h-4 w-4 text-brand-600" /> : null}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
            <div className="mt-4 border-t border-line pt-4">
                <button
                    type="button"
                    className="nav-item w-full"
                    onClick={() => {
                        onClose();
                        onCreateWorkspace();
                    }}
                >
                    <Plus className="h-4 w-4 shrink-0" />
                    Create workspace
                </button>
            </div>
        </Modal>
    );
}
