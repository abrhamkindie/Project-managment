'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useCreateOrganization } from '~/lib/hooks';
import { workspacePath } from '~/lib/paths';
import { Button, ErrorNote, Field, Input } from './ui';

/**
 * Create-workspace form, shared by onboarding and the switcher menu: a name is all the API
 * needs, and the response is the new workspace, so the caller only decides whether to navigate.
 */
export function CreateWorkspaceForm({ label = 'Create workspace', onDone }: { label?: string; onDone?: (slug: string) => void }) {
    const router = useRouter();
    const [name, setName] = useState('');
    const create = useCreateOrganization();
    const trimmed = name.trim();

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (trimmed.length < 2) return;
        create.mutate(trimmed, {
            onSuccess: (organization) => {
                if (onDone) onDone(organization.slug);
                else router.replace(workspacePath(organization.slug, 'projects'));
            },
        });
    };

    return (
        <form onSubmit={submit} className="space-y-3">
            <Field label="Workspace name" required hint="Two characters or more. You can rename it later.">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Inc." maxLength={80} autoFocus />
            </Field>
            <ErrorNote error={create.error} />
            <Button type="submit" variant="primary" loading={create.isPending} disabled={trimmed.length < 2}>
                {label}
            </Button>
        </form>
    );
}
