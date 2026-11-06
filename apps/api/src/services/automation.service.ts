import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BadRequest, Forbidden } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import { loadProjectAccess } from './access.js';
import { taskWatchers } from './access.js';
import { notify, recordActivity } from './activity.js';
import { resolveSectionForStatus, taskSelectIncludes } from './task.internal.js';
import { queueEvent } from './webhook.service.js';
import {
    WEBHOOK_EVENTS,
    isDoneStatus,
    type AutomationAction,
    type AutomationTrigger,
    type TaskStatus,
    type WebhookEvent,
} from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import type { AutomationTriggerShape, CreateAutomationInput, UpdateAutomationInput } from '../domain/schemas.js';

/**
 * Rule engine (project automations).
 *
 * A rule is `{ trigger: { event, conditions? }, actions: [] }` stored as JSON on `AutomationRule`.
 * Actions are the fixed primitives in `AUTOMATION_ACTIONS` — there is deliberately no expression
 * language, so a rule can be rendered as dropdowns in the UI and cannot be used to run code.
 *
 * Evaluation is hooked into the activity write path (`services/activity.ts`), the one place every
 * mutation already reports through, so rules fire for human edits, API tokens and timers alike.
 *
 * Recursion is bounded by provenance rather than a counter: rows written while a rule runs carry
 * `meta.via = 'automation'`, and the fan-out ignores those. A rule that sets the status it listens for
 * becomes a no-op instead of an infinite loop, and two rules that ping-pong a task settle after one pass.
 */

export interface AutomationEvent {
    orgId: string;
    projectId: string;
    taskId: string | null;
    /** The activity event that fired. */
    type: AutomationTrigger;
    actorId: string;
    meta: Record<string, unknown>;
}

interface ParsedRule {
    id: string;
    name: string;
    trigger: AutomationTriggerShape;
    actions: AutomationAction[];
}

function parseRule(row: { id: string; name: string; trigger: string; actions: string }): ParsedRule | null {
    try {
        const trigger = JSON.parse(row.trigger) as AutomationTriggerShape;
        const actions = JSON.parse(row.actions) as AutomationAction[];
        if (!trigger?.event || !Array.isArray(actions)) return null;
        return { id: row.id, name: row.name, trigger, actions };
    } catch {
        // A hand-edited or half-migrated row must not take the whole activity path down.
        logger.warn({ rule: row.id }, 'Automation rule has an unreadable definition, skipping');
        return null;
    }
}

/**
 * Conditions are matched against the activity meta when it already carries the answer (status
 * transitions do), so the common rule costs no extra read. `hasLabelId` needs the task row and is
 * checked separately once that row is loaded anyway.
 */
export function matchesConditions(conditions: AutomationTriggerShape['conditions'], event: AutomationEvent): boolean {
    if (!conditions) return true;
    if (conditions.from && event.meta.from !== conditions.from) return false;
    if (conditions.to && event.meta.to !== conditions.to) return false;
    if (conditions.priority && event.meta.priority !== conditions.priority) return false;
    return true;
}

const AUTOMATION_TRIGGERS: readonly string[] = ['task.created', 'task.status_changed', 'task.assigned', 'comment.added'];

/** Which activity types the engine looks at; anything else skips the rule query entirely. */
export function isAutomationTrigger(type: string): type is AutomationTrigger {
    return AUTOMATION_TRIGGERS.includes(type);
}

/** Task columns a firing needs to evaluate and act on. Loaded once, shared by all matching rules. */
async function loadTask(taskId: string | null) {
    if (!taskId) return null;
    return prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            projectId: true,
            title: true,
            status: true,
            priority: true,
            labels: { select: { labelId: true } },
            assignees: { select: { userId: true } },
        },
    });
}

