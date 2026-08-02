'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Settings, Shield, LogOut, ChevronDown } from 'lucide-react';
import { initialsOf } from '@/lib/initials';
import { isAdminRole, ROLE_LABELS, type Role } from '@/lib/rbac';

interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-[var(--color-surface-container-low)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-on-primary)]">
          {me ? initialsOf(me.name) : '…'}
        </span>
        <div className="hidden text-left text-sm leading-tight md:block">
          <p className="font-medium text-[var(--color-text-primary)]">{me?.name ?? 'Loading…'}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{me ? ROLE_LABELS[me.role] : ''}</p>
        </div>
        <ChevronDown size={16} className="hidden text-[var(--color-text-secondary)] md:block" />
      </button>

      {open && me && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-lg">
          <div className="border-b border-[var(--color-surface-variant)] p-3">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{me.name}</p>
            <p className="truncate text-xs text-[var(--color-text-secondary)]">{me.email}</p>
          </div>
          <div className="p-1.5">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
            >
              <Settings size={16} /> Settings
            </Link>
            {isAdminRole(me.role) && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
              >
                <Shield size={16} /> Admin panel
              </Link>
            )}
            <button
              onClick={logout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-container)]"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
