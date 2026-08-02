import { Check, Minus, ShieldCheck, UserCog, User as UserIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, can, type Permission, type Role } from '@/lib/rbac';

const CAPS: { key: Permission; label: string }[] = [
  { key: 'admin:access', label: 'Access admin panel' },
  { key: 'users:read', label: 'View users' },
  { key: 'users:create', label: 'Create users' },
  { key: 'users:update', label: 'Edit users' },
  { key: 'users:delete', label: 'Delete users' },
  { key: 'admins:manage', label: 'Manage admins & super admins' },
  { key: 'settings:manage', label: 'Manage system settings' },
];

const ROLE_ICON: Record<Role, typeof ShieldCheck> = {
  super_admin: ShieldCheck,
  admin: UserCog,
  user: UserIcon,
};

export default function RolesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-rise">
      <PageHeader
        eyebrow="Access control"
        title="Roles & permissions"
        subtitle="Super Admin and Admin are separate roles. An actor can only manage roles strictly below their own — so admins manage standard users, never other admins."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ROLES.map((role) => {
          const Icon = ROLE_ICON[role];
          return (
            <div
              key={role}
              className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm"
            >
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]">
                <Icon size={20} />
              </div>
              <p className="font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-text-primary)]">
                {ROLE_LABELS[role]}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          );
        })}
      </div>

      {/* Permission matrix */}
      <div className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-surface-variant)] text-left">
                <th className="p-4 font-medium text-[var(--color-text-secondary)]">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="p-4 text-center font-medium text-[var(--color-text-primary)]">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((cap) => (
                <tr key={cap.key} className="border-b border-[var(--color-surface-variant)] last:border-0">
                  <td className="p-4 text-[var(--color-text-primary)]">{cap.label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="p-4 text-center">
                      {can(r, cap.key) ? (
                        <Check size={17} className="mx-auto text-[#1e8e3e]" />
                      ) : (
                        <Minus size={17} className="mx-auto text-[var(--color-outline-variant)]" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
