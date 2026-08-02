'use client';
import { useEffect, useRef } from 'react';

/**
 * Per-element-type context menu (002 FR-011, contracts/canvas-interactions.md).
 * A positioned panel keyed by element type; closes on outside click or Escape.
 */

export type ContextMenuTarget =
  | { kind: 'canvas'; x: number; y: number }
  | { kind: 'service'; id: string; x: number; y: number }
  | { kind: 'connection'; id: string; x: number; y: number }
  | { kind: 'container'; id: string; x: number; y: number }
  | { kind: 'annotation'; id: string; x: number; y: number };

export interface MenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function CanvasContextMenu({
  screenPosition,
  actions,
  onClose,
}: {
  screenPosition: { x: number; y: number };
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: screenPosition.x, top: screenPosition.y }}
      className="absolute z-50 w-48 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg"
    >
      {actions.map((a) => (
        <button
          key={a.label}
          role="menuitem"
          disabled={a.disabled}
          onClick={() => {
            a.onSelect();
            onClose();
          }}
          className={`flex w-full items-center rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-[var(--color-surface-container-low)] disabled:opacity-40 ${
            a.destructive ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
