'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';

const MAX_WIDTH = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: keyof typeof MAX_WIDTH;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative z-10 w-full ${MAX_WIDTH[size]} animate-rise overflow-hidden rounded-t-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-2xl sm:rounded-3xl`}>
        <div className="flex items-center justify-between border-b border-[var(--color-surface-variant)] p-5">
          <h2 className="font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-text-primary)]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
