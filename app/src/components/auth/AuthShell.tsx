'use client';
import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Boxes, Loader2 } from 'lucide-react';

const noopSubscribe = () => () => {};

/** Centered card used by all auth pages (login/register/forgot/reset). */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Password-manager extensions (Keeper, LastPass, …) inject elements next to
  // email/password inputs as soon as they appear in the SSR HTML, which breaks
  // hydration. Keeping the form out of the server HTML and mounting it client-
  // side means the extension only ever touches React-owned DOM.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm"
          >
            <Boxes size={26} />
          </Link>
          <h1 className="font-[family-name:var(--font-headline-lg)] text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
        </div>
        {mounted ? children : <Loader2 className="mx-auto animate-spin text-[var(--color-primary)]" />}
        {footer && <div className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-[var(--color-error-container)] px-3 py-2.5 text-sm text-[var(--color-on-error-container)]">
      {message}
    </div>
  );
}
