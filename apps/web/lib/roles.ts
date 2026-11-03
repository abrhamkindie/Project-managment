import type { OrgRole } from './types';

/**
 * Role checks for *entry points* only.
 *
 * The API is the authority and answers with `canEdit` / `canManageMembers` on the resources it
 * returns, so screens read those. What is left to decide here is whether to offer an action at
 * all — showing a button that is guaranteed to come back 403 is worse than hiding it.
 */
export const isManagerPlus = (role?: OrgRole) => role === 'admin' || role === 'manager';
export const isWorkspaceAdmin = (role?: OrgRole) => role === 'admin';
export const canCreateProject = isManagerPlus;
export const canManageMembers = isWorkspaceAdmin;
