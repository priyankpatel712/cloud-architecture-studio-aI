'use client';
import { Search, Plus, Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AccountMenu } from '@/components/layout/AccountMenu';

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between gap-3 border-b border-[var(--color-surface-variant)] bg-[var(--color-surface)]/85 px-4 backdrop-blur-md sm:px-6 md:h-[72px] lg:px-8">
      <div className="hidden max-w-md flex-1 sm:block">
        <div className="group relative">
          <Search className="pointer-events-none absolute inset-y-0 left-3.5 my-auto h-4 w-4 text-[var(--color-text-secondary)] group-focus-within:text-[var(--color-primary)]" />
          <input
            type="text"
            aria-label="Search"
            className="h-10 w-full rounded-full border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] transition-all focus:border-[var(--color-primary)] focus:bg-[var(--color-surface-container-lowest)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25"
            placeholder="Search projects, services, regions…"
          />
        </div>
      </div>

      {/* Brand mark for mobile, where the sidebar is hidden */}
      <span className="font-[family-name:var(--font-headline-sm)] text-base font-bold tracking-tight text-[var(--color-text-primary)] sm:hidden">
        Cloud Studio
      </span>

      <div className="flex items-center gap-2 sm:gap-3">
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/projects/new">
            <Plus size={16} /> New architecture
          </Link>
        </Button>

        <button
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
          aria-label="Notifications"
        >
          <Bell size={19} />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[var(--color-error)] ring-2 ring-[var(--color-surface)]" />
        </button>

        <div className="border-l border-[var(--color-surface-variant)] pl-2 sm:pl-3">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
