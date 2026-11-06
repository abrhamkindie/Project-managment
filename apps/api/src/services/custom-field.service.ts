import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { can } from '../domain/permissions.js';
import type { CustomFieldType } from '../domain/enums.js';
import type { AuthUser } from '../types/express.js';
import type { CreateCustomFieldInput, CustomFieldFilter, TaskFieldValuesInput, UpdateCustomFieldInput } from '../domain/schemas.js';
import { loadProjectAccess, loadTaskAccess } from './access.js';
import { recordActivity } from './activity.js';

/**
 * Custom fields (Phase 6): definitions that widen a task beyond the built-in columns, plus their
 * per-task values.
 *
 * A definition is organization-wide or narrowed to one project. Values always live in a single
 * string column, because the portability rule in `schema.prisma` keeps database types out of the
 * schema — so the type rules are enforced *here*, at the moment a value is written, rather than by
 * the column. For the same reason a definition's `type` is immutable after creation: the stored
 * strings would silently change meaning underneath the people who typed them.
 */

interface DefinitionRow {
    id: string;
    orgId: string;
    projectId: string | null;
    name: string;
    type: string;
    options: string;
    createdAt: Date;
}

/** The narrowed shape the rest of this module (and the CSV builder) works with. */
export interface FieldDefinition {
    id: string;
    name: string;
    projectId: string | null;
    type: CustomFieldType;
    options: string[];
}

/** `options` is a JSON string array; a corrupt row degrades to "no options", never a 500. */
function optionsOf(row: { options: string }): string[] {
    try {
        const parsed = JSON.parse(row.options);
        return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === 'string') : [];
    } catch {
        return [];
    }
}

const dedupe = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const present = (row: DefinitionRow) => ({
    id: row.id,
    orgId: row.orgId,
    projectId: row.projectId,
    name: row.name,
    type: row.type,
    options: optionsOf(row),
    createdAt: row.createdAt.toISOString(),
});

const asDefinition = (row: DefinitionRow): FieldDefinition => ({
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    type: row.type as CustomFieldType,
    options: optionsOf(row),
});

/** Membership is the entry ticket for every field route; the role decides who may change shapes. */
async function orgRole(user: AuthUser, orgId: string): Promise<string> {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
    });
    if (!membership) throw new Forbidden('You are not a member of this organization');
    return membership.role;
}

/**
 * Who may change a definition: an organization-wide field rewrites everyone's task form, so it is a
 * manager call; a project-scoped one follows that project's own edit rule (lead, creator, manager+).
 */
async function assertCanManage(user: AuthUser, orgId: string, projectId: string | null): Promise<void> {
    if (!projectId) {
        const role = await orgRole(user, orgId);
        if (role !== 'manager' && role !== 'admin') throw new Forbidden('Only managers can change organization-wide fields');
        return;
    }
    const { project, access } = await loadProjectAccess(user, projectId);
    if (project.orgId !== orgId) throw new NotFound('Project not found in this organization');
    if (!can.editProject(access)) throw new Forbidden('You cannot manage fields in this project');
}

/** Same guard for a stored definition, so a client cannot retarget a field by sending another id. */
async function loadOwnedField(orgId: string, fieldId: string): Promise<DefinitionRow> {
    const row = await prisma.customFieldDefinition.findUnique({ where: { id: fieldId } });
    if (!row || row.orgId !== orgId) throw new NotFound('Field not found');
    return row;
}

/**
 * Definitions visible to a member. With a project the caller gets organization-wide fields plus that
 * project's own; without one, only the organization-wide set — a private project's field names are
 * not leaked through the organization settings screen.
 */
export async function listFields(user: AuthUser, orgId: string, projectId?: string | null) {
    await orgRole(user, orgId);
    if (projectId) {
        const { project } = await loadProjectAccess(user, projectId);
        if (project.orgId !== orgId) throw new NotFound('Project not found in this organization');
    }
    const rows = await prisma.customFieldDefinition.findMany({
        where: { orgId, ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null }) },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(present) };
}

export async function createField(user: AuthUser, orgId: string, input: CreateCustomFieldInput) {
    const projectId = input.projectId ?? null;
    await assertCanManage(user, orgId, projectId);

    const options = input.type === 'select' ? dedupe(input.options ?? []) : [];
    if (input.type === 'select' && options.length === 0) throw new BadRequest('A select field needs at least one option');

    // Pre-checked for a readable message: the compound unique would not catch an organization-wide
    // duplicate anyway, because a null `projectId` is never equal to another null in the index.
    const duplicate = await prisma.customFieldDefinition.findFirst({ where: { orgId, projectId, name: input.name }, select: { id: true } });
    if (duplicate) throw new Conflict(`A field named "${input.name}" already exists in this scope`);

    const row = await prisma.customFieldDefinition.create({
        data: { orgId, projectId, name: input.name, type: input.type, options: JSON.stringify(options), createdById: user.id },
    });
    await recordActivity({
        orgId,
        actorId: user.id,
        projectId,
        type: 'field.created',
        meta: { fieldId: row.id, name: row.name, fieldType: row.type },
    });
    return present(row);
}

