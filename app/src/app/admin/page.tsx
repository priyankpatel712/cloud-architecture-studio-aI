import Link from 'next/link';
import { Users, ShieldCheck, UserCog, CircleSlash, ArrowUpRight } from 'lucide-react';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { PageHeader } from '@/components/layout/PageHeader';
import { getSession } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const session = await getSession();
  await connectDB();

  const [total, superAdmins, admins, standard, suspended] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: 'super_admin' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ status: 'suspended' }),
  ]);

  const stats = [
    { label: 'Total users', value: total, icon: Users },
    { label: ROLE_LABELS.super_admin, value: superAdmins, icon: ShieldCheck },
    { label: ROLE_LABELS.admin, value: admins, icon: UserCog },
    { label: 'Suspended', value: suspended, icon: CircleSlash },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-rise">
      <PageHeader
        eyebrow="Admin"
        title={`Welcome, ${session?.name?.split(' ')[0] ?? 'Admin'}`}
        subtitle="Manage users, roles, and access across the workspace."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">{s.label}</span>
              <s.icon size={18} className="text-[var(--color-primary)]" />
            </div>
            <p className="mt-3 font-mono text-3xl font-semibold text-[var(--color-text-primary)]">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/users"
          className="group flex items-center justify-between rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary-fixed-dim)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]">
              <Users size={22} />
            </div>
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">Manage users</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{standard} standard · {admins} admins</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-[var(--color-text-secondary)] transition-transform group-hover:translate-x-0.5" />
        </Link>

        <Link
          href="/admin/roles"
          className="group flex items-center justify-between rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary-fixed-dim)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]">
              <ShieldCheck size={22} />
            </div>
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">Roles &amp; permissions</p>
              <p className="text-sm text-[var(--color-text-secondary)]">Review what each role can do</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-[var(--color-text-secondary)] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