export async function evaluateAutomations(event: AutomationEvent): Promise<{ applied: number }> {
    if (!event.projectId || !isAutomationTrigger(event.type)) return { applied: 0 };

    const rows = await prisma.automationRule.findMany({ where: { projectId: event.projectId, active: true } });
    const candidates = rows
        .map(parseRule)
        .filter((rule): rule is ParsedRule =>
            rule !== null && rule.trigger.event === event.type && matchesConditions(rule.trigger.conditions, event));
    if (candidates.length === 0) return { applied: 0 };

    const task = await loadTask(event.taskId);
    let applied = 0;
    for (const rule of candidates) {
        if (task && rule.trigger.conditions?.hasLabelId && !task.labels.some((row) => row.labelId === rule.trigger.conditions?.hasLabelId)) {
            continue;
        }
        try {
            applied += await applyRule(rule, event, task);
        } catch (error) {
            // One broken rule (deleted label, ex-member assignee) must not stop the others.
            logger.error({ err: error, rule: rule.id }, 'Automation action failed');
        }
    }
    return { applied };
}

/** Returns 1 when the rule changed anything, so a failing/no-op rule is not counted. */
async function applyRule(rule: ParsedRule, event: AutomationEvent, task: Awaited<ReturnType<typeof loadTask>>): Promise<number> {
    if (!task) return 0;
    const changed: string[] = [];
    const data: Prisma.TaskUncheckedUpdateInput = {};
    let statusChanged = false;

    for (const action of rule.actions) {
        switch (action.kind) {
            case 'set_status': {
                const next = String(action.value) as TaskStatus;
                if (next !== task.status) {
                    data.status = next;
                    // Mirror completion time exactly like a human edit, so reporting stays honest.
                    data.completedAt = isDoneStatus(next) ? new Date() : null;
                    data.sectionId = await resolveSectionForStatus(task.projectId, next);
                    statusChanged = true;
                    changed.push('status');
                }
                break;
            }
            case 'set_priority': {
                const next = String(action.value);
                if (next !== task.priority) {
                    data.priority = next;
                    changed.push('priority');
                }
                break;
            }
            case 'assign': {
                const userId = String(action.value);
                const member = await prisma.organizationMember.findFirst({ where: { orgId: event.orgId, userId }, select: { userId: true } });
                if (!member) throw new BadRequest('Assignee is no longer a member of this organization');
                await prisma.$transaction([
                    prisma.taskAssignee.deleteMany({ where: { taskId: task.id } }),
                    prisma.taskAssignee.create({ data: { taskId: task.id, userId } }),
                ]);
                changed.push('assignee');
                await notify({
                    orgId: event.orgId,
                    userIds: [userId],
                    type: 'task.assigned',
                    title: `Assigned to ${task.title}`,
                    body: `Automation rule “${rule.name}” assigned you to ${task.title}`,
                    link: `/projects/${task.projectId}/tasks/${task.id}`,
                });
                break;
            }
            case 'add_label': {
                const labelId = String(action.value);
                const label = await prisma.label.findFirst({ where: { id: labelId, orgId: event.orgId }, select: { id: true } });
                if (!label) throw new BadRequest('Label no longer exists in this organization');
                if (!task.labels.some((row) => row.labelId === labelId)) {
                    await prisma.taskLabel.create({ data: { taskId: task.id, labelId } });
                    changed.push('labels');
                }
                break;
            }
            case 'notify': {
                const audience = await taskWatchers(task.id);
                if (audience.length === 0) break;
                await notify({
                    orgId: event.orgId,
                    userIds: audience,
                    type: 'automation.fired',
                    title: String(action.value).slice(0, 120) || rule.name,
                    body: `Automation rule “${rule.name}” fired on ${task.title}`,
                    link: `/projects/${task.projectId}/tasks/${task.id}`,
                });
                changed.push('notification');
                break;
            }
            case 'webhook': {
                await queueEvent({
                    orgId: event.orgId,
                    event: String(action.value) as WebhookEvent,
                    projectId: task.projectId,
                    taskId: task.id,
                    data: { rule: rule.name, title: task.title, status: task.status, via: 'automation' },
                });
                changed.push('webhook');
                break;
            }
        }
    }

    if (Object.keys(data).length === 0) return changed.length > 0 ? 1 : 0;

    const updated = await prisma.task.update({ where: { id: task.id }, data, include: taskSelectIncludes });

    await recordActivity({
        orgId: event.orgId,
        actorId: event.actorId,
        projectId: task.projectId,
        taskId: task.id,
        type: statusChanged ? 'task.status_changed' : 'task.updated',
        // `via` is the recursion guard: the fan-out ignores activities an automation produced itself.
        meta: { changed, from: task.status, to: updated.status, title: updated.title, via: 'automation', ruleId: rule.id, ruleName: rule.name },
    });
    return 1;
}

