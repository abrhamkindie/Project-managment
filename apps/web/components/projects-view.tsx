'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Archive, ArchiveRestore, FolderOpen, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { formatDate } from '~/lib/format';
import { useDebounced, useDeleteProject, useProjects, useSetProjectStatus } from '~/lib/hooks';
import { projectPath } from '~/lib/paths';
import { canCreateProject } from '~/lib/roles';
import type { OrgRole, ProjectListQuery, ProjectStatus, ProjectSummary } from '~/lib/types';
import { CreateProjectModal } from './create-project-modal';
import { Page, PageHeader } from './page-shell';
import { AvatarStack, Badge, Button, EmptyState, ErrorNote, Input, Menu, MenuItem, Modal, Skeleton, Tabs } from './ui';

/**
 * The project list.
 *
 * Filters live in the query rather than in a store: `status` and `search` become part of the
 * React Query key, so switching tabs restores instantly on return and the URL stays shareable.
 *
 * Each card also carries a ⋯ menu (Archive / Restore / Delete). The API ships `canEdit` /
 * `canDelete` with every row, so the menu only offers actions this viewer is actually allowed to
 * take — no 403-on-click.
 */
export function ProjectsView({ orgId, slug, role }: { orgId: string; slug: string; role?: OrgRole }) {
    const [status, setStatus] = useState<ProjectStatus>('active');
    const [term, setTerm] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const [confirming, setConfirming] = useState<ProjectSummary | null>(null);

    const search = useDebounced(term.trim() || undefined);
    const query: ProjectListQuery = { status, search, page, pageSize: 24 };
    const projects = useProjects(orgId, query);

    const items = projects.data?.items ?? [];
    const pages = projects.data?.pages ?? 1;

    return (
        <Page>
            <PageHeader
                title="Projects"
                description="Every project you can see in this workspace."
                actions={
                    canCreateProject(role) ? (
                        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                            New project
                        </Button>
                    ) : null
                }
            />

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Tabs
                    value={status}
                    onChange={(next) => {
                        setStatus(next);
                        setPage(1);
                    }}
                    options={[
                        { value: 'active', label: 'Active' },
                        { value: 'archived', label: 'Archived' },
                    ]}
                />
                <div className="relative ml-auto w-full max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                    <Input
                        className="pl-8"
                        placeholder="Search projects"
                        value={term}
                        onChange={(event) => {
                            setTerm(event.target.value);
                            setPage(1);
                        }}
                        aria-label="Search projects"
                    />
                </div>
            </div>

            {projects.isError ? <ErrorNote error={projects.error} /> : null}

            {projects.isPending ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((key) => (
                        <Skeleton key={key} className="h-32" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <EmptyState
                    icon={<FolderOpen className="h-7 w-7" />}
                    title={term ? `No projects match “${term}”` : status === 'active' ? 'No active projects' : 'Nothing archived'}
                    description={
                        term
                            ? 'Try a different word, or clear the search.'
                            : status === 'active'
                                ? canCreateProject(role)
                                    ? 'Create the first one and invite your team to it.'
                                    : 'A workspace manager has not created a project yet.'
                                : 'Archived projects keep their history and can be restored.'
                    }
                    action={
                        term ? (
                            <Button
                                onClick={() => {
                                    setTerm('');
                                }}
                            >
                                Clear search
                            </Button>
                        ) : null
                    }
                />
            ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((project) => (
                        <li key={project.id} className="relative">
                            <Link
                                href={projectPath(slug, project.id)}
                                className="card flex h-full flex-col gap-2 p-4 pr-12 transition hover:border-brand-200 hover:shadow-pop"
                            >
                                <span className="flex items-start gap-2">
                                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-ink">{project.name}</span>
                                        {project.description ? <span className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{project.description}</span> : null}
                                    </span>
                                </span>

                                <span className="mt-auto flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                                    <Badge tone="neutral">{project.taskCount} {project.taskCount === 1 ? 'task' : 'tasks'}</Badge>
                                    {project.visibility === 'private' ? <Badge tone="brand">Private</Badge> : null}
                                    {project.status === 'archived' ? <Badge tone="warning">Archived</Badge> : null}
                                    {project.dueDate ? <span>due {formatDate(project.dueDate)}</span> : null}
                                    <span className="ml-auto">
                                        <AvatarStack users={project.members} max={4} />
                                    </span>
                                </span>
                            </Link>

                            <ProjectCardMenu
                                project={project}
                                onDeleteRequest={() => setConfirming(project)}
                            />
                        </li>
                    ))}
                </ul>
            )}

            {pages > 1 ? (
                <div className="mt-5 flex items-center justify-center gap-3 text-sm text-ink-muted">
                    <Button size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                        Previous
                    </Button>
                    <span>
                        Page {page} of {pages}
                    </span>
                    <Button size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
                        Next
                    </Button>
                </div>
            ) : null}

            {creating ? <CreateProjectModal orgId={orgId} slug={slug} onClose={() => setCreating(false)} /> : null}

            {confirming ? (
                <DeleteProjectConfirm
                    project={confirming}
                    orgId={orgId}
                    onClose={() => setConfirming(null)}
                />
            ) : null}
        </Page>
    );
}