export async function updateField(user: AuthUser, orgId: string, fieldId: string, patch: UpdateCustomFieldInput) {
    const existing = await loadOwnedField(orgId, fieldId);
    await assertCanManage(user, orgId, existing.projectId);
    if (patch.options && existing.type !== 'select') throw new BadRequest('Only a select field has options to change');

    const data: Prisma.CustomFieldDefinitionUpdateInput = {};
    if (patch.name && patch.name !== existing.name) data.name = patch.name;
    let options = optionsOf(existing);
    if (patch.options) {
        options = dedupe(patch.options);
        if (options.length === 0) throw new BadRequest('A select field needs at least one option');
        data.options = JSON.stringify(options);
    }
    if (Object.keys(data).length === 0) return present(existing);

    const updated = await prisma.customFieldDefinition.update({ where: { id: fieldId }, data });

    // Narrowing the option list leaves rows holding a choice the picker can no longer offer. Those
    // are dropped rather than kept, so the filter and the export can never report a phantom value.
    let prunedValues = 0;
    if (patch.options) {
        prunedValues = (await prisma.taskFieldValue.deleteMany({ where: { fieldId, value: { notIn: options } } })).count;
    }

    await recordActivity({
        orgId,
        actorId: user.id,
        projectId: existing.projectId,
        type: 'field.updated',
        meta: { fieldId, name: updated.name, fields: Object.keys(data), prunedValues },
    });
    return present(updated);
}

export async function deleteField(user: AuthUser, orgId: string, fieldId: string) {
    const existing = await loadOwnedField(orgId, fieldId);
    await assertCanManage(user, orgId, existing.projectId);
    const valuesRemoved = await prisma.taskFieldValue.count({ where: { fieldId } });
    // `TaskFieldValue.field` is ON DELETE CASCADE, so this drops the values with the definition.
    await prisma.customFieldDefinition.delete({ where: { id: fieldId } });
    await recordActivity({
        orgId,
        actorId: user.id,
        projectId: existing.projectId,
        type: 'field.deleted',
        meta: { fieldId, name: existing.name, valuesRemoved },
    });
    return { id: fieldId, valuesRemoved };
}

/** Definitions a task in this project may carry: organization-wide plus the project's own. */
export async function visibleDefinitions(orgId: string, projectId: string): Promise<Map<string, FieldDefinition>> {
    const rows = await prisma.customFieldDefinition.findMany({ where: { OR: [{ orgId, projectId: null }, { orgId, projectId }] } });
    return new Map(rows.map((row) => [row.id, asDefinition(row)]));
}

/** Every definition of the organization, by id: what a list filter is resolved against. */
export async function definitionsById(orgId: string): Promise<Map<string, FieldDefinition>> {
    const rows = await prisma.customFieldDefinition.findMany({ where: { orgId } });
    return new Map(rows.map((row) => [row.id, asDefinition(row)]));
}

/**
 * One submitted value -> the string the row stores, or `null` for "clear this field".
 *
 * Exported because the rules are worth testing without a database, and they are the only place the
 * declared type of a field means anything at all.
 */
export function coerceFieldValue(type: CustomFieldType, options: string[], raw: unknown): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string' && raw.trim() === '') return null;

    switch (type) {
        case 'text': {
            if (typeof raw !== 'string' && typeof raw !== 'number') throw new BadRequest('This field takes text');
            const text = String(raw).trim();
            if (text.length > 2000) throw new BadRequest('A text field value is limited to 2000 characters');
            return text;
        }
        case 'number': {
            const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (!Number.isFinite(value)) throw new BadRequest('This field takes a number');
            return String(value);
        }
        case 'date': {
            const text = typeof raw === 'string' ? raw.trim() : '';
            const parsed = new Date(text);
            if (!text || Number.isNaN(parsed.getTime())) throw new BadRequest('This field takes a date (YYYY-MM-DD)');
            // Day granularity: the picker has no clock, and storing a timestamp would make the same
            // entry sort and compare differently depending on who read it.
            return parsed.toISOString().slice(0, 10);
        }
        case 'select': {
            const value = typeof raw === 'string' ? raw.trim() : String(raw);
            if (!options.includes(value)) throw new BadRequest(`"${value}" is not an option of this field`);
            return value;
        }
        case 'checkbox': {
            if (typeof raw === 'boolean') return raw ? 'true' : 'false';
            const value = String(raw).trim().toLowerCase();
            if (value === 'true') return 'true';
            if (value === 'false') return 'false';
            throw new BadRequest('This field takes true or false');
        }
    }
}

