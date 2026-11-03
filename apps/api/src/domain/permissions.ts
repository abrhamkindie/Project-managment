import type { OrgRole, ProjectRole, ProjectStatus, ProjectVisibility } from './enums.js';
import { isDoneStatus } from './enums.js';
import { dayKey } from '../lib/time.js';

/**
 * Authorization rules for the whole API, in one place and side-effect free so they can
 * be unit tested without a database.
 *
 * Role model
 *  - `admin`   : owns the organization. Manages members, sees and edits everything.
 *  - `manager` : creates and manages every project, sees every board and report.
 *  - `member`  : works inside the projects they belong to (or any project that is
 *                visible to the whole organization).
 *  - project `lead` is a project-level role; the project creator is always a lead.
 */

const ORG_RANK: Record<OrgRole, number> = { member: 0, manager: 1, admin: 2 };

export function atLeastOrgRole(actual: OrgRole, required: OrgRole): boolean {
    return ORG_RANK[actual] >= ORG_RANK[required];
}

/** Snapshot of a user's relationship to one organization (+ optional project). */
export interface Access {
    userId: string;
    orgRole: OrgRole;
    /** `null` when the user is not a member of the project. */
    projectRole: ProjectRole | null;
    projectVisibility?: ProjectVisibility;
    projectStatus?: ProjectStatus;
    projectCreatedById?: string;
    /** userIds currently assigned to the task being checked (optional context). */
    isTaskAssignee?: boolean;
    taskCreatedById?: string;
}

const isLead = (a: Access) => a.projectRole === 'lead';
const isCreator = (a: Access) => a.projectCreatedById === a.userId;
const managerPlus = (a: Access) => atLeastOrgRole(a.orgRole, 'manager');
const isAdmin = (a: Access) => a.orgRole === 'admin';

export const can = {
    /** Organization settings and member management. */
    manageOrganization(a: Access) {
        return isAdmin(a);
    },
    viewOrganizationMembers(a: Access) {
        return managerPlus(a) || isAdmin(a);
    },

    /** A private project is only visible to its members; everyone else sees org-wide ones. */
    viewProject(a: Access) {
        if (managerPlus(a) || isLead(a) || isCreator(a)) return true;
        if (a.projectRole) return true;
        return a.projectVisibility !== 'private';
    },

    editProject(a: Access) {
        return managerPlus(a) || isLead(a) || isCreator(a);
    },

    deleteProject(a: Access) {
        return managerPlus(a) || isCreator(a);
    },

    manageProjectMembers(a: Access) {
        return managerPlus(a) || isLead(a) || isCreator(a);
    },

    createProject(a: Access) {
        return managerPlus(a);
    },

    createTask(a: Access) {
        if (a.projectStatus === 'archived') return false;
        return can.viewProject(a);
    },

    editTask(a: Access) {
        if (a.projectStatus === 'archived') return false;
        return managerPlus(a) || isLead(a) || a.projectRole !== null || a.isTaskAssignee === true;
    },

    deleteTask(a: Access) {
        return managerPlus(a) || isLead(a) || a.taskCreatedById === a.userId;
    },

    /** Only people who can see a project may be assigned work inside it. */
    assignWithinProject(a: Access) {
        return can.viewProject(a);
    },

    comment(a: Access) {
        return can.viewProject(a) && a.projectStatus !== 'archived';
    },

    moderateComment(a: Access) {
        return managerPlus(a) || isLead(a);
    },

    viewProjectReport(a: Access) {
        return can.viewProject(a);
    },

    viewOrganizationReport(a: Access) {
        return managerPlus(a);
    },
};

/**
 * Task is past its due date and not finished.
 *
 * Compared at calendar-day granularity, not by timestamp. Date pickers send `YYYY-MM-DD`, which
 * lands on UTC midnight — a timestamp comparison would report work due today as already late and
 * would disagree with what the assignee sees. The day a card is due is worked on all day.
 */
export function isOverdue(dueDate: Date | null | undefined, status: string, now = new Date()): boolean {
    if (!dueDate) return false;
    if (isDoneStatus(status)) return false;
    return dayKey(dueDate) < dayKey(now);
}

/** Due after today and within the next `days` calendar days, ignoring finished work. */
export function isDueSoon(dueDate: Date | null | undefined, status: string, days = 3, now = new Date()): boolean {
    if (!dueDate || isDoneStatus(status)) return false;
    const due = dayKey(dueDate);
    if (due <= dayKey(now)) return false;
    return due <= dayKey(new Date(now.getTime() + days * 86_400_000));
}
