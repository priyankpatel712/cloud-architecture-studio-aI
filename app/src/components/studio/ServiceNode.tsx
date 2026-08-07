import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink } from 'lucide-react';
import { ServiceIcon } from '@/components/ui/Icon';
import { resolveServiceDef, formatUSD } from '@/lib/catalog';
import { EDGE_COLORS, type EdgeColor, type FormatRule } from '@/lib/canvas/model';
import { evaluateFormatRules } from '@/lib/canvas/conditional-format';

export interface ServiceNodeData {
  serviceId: string;
  config: Record<string, string | number>;
  cost: number;
  /** user-facing rename; catalog identity + pricing unchanged (002 FR-013) */
  displayName?: string;
  /** identity metadata for AI-added dynamic services (no curated catalog entry) */
  provider?: 'aws' | 'mongodb' | 'system';
  category?: string;
  /** 007 2.3 — optional user accent override (constrained token) */
  accent?: EdgeColor;
  /** Lucid-parity hotspot: external URL opened from the node */
  link?: string;
  [key: string]: unknown;
}

const PROVIDER_BADGE: Record<string, string> = { aws: 'AWS', mongodb: 'Atlas', system: 'System' };

const handleClass =
  '!h-2.5 !w-2.5 !border-2 !border-[var(--color-surface)] !bg-[var(--color-outline)]';

/**
 * One connection point per side. All four are `type="source"` — the canvas
 * runs in ConnectionMode.Loose, where a source handle both starts AND receives
 * connections, so any side works in either direction. The handle ids are the
 * persisted side names from lib/canvas/model.ts (HANDLE_SIDES): documentToFlow
 * defaults legacy edges to right → left, which is exactly where the only two
 * handles used to sit, so nothing previously drawn moves.
 */
const HANDLES: { id: string; position: Position }[] = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

/** `onRename`/`formatRules` are injected by Canvas's nodeTypes wrapper — not part of React Flow's NodeProps. */
function ServiceNodeImpl({ id, data, selected, onRename, formatRules }: NodeProps & { onRename?: (id: string, name: string) => void; formatRules?: FormatRule[] }) {
  const d = data as ServiceNodeData;
  // Curated catalog entry, or a synthesized def for AI-added dynamic services —
  // a node is never invisible just because the catalog doesn't know its id.
  const svc = resolveServiceDef(d.serviceId, d);
  const [editing, setEditing] = useState(false);
  // Conditional formatting (Lucid-parity): a matching data rule outranks the
  // manual accent — a live "over $100/mo" signal must not lose to a cosmetic
  // choice — and both rank above the catalog color.
  const ruleAccent = formatRules?.length
    ? evaluateFormatRules(
        { cost: d.cost, serviceId: d.serviceId, provider: svc.provider, category: svc.category, displayName: d.displayName },
        formatRules
      )
    : null;
  // 007 2.3 — user accent override: colors the border/ring and the icon tile
  // (the official vendor SVG can't be recolored, so an override switches to the
  // tinted glyph tile).
  const overridden = Boolean(ruleAccent) || (d.accent && d.accent !== 'default');
  const accent = ruleAccent ? EDGE_COLORS[ruleAccent] : overridden ? EDGE_COLORS[d.accent!] : svc.accent;
  const iconDef = overridden ? { ...svc, accent, iconUrl: undefined } : svc;

  return (
    <div
      className="w-[188px] rounded-2xl border bg-[var(--color-surface-container-lowest)] shadow-sm transition-shadow"
      style={{
        borderColor: selected || overridden ? accent : 'var(--color-surface-variant)',
        boxShadow: selected ? `0 0 0 2px ${accent}55` : undefined,
      }}
    >
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className={handleClass} />
      ))}
      <div className="flex items-center gap-2.5 p-3">
        <ServiceIcon def={iconDef} size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={d.displayName || svc.name}
              onBlur={(e) => {
                setEditing(false);
                onRename?.(id, e.target.value.trim());
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="nodrag w-full truncate bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none"
            />
          ) : (
            <p
              className="truncate text-sm font-semibold text-[var(--color-text-primary)]"
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (onRename) setEditing(true);
              }}
              title={onRename ? 'Double-click to rename' : undefined}
            >
              {d.displayName || svc.name}
            </p>
          )}
          <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{svc.category}</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-surface-variant)] px-3 py-2">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          {PROVIDER_BADGE[svc.provider] ?? svc.provider}
          {/* Lucid-parity hotspot: opens the node's linked URL (docs/console/runbook) */}
          {d.link && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(d.link, '_blank', 'noopener,noreferrer');
              }}
              title={d.link}
              aria-label={`Open link: ${d.link}`}
              className="nodrag flex h-4 w-4 items-center justify-center rounded text-[var(--color-primary)] hover:bg-[var(--color-surface-container-low)]"
            >
              <ExternalLink size={11} />
            </button>
          )}
        </span>
        {/* Generic design components have no SKU — omit the price badge entirely
            rather than showing a misleading $0 (mixed-mode research finding). */}
        {svc.provider !== 'system' && (
          <span className="font-mono text-xs font-semibold text-[var(--color-text-primary)]">
            {formatUSD(d.cost)}
            <span className="text-[10px] font-normal text-[var(--color-text-secondary)]">/mo</span>
          </span>
        )}
      </div>
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeImpl);
