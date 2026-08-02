'use client';
import { Settings, LogOut, Boxes, Shield } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, isNavActive } from './nav-items';

/** Desktop navigation rail — hidden on mobile (MobileNav takes over there). */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="fixed top-0 left-0 z-50 hidden h-screen w-[72px] flex-col items-center border-r border-[var(--color-surface-variant)] bg-[var(--color-surface)] py-4 md:flex">
      <Link
        href="/"
        aria-label="Cloud Architecture Studio home"
        className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm transition-transform hover:scale-105"
      >
        <Boxes size={24} />
      </Link>

      <nav className="flex w-full flex-col items-center gap-1">
        {NAV_ITEMS.map(({ href, label, icon: IconCmp }) => {
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="group relative flex w-full flex-col items-center gap-1 py-1.5"
            >
              <span
                className={cn(
                  'flex h-9 w-14 items-center justify-center rounded-full transition-all',
                  active
                    ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                    : 'text-[var(--color-text-secondary)] group-hover:bg-[var(--color-surface-container-low)]'
                )}
              >
                <IconCmp size={20} strokeWidth={active ? 2.4 : 2} />
              </span>
              <span
                className={cn(
                  'text-[10px] font-medium leading-none',
                  active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1">
        <Link
          href="/admin"
          className="flex h-9 w-14 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
          aria-label="Admin panel"
          title="Admin panel"
        >
          <Shield size={20} />
        </Link>
        <Link
          href="/settings"
          className="flex h-9 w-14 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
          aria-label="Settings"
        >
          <Settings size={20} />
        </Link>
        <button
          className="flex h-9 w-14 items-center justify-center rounded-full text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-container)]"
          aria-label="Sign out"
        >
          <LogOut size={20} />
        </button>
      </div>
    </div>
  );
}
