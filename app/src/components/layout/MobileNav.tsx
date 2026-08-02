'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, isNavActive } from './nav-items';

/** Bottom tab bar for small screens — the Sidebar is hidden below md. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch justify-around border-t border-[var(--color-surface-variant)] bg-[var(--color-surface)]/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map(({ href, label, icon: IconCmp }) => {
        const active = isNavActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
          >
            <span
              className={cn(
                'flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                active
                  ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                  : 'text-[var(--color-text-secondary)]'
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
  );
}
