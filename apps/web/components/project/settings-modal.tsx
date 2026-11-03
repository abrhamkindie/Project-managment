'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';
import { PROJECT_COLORS, fromDateInput, toDateInput } from '~/lib/format';
import { useDeleteProject, useSetProjectStatus, useUpdateProject } from '~/lib/hooks';
import { projectsPath } from '~/lib/paths';
import type { ProjectDetailDto, ProjectVisibility } from '~/lib/types';
import { Button, Field, Input, Modal, Select, Textarea } from '../ui';

/**
 * Project settings.
 *
 * Archiving and deleting are here too, because they belong next to the fields that change a
 * project's meaning, and both are reversible only up to a point: archive keeps the work, delete
 * discards it, so each needs its own confirmation.
 */
export function ProjectSettingsModal({
    project,
    orgId,
    slug,
    onClose,
}: {
    project: ProjectDetailDto;
    orgId: string;
    slug: string;
    onClose: () => void;
}) {
    const router = useRouter();
    const update = useUpdateProject(project.id);
    const setStatus = useSetProjectStatus(orgId);
    const remove = useDeleteProject(orgId);

    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description ?? '');
    const [color, setColor] = useState(project.color);
    const [visibility, setVisibility] = useState<ProjectVisibility>(project.visibility);
    const [startDate, setStartDate] = useState(toDateInput(project.startDate));
    const [dueDate, setDueDate] = useState(toDateInput(project.dueDate));
    const [confirmDelete, setConfirmDelete] = useState(false);

    const dirty =
        name.trim() !== project.name ||
        description.trim() !== (project.description ?? '') ||
        color !== project.color ||
        visibility !== project.visibility ||
        startDate !== toDateInput(project.startDate) ||
        dueDate !== toDateInput(project.dueDate);

    const save = () => {
        if (name.trim().length < 2) return;
        update.mutate(
            {
                name: name.trim(),
                description: description.trim() || null,
                color,
                visibility,
                startDate: fromDateInput(startDate),
                dueDate: fromDateInput(dueDate),
            },
            { onSuccess: onClose },
        );
    };

    return (
        <Modal
            title="Project settings"
            description={project.name}
            onClose={onClose}
            footer={
                <>
                    {project.status === 'active' ? (
                        <Button variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate({ projectId: project.id, status: 'archived' })}>
                            Archive
                        </Button>
                    ) : (
                        <Button variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate({ projectId: project.id, status: 'active' })}>
                            Restore
                        </Button>
                    )}
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={update.isPending} disabled={!dirty || name.trim().length < 2} onClick={save}>
                        Save changes
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label="Name" required error={name.length > 0 && name.trim().length < 2 ? 'At least 2 characters' : undefined}>
                    <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
                </Field>

                <Field label="Description">
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

                    <Field label="Start date">
                        <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                    </Field>

                    <Field label="Due date">
                        <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                    </Field>
                </div>

                <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
                    <p className="text-xs text-ink-muted">
                        Deleting removes every task, comment and attachment in this project. Archived projects keep their data and disappear from the active list.
                    </p>
                    {confirmDelete ? (
                        <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                                Keep
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                loading={remove.isPending}
                                onClick={() => remove.mutate(project.id, { onSuccess: () => router.push(projectsPath(slug)) })}
                            >
                                Delete forever
                            </Button>
                        </div>
                    ) : (
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                            Delete project
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
