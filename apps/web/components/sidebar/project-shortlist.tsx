'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { FolderOpen, Pin, Search } from 'lucide-react';
import { useDebounced, useProjects } from '~/lib/hooks';
import { projectPath, projectsPath } from '~/lib/paths';
import type { ProjectSummary } from '~/lib/types';
import { useProjectPins } from './use-project-pins';

/**
 * Pinnable project shortlist for the sidebar.
 *
 * Pins sort ahead of everything else (client-side only for now — see use-project-pins),
 * the inline filter narrows the fetched list without leaving the rail, and each row keeps
 * the project color dot so the palette stays recognisable at a glance.
 */
export function ProjectShortlist({
    slug,
    orgId,
    activePathname,
}: {
    slug: string;
    orgId: string;
    activePathname: string;
}) {
    const [term, setTerm] = useState('');
    const debouncedTerm = useDebounced(term, 200);
    const projects = useProjects(orgId, {
        status: 'active',
        pageSize: 30,
        search: debouncedTerm.trim() || undefined,
    });
    const pins = useProjectPins(orgId);

    const items = useMemo(() => {
        const rows = [...(projects.data?.items ?? [])];
        return rows.sort((a, b) => {
            const pinDiff = Number(pins.isPinned(b.id)) - Number(pins.isPinned(a.id));
            return pinDiff || a.name.localeCompare(b.name);
        });
    }, [projects.data, pins]);

    return (
        <div className="space-y-0.5">
            <div className="flex items-center justify-between px-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Projects</p>
            </div>

            <label className="mx-1 mb-1 flex items-center gap-1.5 rounded-[3px] border border-line bg-canvas px-2 py-1 focus-within:border-brand-400">
                <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <input
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Filter projects…"
                    aria-label="Filter projects"
                    className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
                />
            </label>

            {projects.isPending ? (
                <>
                    <div className="skeleton h-7" />
                    <div className="skeleton h-7" />
                </>
            ) : (
                items.map((project) => (
                    <ProjectRow
                        key={project.id}
                        project={project}
                        slug={slug}
                        active={activePathname.startsWith(projectPath(slug, project.id))}
                        pinned={pins.isPinned(project.id)}
                        onTogglePin={() => pins.toggle(project.id)}
                    />
                ))
            )}

            {!projects.isPending && items.length === 0 ? (
                <p className="px-2 py-1 text-xs text-ink-faint">
                    {term.trim() ? 'No matching projects.' : 'No projects yet.'}
                </p>
            ) : null}

            <Link href={projectsPath(slug)} className="nav-item text-ink-muted">
                <FolderOpen className="h-4 w-4 shrink-0" />
                View all projects
            </Link>
        </div>
    );
}

function ProjectRow({
    project,
    slug,
    active,
    pinned,
    onTogglePin,
}: {
    project: ProjectSummary;
    slug: string;
    active: boolean;
    pinned: boolean;
    onTogglePin: () => void;
}) {
    return (
        <div className={clsx('group/nav-item flex items-center', active && 'bg-hover')}>
            <Link
                href={projectPath(slug, project.id)}
                className={clsx('nav-item min-w-0 flex-1', active && 'nav-item-active')}
            >
                <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                    aria-hidden
                />
                <span className="truncate">{project.name}</span>
            </Link>
            <button
                type="button"
                onClick={onTogglePin}
                aria-label={pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                title={pinned ? 'Unpin project' : 'Pin to sidebar'}
                className={clsx(
                    'mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] transition',
                    pinned
                        ? 'text-brand-600'
                        : 'text-ink-faint opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover/nav-item:opacity-100',
                )}
            >
                <Pin className={clsx('h-3.5 w-3.5', pinned && 'fill-current')} />
            </button>
        </div>
    );
}
