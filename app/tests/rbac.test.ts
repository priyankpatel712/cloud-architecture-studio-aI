import { describe, expect, it } from 'vitest';
import { can, canManageRole, assignableRoles, isAdminRole } from '@/lib/rbac';

describe('rbac (FR-007–010)', () => {
  it('enforces the strictly-higher-rank management rule', () => {
    expect(canManageRole('super_admin', 'admin')).toBe(true);
    expect(canManageRole('super_admin', 'user')).toBe(true);
    expect(canManageRole('admin', 'user')).toBe(true);
    // peers and upward are never manageable
    expect(canManageRole('super_admin', 'super_admin')).toBe(false);
    expect(canManageRole('admin', 'admin')).toBe(false);
    expect(canManageRole('admin', 'super_admin')).toBe(false);
    expect(canManageRole('user', 'user')).toBe(false);
    expect(canManageRole('user', 'admin')).toBe(false);
  });

  it('keeps the admin panel closed to standard users', () => {
    expect(can('user', 'admin:access')).toBe(false);
    expect(can('admin', 'admin:access')).toBe(true);
    expect(can('super_admin', 'admin:access')).toBe(true);
  });

  it('reserves admin management and settings for super_admin', () => {
    expect(can('admin', 'admins:manage')).toBe(false);
    expect(can('admin', 'settings:manage')).toBe(false);
    expect(can('super_admin', 'admins:manage')).toBe(true);
  });

  it('computes assignable roles from the rank rule', () => {
    expect(assignableRoles('super_admin')).toEqual(['admin', 'user']);
    expect(assignableRoles('admin')).toEqual(['user']);
    expect(assignableRoles('user')).toEqual([]);
  });

  it('classifies admin roles', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('super_admin')).toBe(true);
    expect(isAdminRole('user')).toBe(false);
  });
});
