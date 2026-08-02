'use client';
import { Trash2, SlidersHorizontal, Wallet, MousePointer2 } from 'lucide-react';
import { ServiceIcon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Input';
import { resolveServiceDef, formatUSD } from '@/lib/catalog';
import { cn } from '@/lib/cn';

export interface CanvasNode {
  id: string;
  serviceId: string;
  config: Record<string, string | number>;
  cost: number;
  /** user-facing rename; catalog identity + pricing unchanged (002 FR-013) */
  displayName?: string;
  /** identity metadata for AI-added dynamic services (no curated catalog entry) */
  provider?: 'aws' | 'mongodb' | 'system';
  category?: string;
}

export function Inspector({
  selected,
  nodes,
  onConfigChange,
  onDelete,
  onRename,
  costPanel,
  className,
}: {
  selected: CanvasNode | null;
  nodes: CanvasNode[];
  onConfigChange: (id: string, key: string, value: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, displayName: string) => void;
  /** 003 US3 — the editable per-line estimate (CostPanel), rendered under the summary */
  costPanel?: React.ReactNode;
  className?: string;
}) {
  const total = nodes.reduce((s, n) => s + n.cost, 0);
  const svc = selected ? resolveServiceDef(selected.serviceId, selected) : null;

  return (
    <aside
      className={cn(
        'w-80 shrink-0 flex-col border-l border-[var(--color-surface-variant)] bg-[var(--color-surface)]',
        className ?? 'flex'
      )}
    >
      {/* Config */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {svc && selected ? (
          <div className="p-4">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <ServiceIcon def={svc} size={36} className="shrink-0" />
                <div className="min-w-0">
                  {onRename ? (
                    <input
                      defaultValue={selected.displayName || svc.name}
                      key={selected.id}
                      placeholder={svc.name}
                      aria-label="Rename service"
                      onBlur={(e) => onRename(selected.id, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className="w-full truncate bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none focus:underline"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {selected.displayName || svc.name}
                    </p>
                  )}
                  <p className="text-[11px] text-[var(--color-text-secondary)]">{svc.blurb}</p>
                </div>
              </div>
              <button
                onClick={() => onDelete(selected.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-container)]"
                aria-label="Remove service"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              <SlidersHorizontal size={13} /> Configuration
            </div>

            <div className="space-y-3">
              {svc.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                    {f.label}
                    {f.unit && <span className="font-mono">{f.unit}</span>}
                  </span>
                  {f.type === 'select' ? (
                    <Select
                      value={String(selected.config[f.key])}
                      onChange={(e) => onConfigChange(selected.id, f.key, e.target.value)}
                    >
                      {f.options!.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <input
                      type={f.type}
                      value={String(selected.config[f.key])}
                      min={f.min}
                      max={f.max}
                      onChange={(e) => onConfigChange(selected.id, f.key, e.target.value)}
                      className="h-10 w-full rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-4 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25"
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-[var(--color-surface-container-low)] px-4 py-3">
              <span className="text-sm text-[var(--color-text-secondary)]">This service</span>
              <span className="font-mono text-base font-semibold text-[var(--color-text-primary)]">
                {formatUSD(selected.cost)}
                <span className="text-xs font-normal text-[var(--color-text-secondary)]">/mo</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
              <MousePointer2 size={22} />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No service selected</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Select a node to configure it, or drag one from the palette.
            </p>
          </div>
        )}
      </div>

      {/* Cost summary */}
      <div className="border-t border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
          <Wallet size={13} /> Estimated monthly cost
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {formatUSD(total)}
          </span>
          <span className="text-sm text-[var(--color-text-secondary)]">/ month</span>
        </div>
        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
          ≈ {formatUSD(total * 12)} / year · {nodes.length} services
        </p>
        <p className="mt-2 text-[10px] leading-tight text-[var(--color-text-secondary)]">
          Indicative estimate. Live figures come from the AWS Pricing API and Atlas pricing.
        </p>
        {costPanel && (
          <div className="mt-2 max-h-72 overflow-hidden rounded-2xl border border-[var(--color-surface-variant)]">
            {costPanel}
          </div>
        )}
      </div>
    </aside>
  );
}
