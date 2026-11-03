'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, ChevronLeft, Filter, Search, Settings2, Users } from 'lucide-react';
import clsx from 'clsx';
import { projectsPath } from '~/lib/paths';
import { useLabels, useBoard, useProject, useSetProjectStatus } from '~/lib/hooks';
import type { BoardDto, TaskCardDto } from '~/lib/types';
import { AvatarStack, Button, ErrorNote, ProgressBar, Select, Skeleton, Tabs } from '../ui';
import { Board } from './board';
import { TaskDrawer } from './drawer';
import { TaskList } from './task-list';
import { ProjectSettingsModal } from './settings-modal';
import { ProjectMembersModal } from './members-modal';

type View = 'board' | 'list';

/**
 * A project: its board, its list, its filters and the drawer on top of whichever view is open.
 *
 * The open task lives in the URL (`?task=<id>`) rather than in a nested route, so the board keeps
 * its scroll position and its drag state while a card is being edited, and the browser's Back
 * button closes the drawer instead of leaving the project.
 */
export function ProjectWorkspace({
    orgId,
    slug,
    projectId,
    viewerId,
    initialTaskId,
}: {
    orgId: string;
    slug: string;
    projectId: string;
    viewerId: string;
    initialTaskId: string | null;
}) {
    const project = useProject(projectId);
    const board = useBoard(projectId);
    const labels = useLabels(orgId);
    const setStatus = useSetProjectStatus(orgId);

    const [view, setView] = useState<View>('board');
    const [term, setTerm] = useState('');
    const [mineOnly, setMineOnly] = useState(false);
    const [labelId, setLabelId] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [modal, setModal] = useState<'settings' | 'members' | null>(null);
    const [taskId, setTaskId] = useState<string | null>(initialTaskId);

    // A project created without columns is really a list; start it there.
    useEffect(() => {
        if (board.data && board.data.sections.length === 0) setView('list');
    }, [board.data]);

    /** Push a drawer change into history without a router navigation, so the board never remounts. */
    const open = useCallback(
        (id: string) => {
            setTaskId(id);
            window.history.pushState({ task: id }, '', `?task=${id}`);
        },
        [],
    );

    const close = useCallback(() => {
        setTaskId(null);
        window.history.pushState({}, '', window.location.pathname);
    }, []);

    useEffect(() => {
        const onPopState = () => setTaskId(new URLSearchParams(window.location.search).get('task'));
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // A fresh server render (a reload, or a real navigation) is authoritative over local state.
    useEffect(() => setTaskId(initialTaskId), [initialTaskId]);

    const filtered = useMemo(
        () => (board.data ? filterBoard(board.data, { term, assigneeId: mineOnly ? viewerId : null, labelId }) : null),
        [board.data, term, mineOnly, labelId, viewerId],
    );

    const detail = project.data;
    const canEdit = detail?.canEdit ?? false;

    if (project.isError || board.isError) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <ErrorNote error={project.error ?? board.error} />
                <p className="mt-3 text-sm text-ink-muted">
                    You may have lost access to this project, or it was deleted.{' '}
                    <Link href={projectsPath(slug)} className="link">
                        Back to projects
                    </Link>
                </p>
            </div>
        );
    }

    if (!detail || !filtered) {
        return (
            <div className="space-y-4 p-4">
                <Skeleton className="h-8 w-64" />
                <div className="flex gap-3">
                    {[0, 1, 2, 3].map((column) => (
                        <Skeleton key={column} className="h-[60vh] w-[290px] shrink-0" />
                    ))}
                </div>
            </div>
        );
    }

    const filtering = term.trim().length > 0 || mineOnly || labelId !== '';

    return (
        // The shell header is `h-14`, so this is exactly the room left for a board that scrolls itself.
        <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
            <header className="border-b border-line bg-surface px-4 pb-3 pt-4 sm:px-5">
                <Link href={projectsPath(slug)} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Projects
                </Link>

                <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: detail.color }} aria-hidden />
                            <span className="min-w-0 truncate">{detail.name}</span>
                            {detail.visibility === 'private' ? <span className="chip text-xs">Private</span> : null}
                        </h1>
                        {detail.description ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{detail.description}</p> : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" variant="ghost" icon={<Users className="h-4 w-4" />} onClick={() => setModal('members')}>
                            <span className="hidden sm:inline">Members</span>
                        </Button>
                        {canEdit ? (
                            <Button size="sm" variant="ghost" icon={<Settings2 className="h-4 w-4" />} onClick={() => setModal('settings')}>
                                <span className="hidden sm:inline">Settings</span>
                            </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((value) => !value)}>
                            Filter
                        </Button>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Tabs<View>
                        value={view}
                        onChange={setView}
                        options={[
                            { value: 'board', label: 'Board' },
                            { value: 'list', label: 'List' },
                        ]}
                    />

                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                        <AvatarStack users={detail.members} max={4} />
                        {detail.completedTasks}/{detail.taskCount} done
                    </span>

                    <ProgressBar value={detail.progress} className="w-32" tone={detail.progress > 60 ? 'success' : 'brand'} />
                </div>

                {showFilters || filtering ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-canvas p-2">
                        <div className="relative min-w-[180px] flex-1">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                            <input
                                className="field pl-8"
                                value={term}
                                placeholder="Search tasks in this project"
                                aria-label="Search tasks"
                                onChange={(event) => setTerm(event.target.value)}
                            />
                        </div>

                        <Select value={labelId} aria-label="Filter by label" className="w-40" onChange={(event) => setLabelId(event.target.value)}>
                            <option value="">Any label</option>
                            {labels.data?.map((label) => (
                                <option key={label.id} value={label.id}>
                                    {label.name}
                                </option>
                            ))}
                        </Select>

                        <button type="button" className={clsx('btn btn-sm', mineOnly ? 'btn-primary' : 'btn-secondary')} onClick={() => setMineOnly((value) => !value)}>
                            Only mine
                        </button>

                        {filtering ? (
                            <button
                                type="button"
                                className="link text-xs"
                                onClick={() => {
                                    setTerm('');
                                    setMineOnly(false);
                                    setLabelId('');
                                }}
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                ) : null}

                {detail.status === 'archived' ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <span className="inline-flex items-center gap-2">
                            <Archive className="h-4 w-4" />
                            This project is archived. Its tasks are read-only in reports.
                        </span>
                        {canEdit ? (
                            <Button size="sm" variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate({ projectId, status: 'active' })}>
                                Restore
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </header>

            <main className="min-h-0 flex-1 bg-canvas">
                {view === 'board' ? (
                    <Board orgId={orgId} projectId={projectId} board={filtered} canEdit={canEdit} onOpen={open} selectedTaskId={taskId} />
                ) : (
                    <div className="mx-auto max-w-5xl px-4 py-5">
                        <TaskList orgId={orgId} projectId={projectId} board={filtered} canEdit={canEdit} onOpen={open} selectedTaskId={taskId} />
                    </div>
                )}
            </main>

            {taskId ? (
                <TaskDrawer
                    orgId={orgId}
                    projectId={projectId}
                    taskId={taskId}
                    sections={detail.sections.map((section) => ({ id: section.id, name: section.name, isDone: section.isDone }))}
                    viewerId={viewerId}
                    canEdit={canEdit}
                    onClose={close}
                    onOpenTask={open}
                />
            ) : null}

            {modal === 'settings' ? <ProjectSettingsModal project={detail} orgId={orgId} slug={slug} onClose={() => setModal(null)} /> : null}
            {modal === 'members' ? <ProjectMembersModal project={detail} orgId={orgId} onClose={() => setModal(null)} /> : null}
        </div>
    );
}

/**
 * View-side filtering over the board cache.
 *
 * The whole board is already in memory and a project is small enough to filter on the client, so
 * a keystroke in the search box costs no request and the two views stay perfectly in step.
 */
function filterBoard(board: BoardDto, filters: { term: string; assigneeId: string | null; labelId: string }): BoardDto {
    const needle = filters.term.trim().toLowerCase();
    const keep = (task: TaskCardDto) =>
        (!needle || task.title.toLowerCase().includes(needle) || (task.description ?? '').toLowerCase().includes(needle)) &&
        (!filters.assigneeId || task.assigneeIds.includes(filters.assigneeId)) &&
        (!filters.labelId || task.labels.some((label) => label.id === filters.labelId));

    if (!needle && !filters.assigneeId && !filters.labelId) return board;

    return {
        ...board,
        sections: board.sections.map((section) => ({ ...section, tasks: section.tasks.filter(keep) })),
        unassigned: board.unassigned.filter(keep),
    };
}
