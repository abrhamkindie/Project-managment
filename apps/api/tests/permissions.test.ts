import { describe, expect, it } from 'vitest';
import { atLeastOrgRole, can, isDueSoon, isOverdue, type Access } from '../src/domain/permissions.js';
import { isOpenStatus, isDoneStatus, priorityWeight } from '../src/domain/enums.js';
import { rankBetween, slugify, uniqueSlug } from '../src/lib/crypto.js';
import { addSeconds, dayKey, durationSeconds, weekKey } from '../src/lib/time.js';
import { paginate } from '../src/lib/http.js';

/**
 * Pure rules. These are the cheapest tests in the suite and they cover the behaviour
 * that is hardest to see in a browser: who is allowed to do what, and how "overdue"
 * and "due soon" are decided.
 */

const base: Access = { userId: 'u1', orgRole: 'member', projectRole: null };
const access = (overrides: Partial<Access>): Access => ({ ...base, ...overrides });

describe('organization roles', () => {
    it('orders member < manager < admin', () => {
        expect(atLeastOrgRole('manager', 'member')).toBe(true);
        expect(atLeastOrgRole('member', 'manager')).toBe(false);
        expect(atLeastOrgRole('admin', 'manager')).toBe(true);
    });

    it('only admins manage the organization itself', () => {
        expect(can.manageOrganization(access({ orgRole: 'admin' }))).toBe(true);
        expect(can.manageOrganization(access({ orgRole: 'manager' }))).toBe(false);
        expect(can.viewOrganizationMembers(access({ orgRole: 'manager' }))).toBe(true);
        expect(can.viewOrganizationMembers(access({ orgRole: 'member' }))).toBe(false);
    });

    it('only managers and above can create projects and read org reports', () => {
        expect(can.createProject(access({ orgRole: 'member' }))).toBe(false);
        expect(can.createProject(access({ orgRole: 'manager' }))).toBe(true);
        expect(can.viewOrganizationReport(access({ orgRole: 'member' }))).toBe(false);
        expect(can.viewOrganizationReport(access({ orgRole: 'admin' }))).toBe(true);
    });
});

describe('project visibility', () => {
    it('hides private projects from non-members', () => {
        expect(can.viewProject(access({ projectVisibility: 'private' }))).toBe(false);
        expect(can.viewProject(access({ projectVisibility: 'organization' }))).toBe(true);
        expect(can.viewProject(access({ projectVisibility: 'private', projectRole: 'member' }))).toBe(true);
    });

    it('lets managers into everything, and members into their own projects', () => {
        expect(can.viewProject(access({ orgRole: 'manager', projectVisibility: 'private' }))).toBe(true);
        expect(can.viewProject(access({ projectVisibility: 'private', projectCreatedById: 'u1' }))).toBe(true);
    });

    it('restricts editing and deleting to leads, creators and managers', () => {
        const member = access({ projectRole: 'member', projectVisibility: 'organization' });
        expect(can.editProject(member)).toBe(false);
        expect(can.manageProjectMembers(member)).toBe(false);
        expect(can.deleteProject(member)).toBe(false);
        expect(can.editProject(access({ projectRole: 'lead' }))).toBe(true);
        expect(can.deleteProject(access({ projectRole: 'lead' }))).toBe(false); // leads edit, managers delete
        expect(can.deleteProject(access({ projectCreatedById: 'u1', projectRole: 'lead' }))).toBe(true);
    });

    it('freezes archived projects for writes but keeps them readable', () => {
        const archived = access({ projectRole: 'member', projectStatus: 'archived', projectVisibility: 'organization' });
        expect(can.viewProject(archived)).toBe(true);
        expect(can.createTask(archived)).toBe(false);
        expect(can.editTask(archived)).toBe(false);
        expect(can.comment(archived)).toBe(false);
    });
});

describe('task level permissions', () => {
    it('assignees may edit but only creators, leads and managers may delete', () => {
        const assignee = access({ projectRole: 'member', isTaskAssignee: true });
        expect(can.editTask(assignee)).toBe(true);
        expect(can.deleteTask(assignee)).toBe(false);
        expect(can.deleteTask(access({ projectRole: 'member', taskCreatedById: 'u1' }))).toBe(true);
    });

    it('you cannot assign someone into a project they cannot see', () => {
        expect(can.assignWithinProject(access({ projectVisibility: 'private' }))).toBe(false);
        expect(can.assignWithinProject(access({ projectVisibility: 'private', projectRole: 'member' }))).toBe(true);
    });

    it('leads moderate other people\'s comments', () => {
        expect(can.moderateComment(access({ projectRole: 'lead' }))).toBe(true);
        expect(can.moderateComment(access({ projectRole: 'member' }))).toBe(false);
    });
});

