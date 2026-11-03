'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FolderOpen, Plus, Search } from 'lucide-react';
import { formatDate } from '~/lib/format';
import { useDebounced, useProjects } from '~/lib/hooks';
import { projectPath } from '~/lib/paths';
import { canCreateProject } from '~/lib/roles';
import type { OrgRole, ProjectListQuery, ProjectStatus } from '~/lib/types';
import { CreateProjectModal } from './create-project-modal';
import { Page, PageHeader } from './page-shell';
import { AvatarStack, Badge, Button, EmptyState, ErrorNote, Input, Skeleton, Tabs } from './ui';

/**
 * The project list.
 *
 * Filters live in the query rather than in a store: `status` and `search` become part of the
 * React Query key, so switching tabs restores instantly on return and the URL stays shareable.
 */
export function ProjectsView({ orgId, slug, role }: { orgId: string; slug: string; role?: OrgRole }) {
    const [status, setStatus] = useState<ProjectStatus>('active');
    const [term, setTerm] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);

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
                        <li key={project.id}>
                            <Link href={projectPath(slug, project.id)} className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand-200 hover:shadow-pop">
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
        </Page>
    );
}
