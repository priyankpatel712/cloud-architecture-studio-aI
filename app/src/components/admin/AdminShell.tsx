'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Shield, LogOut, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { RoleBadge } from '@/components/admin/RoleBadge';
import { initialsOf } from '@/lib/initials';
import type { Role } from '@/lib/rbac';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/roles', label: 'Roles', icon: Shield },
];

function active(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: Role };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[var(--color-surface-variant)] bg-[var(--color-surface)] md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-[var(--color-surface-variant)] px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)]">
            <Shield size={17} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Admin Panel</p>
            <p className="text-[11px] text-[var(--color-text-secondary)]">Cloud Studio</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = active(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  on
                    ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <Icon size={18} /> {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--color-surface-variant)] p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
          >
            <ArrowLeft size={18} /> Back to Studio
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col md:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-surface-variant)] bg-[var(--color-surface)]/85 px-4 backdrop-blur-md sm:px-6">
          {/* mobile nav */}
          <nav className="flex items-center gap-1 md:hidden">
            {NAV.map(({ href, label, icon: Icon }) => {
              const on = active(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg',
                    on
                      ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                      : 'text-[var(--color-text-secondary)]'
                  )}
                >
                  <Icon size={18} />
                </Link>
              );
            })}
          </nav>
          <span className="hidden text-sm font-semibold text-[var(--color-text-primary)] md:block">
            User Management
          </span>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-[var(--color-text-primary)]">{user.name}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{user.email}</p>
            </div>
            <RoleBadge role={user.role} />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-on-primary)]">
              {initialsOf(user.name)}
            </div>
            <button
              onClick={logout}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-container)]"
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