describe('dates', () => {
    const now = new Date('2026-11-03T12:00:00.000Z');
    const past = new Date('2026-11-01T12:00:00.000Z');
    const future = new Date('2026-11-05T12:00:00.000Z');
    const farFuture = new Date('2026-12-25T00:00:00.000Z');

    it('isOverdue ignores finished work and undated tasks', () => {
        expect(isOverdue(past, 'todo', now)).toBe(true);
        expect(isOverdue(past, 'done', now)).toBe(false);
        expect(isOverdue(past, 'canceled', now)).toBe(false);
        expect(isOverdue(null, 'todo', now)).toBe(false);
        expect(isOverdue(future, 'in_progress', now)).toBe(false);
    });

    it('isDueSoon covers the next few days only', () => {
        expect(isDueSoon(future, 'todo', 3, now)).toBe(true);
        expect(isDueSoon(farFuture, 'todo', 3, now)).toBe(false);
        expect(isDueSoon(past, 'todo', 3, now)).toBe(false); // already overdue, not "soon"
        expect(isDueSoon(future, 'done', 3, now)).toBe(false);
    });

    it('reads a due date as the whole calendar day it names', () => {
        // Date pickers send `YYYY-MM-DD`, which reaches the API as midnight UTC.
        const dueToday = new Date('2026-11-03T00:00:00.000Z');
        const dueTomorrow = new Date('2026-11-04T00:00:00.000Z');
        const endOfYesterday = new Date('2026-11-02T23:59:00.000Z');

        // The day a card is due is worked on all day: it turns late only once it is over.
        expect(isOverdue(dueToday, 'todo', now)).toBe(false);
        expect(isOverdue(endOfYesterday, 'todo', now)).toBe(true);

        // "Soon" therefore starts tomorrow instead of double-counting today as late.
        expect(isDueSoon(dueToday, 'todo', 3, now)).toBe(false);
        expect(isDueSoon(dueTomorrow, 'todo', 3, now)).toBe(true);
    });

    it('parses TTLs into seconds', () => {
        expect(durationSeconds('15m')).toBe(900);
        expect(durationSeconds('7d')).toBe(604_800);
        expect(durationSeconds('45s')).toBe(45);
        expect(durationSeconds(120)).toBe(120);
    });

    it('buckets days and weeks deterministically', () => {
        expect(dayKey(now)).toBe('2026-11-03');
        expect(weekKey(now)).toBe('2026-W45'); // ISO week: 2026-11-02 .. 2026-11-08
        expect(addSeconds(now, 60).toISOString()).toBe('2026-11-03T12:01:00.000Z');
    });
});

describe('status and priority helpers', () => {
    it('classifies statuses for analytics', () => {
        expect(isOpenStatus('in_review')).toBe(true);
        expect(isOpenStatus('done')).toBe(false);
        expect(isDoneStatus('canceled')).toBe(true);
        expect(isDoneStatus('nonsense')).toBe(false);
        expect(priorityWeight('urgent')).toBe(4);
        expect(priorityWeight('garbage')).toBe(0);
    });
});

describe('ranking and slugs', () => {
    it('inserts between neighbours without renumbering', () => {
        expect(rankBetween(null, null)).toBe(1000);
        expect(rankBetween(1000, null)).toBe(2000);
        expect(rankBetween(null, 1000)).toBe(500);
        expect(rankBetween(0, 1000)).toBe(500);
        // Dropping a card after the last one always moves forward.
        const first = rankBetween(null, null);
        expect(rankBetween(first, null)).toBeGreaterThan(first);
    });

    it('slugifies and de-duplicates', async () => {
        expect(slugify('  Q4 Launch — Campaign! ')).toBe('q4-launch-campaign');
        const taken = new Set(['acme']);
        expect(await uniqueSlug('Acme', async (candidate) => taken.has(candidate))).toBe('acme-2');
    });
});

describe('pagination envelope', () => {
    it('reports page counts consistently', () => {
        expect(paginate([1, 2, 3], 7, 1, 3)).toEqual({ items: [1, 2, 3], total: 7, page: 1, pageSize: 3, pages: 3 });
        expect(paginate([], 0, 1, 25)).toMatchObject({ total: 0, pages: 1 });
    });
});
