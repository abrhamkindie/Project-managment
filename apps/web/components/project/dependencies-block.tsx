'use client';

import { useState } from 'react';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { STATUS_LABEL } from '~/lib/format';
import { useAddDependency, useRemoveDependency, useTasks } from '~/lib/hooks';
import type { DependencyEdgeDto, TaskDetailDto } from '~/lib/types';
import { Button } from '../ui';

/**
 * Finish-to-start dependency editor.
 *
 * Reads the graph off the task detail payload (`task.dependencies`) and owns only the two
 * writes: link this task to another in the same project, or drop an edge. Blocking
 * relationships are advisory — completing a task with unsatisfied blockers still succeeds
 * server-side, so this panel simply surfaces the context rather than gating the status change.
 */
export function DependenciesBlock({
  task,
  orgId,
  canEdit,
  onOpenTask,
}: {
  task: TaskDetailDto;
  orgId: string;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const addDep = useAddDependency(task.id);
  const removeDep = useRemoveDependency(task.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const blockers = task.dependencies.blockedBy;
  const dependents = task.dependencies.blocking;
  const linkedIds = new Set([
    task.id,
    ...blockers.map((e) => e.task.id),
    ...dependents.map((e) => e.task.id),
  ]);

  // Only fetch candidates while the picker is open; scope to this project.
  const candidates = useTasks(orgId, pickerOpen ? { projectId: task.projectId, pageSize: 50 } : undefined);
  const matches = (candidates.data?.items ?? [])
    .filter((t) => !linkedIds.has(t.id))
    .filter((t) => (search ? t.title.toLowerCase().includes(search.toLowerCase()) : true))
    .slice(0, 12);

  if (!canEdit && blockers.length === 0 && dependents.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GitBranch className="h-4 w-4 text-ink-faint" />
          Dependencies
        </h3>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 transition hover:bg-brand-500/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Link blocker
          </button>
        ) : null}
      </div>

      {blockers.length === 0 && dependents.length === 0 ? (
        <p className="text-xs text-ink-faint">No links yet. This task runs independently.</p>
      ) : (
        <div className="space-y-2">
          {blockers.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Blocked by</p>
              <ul className="space-y-1">
                {blockers.map((edge) => (
                  <DependencyItem
                    key={edge.dependencyId}
                    edge={edge}
                    canEdit={canEdit}
                    onOpenTask={onOpenTask}
                    onRemove={() => removeDep.mutate(edge.dependencyId)}
                    busy={removeDep.isPending}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {dependents.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Blocking</p>
              <ul className="space-y-1">
                {dependents.map((edge) => (
                  <DependencyItem
                    key={edge.dependencyId}
                    edge={edge}
                    canEdit={canEdit}
                    onOpenTask={onOpenTask}
                    onRemove={() => removeDep.mutate(edge.dependencyId)}
                    busy={removeDep.isPending}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {pickerOpen ? (
        <div className="mt-3 rounded-lg bg-canvas p-2">
          <p className="px-1 pb-1 text-[11px] text-ink-muted">
            Link <strong>{task.title.slice(0, 40)}</strong> as blocked by…
          </p>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks in this project…"
            className="mb-1 w-full rounded border border-line bg-surface px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
          {candidates.isLoading ? (
            <p className="px-1 py-2 text-xs text-ink-faint">Loading…</p>
          ) : matches.length === 0 ? (
            <p className="px-1 py-2 text-xs text-ink-faint">No other tasks match.</p>
          ) : (
            <ul className="max-h-40 overflow-y-auto">
              {matches.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={addDep.isPending}
                    onClick={() =>
                      addDep.mutate(
                        { dependsOnTaskId: t.id },
                        {
                          onSuccess: () => {
                            setPickerOpen(false);
                            setSearch('');
                          },
                        },
                      )
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-50"
                  >
                    <span className="truncate text-ink">{t.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{STATUS_LABEL[t.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DependencyItem({
  edge,
  canEdit,
  onOpenTask,
  onRemove,
  busy,
}: {
  edge: DependencyEdgeDto;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5">
      <button type="button" onClick={() => onOpenTask(edge.task.id)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-ink hover:text-brand-700">{edge.task.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: edge.task.project.color }} aria-hidden />
          {edge.task.project.name} · {STATUS_LABEL[edge.task.status]}
          {edge.task.kind === 'epic' ? ' · epic' : ''}
        </span>
      </button>
      {canEdit ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove link to ${edge.task.title}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}