/**
 * The ⋯ affordance on each card. Rendered as a sibling of the `<Link>` (not inside it) and
 * absolutely positioned on top, so opening this menu never navigates.
 */
function ProjectCardMenu({ project, onDeleteRequest }: { project: ProjectSummary; onDeleteRequest: () => void }) {
    const setStatus = useSetProjectStatus(project.orgId);
    const canEdit = project.canEdit ?? false;
    const canDelete = project.canDelete ?? false;
    if (!canEdit && !canDelete) return null;

    const isArchived = project.status === 'archived';

    return (
        <div className="absolute right-2 top-2 z-10">
            <Menu
                align="right"
                trigger={(open) => (
                    <button
                        type="button"
                        aria-label={`Actions for ${project.name}`}
                        className={
                            'btn btn-ghost btn-icon h-7 w-7 border border-transparent hover:border-line hover:bg-surface ' +
                            (open ? 'border-line bg-surface text-ink' : 'text-ink-faint hover:text-ink')
                        }
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </button>
                )}
            >
                {canEdit ? (
                    <MenuItem
                        icon={isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                        disabled={setStatus.isPending}
                        onSelect={() => setStatus.mutate({ projectId: project.id, status: isArchived ? 'active' : 'archived' })}
                    >
                        {isArchived ? 'Restore project' : 'Archive project'}
                    </MenuItem>
                ) : null}
                {canDelete ? (
                    <MenuItem icon={<Trash2 className="h-4 w-4" />} tone="danger" onSelect={onDeleteRequest}>
                        Delete project…
                    </MenuItem>
                ) : null}
            </Menu>
        </div>
    );
}

/**
 * Small modal that gates the destructive action behind an explicit name retype — the same
 * safety the settings drawer uses, but reachable from the list without opening the project first.
 */
function DeleteProjectConfirm({ project, orgId, onClose }: { project: ProjectSummary; orgId: string; onClose: () => void }) {
    const remove = useDeleteProject(orgId);
    const [typed, setTyped] = useState('');
    const ready = typed.trim() === project.name;

    return (
        <Modal title="Delete project" description={project.name} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-ink-muted">
                    This removes <span className="font-medium text-ink">{project.name}</span> along with every task, comment and
                    attachment inside it. It cannot be undone. If you only want to get it out of the way, archive it instead.
                </p>
                <label className="block text-sm">
                    <span className="mb-1 block text-ink-soft">Type the project name to confirm</span>
                    <Input
                        autoFocus
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        placeholder={project.name}
                        aria-label="Confirm project name"
                    />
                </label>
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="danger"
                        disabled={!ready}
                        loading={remove.isPending}
                        onClick={() => remove.mutate(project.id, { onSuccess: onClose })}
                    >
                        Delete forever
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
