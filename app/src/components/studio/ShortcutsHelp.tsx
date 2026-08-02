'use client';
import { X } from 'lucide-react';

/**
 * In-app keyboard shortcut reference (002 FR-010), opened with `?` or a visible
 * toolbar entry point. Matches contracts/canvas-interactions.md exactly.
 */
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: [string, string][] = [
  ['Delete selection', 'Delete / Backspace'],
  ['Nudge / large nudge', 'Arrows / Shift+Arrows'],
  ['Select all', `${MOD}+A`],
  ['Copy / Paste / Duplicate', `${MOD}+C / ${MOD}+V / ${MOD}+D`],
  ['Undo / Redo', `${MOD}+Z / ${MOD}+Shift+Z`],
  ['Zoom in / out / fit', `${MOD}+= / ${MOD}+- / ${MOD}+0`],
  ['Pan', 'Space (hold) + drag; scroll to zoom'],
  ['Modifier-drag duplicate', isMac ? 'Option+drag' : 'Alt+drag'],
  ['Shortcut reference', '?'],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/25"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Keyboard shortcuts</h2>
          <button
            aria-label="Close shortcuts"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
          >
            <X size={14} />
          </button>
        </div>
        <ul className="space-y-1.5">
          {SHORTCUTS.map(([label, keys]) => (
            <li key={label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-[var(--color-text-secondary)]">{label}</span>
              <span className="rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-text-primary)]">
                {keys}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
