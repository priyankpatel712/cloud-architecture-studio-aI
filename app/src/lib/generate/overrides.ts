import { serviceById } from '@/lib/catalog';
import type { ServiceConfig, CostBasis } from '@/lib/providers/types';

/**
 * Pure cost-override merge/precedence/stale logic (003 research R5/R6/R11;
 * FR-008–FR-013).
 *
 * DECOUPLING (FR-015): this module MUST NOT import `@/lib/models/Architecture`
 * (or any Mongoose model). It receives plain node/override shapes and returns
 * plain adjusted shapes — it is structurally incapable of writing the diagram.
 *
 * Precedence (Clarification 2026-07-07): a line may carry both a quantity
 * override and a total-cost override; the quantity-derived price wins. The
 * quantity override is applied by re-pricing the node with the overridden
 * quantity substituted into a COPY of its config (the persisted Architecture
 * config is never touched), so callers price effective configs through the same
 * official chain as everything else. The total-cost override is applied after
 * pricing, only to lines with no active quantity override.
 */

export interface OverrideRecord {
  nodeId: string;
  quantityOverride: number | null;
  totalCostOverride: number | null;
  configSnapshot: ServiceConfig;
}

export interface PricableNode {
  nodeId: string;
  serviceId: string;
  provider: 'aws' | 'mongodb' | 'system';
  config: ServiceConfig;
}

export interface PricedLine {
  nodeId?: string;
  serviceId: string;
  cost: number;
  basis: CostBasis;
  region: string;
}

export interface MergedLine extends PricedLine {
  overridden: boolean;
  stale: boolean;
}

export interface MergedEstimate {
  monthly: number;
  annual: number;
  perService: MergedLine[];
  basis: CostBasis;
}

/** The service's declared quantity config key, if any (003 R9). */
export function quantityFieldOf(serviceId: string): string | null {
  return serviceById(serviceId)?.quantityField ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stable structural equality for config snapshots (key order independent). */
function sameConfig(a: ServiceConfig, b: ServiceConfig): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => String(a[k]) === String((b ?? {})[k]));
}

/**
 * Stage A — before pricing: substitute each active quantity override into a
 * copy of its node's config so the official pricing chain quotes the overridden
 * quantity. Nodes without a quantity override (or whose service declares no
 * quantityField) pass through unchanged. Never mutates the input nodes.
 */
export function applyQuantityOverrides(
  nodes: PricableNode[],
  overrides: OverrideRecord[]
): PricableNode[] {
  const byNode = new Map(overrides.map((o) => [o.nodeId, o]));
  return nodes.map((n) => {
    const o = byNode.get(n.nodeId);
    const qf = o && o.quantityOverride != null ? quantityFieldOf(n.serviceId) : null;
    if (!o || o.quantityOverride == null || !qf) return n;
    return { ...n, config: { ...n.config, [qf]: o.quantityOverride } };
  });
}

/**
 * Stage B — after pricing: apply total-cost overrides (only where no quantity
 * override is active — quantity wins), mark each line `overridden`, derive the
 * `stale` flag by comparing the override's configSnapshot to the node's LIVE
 * config (FR-012, research R11 — recomputed on every read, never persisted as
 * a drifting boolean), and recompute totals. `basis` keeps reporting what the
 * computed value came from, so a reset always reverts to a sensible number.
 */
export function mergeOverrides(
  perService: PricedLine[],
  overrides: OverrideRecord[],
  nodes: PricableNode[]
): MergedEstimate {
  const byNode = new Map(overrides.map((o) => [o.nodeId, o]));
  const nodeById = new Map(nodes.map((n) => [n.nodeId, n]));

  const merged: MergedLine[] = perService.map((line) => {
    const o = line.nodeId ? byNode.get(line.nodeId) : undefined;
    if (!o) return { ...line, overridden: false, stale: false };

    const node = line.nodeId ? nodeById.get(line.nodeId) : undefined;
    const stale = node ? !sameConfig(node.config, o.configSnapshot) : false;
    const quantityActive = o.quantityOverride != null && quantityFieldOf(line.serviceId) != null;

    // Quantity override: already priced via the effective config in Stage A.
    if (quantityActive) return { ...line, cost: round2(line.cost), overridden: true, stale };
    if (o.totalCostOverride != null) {
      return { ...line, cost: round2(o.totalCostOverride), overridden: true, stale };
    }
    // Degenerate record (both null) — treated as no override.
    return { ...line, overridden: false, stale: false };
  });

  const monthly = round2(merged.reduce((sum, l) => sum + l.cost, 0));
  return {
    monthly,
    annual: round2(monthly * 12),
    perService: merged,
    basis:
      merged.length > 0 && merged.every((l) => l.basis === 'exact') ? 'exact' : 'indicative',
  };
}