async function valuesOf(taskId: string, definitions: Map<string, FieldDefinition>) {
    const rows = await prisma.taskFieldValue.findMany({ where: { taskId }, select: { fieldId: true, value: true }, orderBy: { fieldId: 'asc' } });
    // A value whose definition belongs to another project (or was deleted in a race) is not shown.
    return rows.filter((row) => definitions.has(row.fieldId));
}

/** Everything the drawer needs in one call: the visible definitions and this task's values. */
export async function taskFields(user: AuthUser, taskId: string) {
    const { task, project } = await loadTaskAccess(user, taskId);
    const definitions = await visibleDefinitions(project.orgId, task.projectId);
    const values = await valuesOf(taskId, definitions);
    return { items: [...definitions.values()], values };
}

/**
 * Set or clear part of a task's field values. Only the keys that are sent are touched, so two
 * people editing different fields of one task cannot overwrite each other.
 */
export async function setFieldValues(user: AuthUser, taskId: string, input: TaskFieldValuesInput) {
    const { task, project, access } = await loadTaskAccess(user, taskId);
    if (!can.editTask(access)) throw new Forbidden('You cannot edit this task');

    const definitions = await visibleDefinitions(project.orgId, task.projectId);
    const writes: Prisma.TaskFieldValueUpsertArgs[] = [];
    const cleared: string[] = [];
    const touched: string[] = [];

    for (const [fieldId, raw] of Object.entries(input.values)) {
        const definition = definitions.get(fieldId);
        if (!definition) throw new BadRequest('That field does not apply to this task');
        touched.push(definition.name);
        const value = coerceFieldValue(definition.type, definition.options, raw);
        if (value === null) {
            cleared.push(fieldId);
            continue;
        }
        writes.push({ where: { taskId_fieldId: { taskId, fieldId } }, update: { value }, create: { taskId, fieldId, value } });
    }

    // One transaction, and the compound unique is the upsert key: a double-clicked save lands as a
    // single row instead of tripping the constraint.
    await prisma.$transaction([
        ...(cleared.length ? [prisma.taskFieldValue.deleteMany({ where: { taskId, fieldId: { in: cleared } } })] : []),
        ...writes.map((write) => prisma.taskFieldValue.upsert(write)),
    ]);

    const values = await valuesOf(taskId, definitions);
    await recordActivity({
        orgId: project.orgId,
        actorId: user.id,
        projectId: task.projectId,
        taskId,
        type: 'task.fields_updated',
        // Names, not ids: this row is read by people in the task timeline and the audit CSV.
        meta: { title: task.title, fields: touched },
    });
    return { id: taskId, fields: values };
}

/**
 * `AND` clauses for custom-field filters — one clause per filter, each a `some` over the value rows.
 *
 * They cannot be collapsed into a single `some`: `(taskId, fieldId)` is unique, so one row can never
 * satisfy two different fields. Text is a substring match (that is what people expect from a free
 * field); every other type is equality on its normalized form, which is why `2` and `2.0` are not
 * the same filter value for a number field.
 */
export function fieldFilterClauses(filters: CustomFieldFilter[], definitions: Map<string, FieldDefinition>): Prisma.TaskWhereInput[] {
    return filters.map((filter) => {
        const definition = definitions.get(filter.fieldId);
        if (!definition) throw new BadRequest('A filter names a field that does not exist in this organization');
        const value = definition.type === 'text' ? String(filter.value).trim() : coerceFieldValue(definition.type, definition.options, filter.value);
        if (!value) throw new BadRequest('A custom field filter needs a value');
        return {
            fieldValues: { some: { fieldId: definition.id, ...(definition.type === 'text' ? { value: { contains: value } } : { value }) } },
        };
    });
}

/**
 * Extra CSV columns, in the order the caller asked for them.
 *
 * Ids that are not visible in this project are silently skipped rather than failing the download:
 * a stale column picker (or a field deleted since the link was made) should cost a column, not the
 * whole file.
 */
export async function csvColumns(orgId: string, projectId: string, fieldIds: string[]) {
    const definitions = await visibleDefinitions(orgId, projectId);
    const chosen = fieldIds
        .map((fieldId) => definitions.get(fieldId))
        .filter((definition): definition is FieldDefinition => Boolean(definition));
    if (chosen.length === 0) return { header: [] as string[], cellsFor: () => [] as string[] };

    const rows = await prisma.taskFieldValue.findMany({
        where: { fieldId: { in: chosen.map((definition) => definition.id) }, task: { projectId } },
        select: { taskId: true, fieldId: true, value: true },
    });
    const byTask = new Map<string, Map<string, string>>();
    for (const row of rows) {
        const inner = byTask.get(row.taskId) ?? new Map<string, string>();
        inner.set(row.fieldId, row.value);
        byTask.set(row.taskId, inner);
    }

    return {
        header: chosen.map((definition) => definition.name),
        cellsFor: (taskId: string) => chosen.map((definition) => byTask.get(taskId)?.get(definition.id) ?? ''),
    };
}
