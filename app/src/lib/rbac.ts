/**
 * Role-based access control.
 *
 * Three separate roles, strictly ranked. The key rule that keeps super_admin
 * and admin separate: an actor may only manage a target whose role rank is
 * *strictly lower* than their own. So admins manage users, super_admins manage
 * admins and users, and no one can manage a peer of equal rank.
 */

export const ROLES = ['super_admin', 'admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  super_admin: 3,
  admin: 2,
  user: 1,
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'User',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Full control, including managing admins and system settings.',
  admin: 'Manages standard users. Cannot manage admins or super admins.',
  user: 'Standard app access. No admin panel.',
};

export type Permission =
  | 'admin:access' // may open the admin panel at all
  | 'users:read'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  | 'admins:manage' // create/edit/delete admins & super_admins
  | 'settings:manage';

const PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'admin:access',
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'admins:manage',
    'settings:manage',
  ],
  admin: ['admin:access', 'users:read', 'users:create', 'users:update', 'users:delete'],
  user: [],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isAdminRole(role: Role): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * Can `actor` manage a target that currently has (or should become) `targetRole`?
 * Strictly-higher-rank rule — this is what separates admin from super_admin.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

/** Which roles is `actor` allowed to assign when creating/editing a user? */
export function assignableRoles(actorRole: Role): Role[] {
  return ROLES.filter((r) => canManageRole(actorRole, r));
}
