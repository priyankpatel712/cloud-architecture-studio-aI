'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PencilLine, RotateCcw, TriangleAlert } from 'lucide-react';
import { resolveServiceDef, formatUSD } from '@/lib/catalog';
import { cn } from '@/lib/cn';

/**
 * CostPanel — the editable cost estimate (003 US3; FR-008–FR-014).
 * Per-line breakdown with inline overrides: quantity (only for services that
 * declare a quantityField) and fixed monthly total. Overridden lines are marked
 * "manual"; a line whose service config changed after the override was set is
 * flagged "outdated" until confirmed or reset (FR-012). Read-only collaborators
 * see override state but get no inputs (FR-014). All math is server-side —
 * this panel only PATCHes /cost-overrides and renders the returned estimate.
 */

interface EstimateLine {
  nodeId?: string;
  serviceId: string;
  cost: number;
  basis: 'exact' | 'indicative';
  overridden: boolean;
  stale: boolean;
}
interface Estimate {
  monthly: number;
  annual: number;
  perService: EstimateLine[];
  basis: 'exact' | 'indicative';
}
interface OverrideState {
  nodeId: string;
  quantityOverride: number | null;
  totalCostOverride: number | null;
  source: 'inline' | 'chat';
}

export function CostPanel({
  projectId,
  refreshKey = 0,
  focusNodeId = null,
  className,
}: {
  projectId: string;
  /** bump to refetch — e.g. after a save or chat turn changed the architecture */
  refreshKey?: number;
  /** auto-expand (and scroll to) this service's pricing editor on load */
  focusNodeId?: string | null;
  className?: string;
}) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [overrides, setOverrides] = useState<OverrideState[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  // The panel remounts each time its modal opens, so seeding from focusNodeId
  // is enough to auto-expand the clicked service's pricing editor.
  const [openNode, setOpenNode] = useState<string | null>(focusNodeId);
  const scrolledToFocus = useRef(false);
  const [pending, setPending] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [costInput, setCostInput] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/cost-overrides`);
      if (!res.ok) return;
      const data = await res.json();
      setEstimate(data.estimate);
      setOverrides(data.overrides);
      setCanEdit(data.canEdit);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial load + silent refetch on refreshKey bumps (no spinner flash —
  // `loading` starts true and only gates the very first fetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load, refreshKey]);


  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setPending(true);
      setInputError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/cost-overrides`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          // FR-011: specific message; the previous value stays in effect.
          setInputError(data.error ?? 'Invalid value.');
          return false;
        }
        setEstimate(data.estimate);
        // Re-sync the raw override records (source labels etc.).
        await load();
        return true;
      } catch {
        setInputError('Could not reach the server.');
        return false;
      } finally {
        setPending(false);
      }
    },
    [projectId, load]
  );

  if (loading) {
    return (
      <p className={cn('flex items-center gap-2 p-3 text-xs text-[var(--color-text-secondary)]', className)}>
        <Loader2 size={13} className="animate-spin" /> Loading estimate…
      </p>
    );
  }
  if (!estimate || estimate.perService.length === 0) {
    return (
      <p className={cn('p-3 text-xs text-[var(--color-text-secondary)]', className)}>
        No priced services yet — generate or build an architecture first.
      </p>
    );
  }

  const overrideFor = (nodeId?: string) => overrides.find((o) => o.nodeId === nodeId);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ul className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {estimate.perService.map((line) => {
          const svc = resolveServiceDef(line.serviceId);
          const o = overrideFor(line.nodeId);
          const qf = svc.quantityField ?? null;
          const open = openNode === line.nodeId;
          return (
            <li
              key={line.nodeId ?? line.serviceId}
              ref={(el) => {
                // Bring the canvas-clicked service into view once, on first render.
                if (el && !scrolledToFocus.current && focusNodeId && line.nodeId === focusNodeId) {
                  scrolledToFocus.current = true;
                  el.scrollIntoView({ block: 'center' });
                }
              }}
              className="rounded-xl bg-[var(--color-surface-container-low)]"
            >
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => {
                  setInputError(null);
                  setQtyInput(o?.quantityOverride != null ? String(o.quantityOverride) : '');
                  setCostInput(o?.totalCostOverride != null ? String(o.totalCostOverride) : '');
                  setOpenNode(open ? null : (line.nodeId ?? null));
                }}
                aria-expanded={open}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">
                  {svc?.name ?? line.serviceId}
                </span>
                {line.overridden && (
                  <span
                    className="flex items-center gap-0.5 rounded-full bg-[#e8def8] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#4a4458]"
                    title={`Manual override (${o?.source === 'chat' ? 'set via chat' : 'set inline'})`}
                  >
                    <PencilLine size={9} /> manual
                  </span>
                )}
                {line.stale && (
                  <span
                    className="flex items-center gap-0.5 rounded-full bg-[#fef7e0] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#7a5900]"
                    title="The service's configuration changed after this override was set — confirm or reset it (FR-012)"
                  >
                    <TriangleAlert size={9} /> outdated
                  </span>
                )}
                <span className="font-mono text-xs font-semibold text-[var(--color-text-primary)]">
                  {formatUSD(line.cost)}
                </span>
              </button>

              {open && line.nodeId && (
                <div className="space-y-2 border-t border-[var(--color-surface-variant)] px-3 py-2">
                  {canEdit ? (
                    <>
                      {qf && (
                        <label className="block">
                          <span className="mb-0.5 block text-[10px] text-[var(--color-text-secondary)]">
                            Quantity override ({qf}) — recomputed via official pricing; wins over a fixed total
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={qtyInput}
                            disabled={pending}
                            onChange={(e) => setQtyInput(e.target.value)}
                            className="h-8 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-2 font-mono text-xs"
                            aria-label="Quantity override"
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] text-[var(--color-text-secondary)]">
                          Fixed monthly cost override (USD) — e.g. a negotiated rate
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={costInput}
                          disabled={pending}
                          onChange={(e) => setCostInput(e.target.value)}
                          className="h-8 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-2 font-mono text-xs"
                          aria-label="Fixed monthly cost override"
                        />
                      </label>
                      {inputError && (
                        <p className="text-[10px] font-medium text-[var(--color-error)]">{inputError}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          disabled={pending || (qtyInput === '' && costInput === '')}
                          onClick={() => {
                            const body: Record<string, unknown> = { nodeId: line.nodeId };
                            if (qtyInput !== '') body.quantityOverride = Number(qtyInput);
                            if (costInput !== '') body.totalCostOverride = Number(costInput);
                            void patch(body);
                          }}
                          className="rounded-lg bg-[var(--color-primary)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                        >
                          {line.stale ? 'Confirm override' : 'Apply override'}
                        </button>
                        {line.overridden && (
                          <button
                            disabled={pending}
                            onClick={() => void patch({ nodeId: line.nodeId, clear: true })}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-high)]"
                            title="Reset to the system-computed value"
                          >
                            <RotateCcw size={11} /> Reset
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-[var(--color-text-secondary)]">
                      {line.overridden
                        ? `Manually overridden (${o?.source === 'chat' ? 'via chat' : 'inline'}) — view only.`
                        : 'View only — you need edit access to override this line.'}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-[var(--color-surface-variant)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          Estimate total
        </span>
        <span className="font-mono text-sm font-bold text-[var(--color-text-primary)]">
          {formatUSD(estimate.monthly)}
          <span className="text-[10px] font-normal text-[var(--color-text-secondary)]">/mo · {formatUSD(estimate.annual)}/yr</span>
        </span>
      </div>
    </div>
  );
}