// --------------------------------------------------------------- management (routes)

function assertCanManage(access: Parameters<typeof can.editProject>[0]) {
    if (!can.editProject(access)) throw new Forbidden('You cannot manage automations for this project');
}

function present(row: {
    id: string;
    projectId: string;
    name: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    trigger: string;
    actions: string;
}) {
    const parsed = parseRule(row);
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        active: row.active,
        trigger: parsed?.trigger ?? { event: 'task.created' },
        actions: parsed?.actions ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export async function listRules(user: AuthUser, projectId: string) {
    const { project } = await loadProjectAccess(user, projectId);
    const rows = await prisma.automationRule.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
    return rows.map(present);
}

export async function createRule(user: AuthUser, projectId: string, input: CreateAutomationInput) {
    const { project, access } = await loadProjectAccess(user, projectId);
    assertCanManage(access);
    await validateActions(input.actions, input.trigger, project.orgId);

    const row = await prisma.automationRule.create({
        data: {
            orgId: project.orgId,
            projectId: project.id,
            name: input.name,
            trigger: JSON.stringify(input.trigger),
            actions: JSON.stringify(input.actions),
            active: input.active,
        },
    });
    return present(row);
}

export async function updateRule(user: AuthUser, id: string, input: UpdateAutomationInput) {
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing) throw new BadRequest('No such automation rule');
    const { access } = await loadProjectAccess(user, existing.projectId);
    assertCanManage(access);

    const trigger = input.trigger ?? parseRule(existing)?.trigger;
    const actions = input.actions ?? parseRule(existing)?.actions ?? [];
    if (!trigger) throw new BadRequest('Automation rule is missing a trigger');
    await validateActions(actions, trigger, existing.orgId);

    const row = await prisma.automationRule.update({
        where: { id },
        data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.trigger !== undefined ? { trigger: JSON.stringify(input.trigger) } : {}),
            ...(actions !== undefined ? { actions: JSON.stringify(actions) } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
        },
    });
    return present(row);
}

export async function deleteRule(user: AuthUser, id: string) {
    const existing = await prisma.automationRule.findUnique({ where: { id }, select: { projectId: true } });
    if (!existing) throw new BadRequest('No such automation rule');
    const { access } = await loadProjectAccess(user, existing.projectId);
    assertCanManage(access);
    await prisma.automationRule.delete({ where: { id } });
    return { id };
}

/**
 * Cross-field checks Zod cannot express, because they depend on what the rule points at:
 * a `webhook` action must name a subscribable event, and ids that no longer exist should fail at
 * save time rather than silently doing nothing on every future firing.
 */
async function validateActions(actions: AutomationAction[], trigger: AutomationTriggerShape, orgId: string) {
    for (const action of actions) {
        if (action.kind === 'webhook' && !WEBHOOK_EVENTS.includes(String(action.value) as WebhookEvent)) {
            throw new BadRequest('A webhook action must name one of the supported events');
        }
        if (action.kind === 'set_status' && !['todo', 'in_progress', 'in_review', 'done', 'canceled'].includes(String(action.value))) {
            throw new BadRequest('Unknown target status');
        }
    }

    const labelIds = actions.filter((action) => action.kind === 'add_label').map((action) => String(action.value));
    const userIds = actions.filter((action) => action.kind === 'assign').map((action) => String(action.value));

    if (labelIds.length > 0) {
        const found = await prisma.label.count({ where: { id: { in: labelIds }, orgId } });
        if (found !== new Set(labelIds).size) throw new BadRequest('One or more labels are not available in this organization');
    }
    if (userIds.length > 0) {
        const members = await prisma.organizationMember.count({ where: { userId: { in: userIds }, orgId } });
        if (members === 0) throw new BadRequest('Assignee is not a member of this organization');
    }
}
