'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { PROJECT_COLORS } from '~/lib/format';
import { useCreateProject, usePeople } from '~/lib/hooks';
import { projectPath } from '~/lib/paths';
import type { ProjectVisibility } from '~/lib/types';
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from './ui';
import { UserPicker } from './user-picker';

/**
 * Project creation.
 *
 * Only the fields an MVP needs are here; the project settings screen edits the rest later.
 * The response is the new project, so the modal can navigate straight to its board rather than
 * waiting for the list to refetch.
 */
export function CreateProjectModal({ orgId, slug, onClose }: { orgId: string; slug: string; onClose: () => void }) {
    const router = useRouter();
    const people = usePeople(orgId);
    const create = useCreateProject(orgId);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState(PROJECT_COLORS[0] ?? '#6366f1');
    const [visibility, setVisibility] = useState<ProjectVisibility>('organization');
    const [memberIds, setMemberIds] = useState<string[]>([]);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (name.trim().length < 2) return;
        create.mutate(
            {
                name: name.trim(),
                description: description.trim() || null,
                color,
                visibility,
                memberIds,
            },
            {
                onSuccess: (project) => {
                    onClose();
                    router.push(projectPath(slug, project.id));
                },
            },
        );
    };

    return (
        <Modal
            title="New project"
            description="Projects hold the tasks your team works through, together with the people responsible for them."
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" form="create-project" loading={create.isPending} disabled={name.trim().length < 2}>
                        Create project
                    </Button>
                </>
            }
        >
            <form id="create-project" onSubmit={submit} className="space-y-4">
                <Field label="Name" required error={name.length > 0 && name.trim().length < 2 ? 'At least 2 characters' : undefined}>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Website redesign" maxLength={100} autoFocus />
                </Field>

                <Field label="Description" hint="Optional. What is the outcome of this project?">
                    <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Color">
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            {PROJECT_COLORS.map((candidate) => (
                                <button
                                    key={candidate}
                                    type="button"
                                    aria-label={`Use ${candidate}`}
                                    aria-pressed={candidate === color}
                                    onClick={() => setColor(candidate)}
                                    style={{ backgroundColor: candidate }}
                                    className={clsx('h-6 w-6 rounded-full transition', candidate === color ? 'ring-2 ring-ink ring-offset-2' : 'hover:scale-110')}
                                />
                            ))}
                        </div>
                    </Field>

                    <Field label="Visibility" hint="Private projects are visible to their members only.">
                        <Select value={visibility} onChange={(event) => setVisibility(event.target.value as ProjectVisibility)}>
                            <option value="organization">Whole workspace</option>
                            <option value="private">Members only</option>
                        </Select>
                    </Field>
                </div>

                {people.isPending ? (
                    <Spinner label="Loading people…" />
                ) : (
                    <UserPicker
                        label="Members"
                        users={people.people}
                        value={memberIds}
                        onChange={setMemberIds}
                        emptyHint="Invite teammates first — projects need people."
                    />
                )}
            </form>
        </Modal>
    );
}
