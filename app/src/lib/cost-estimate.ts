import 'server-only';
import type { HydratedDocument } from 'mongoose';
import { Architecture } from '@/lib/models/Architecture';
import { CostEstimate } from '@/lib/models/CostEstimate';
import { CostEstimateOverride } from '@/lib/models/CostEstimateOverride';
import type { ProjectDoc } from '@/lib/models/Project';
import { priceNodes } from '@/lib/pricing';
import {
  applyQuantityOverrides,
  mergeOverrides,
  type MergedEstimate,
  type OverrideRecord,
  type PricableNode,
} from '@/lib/generate/overrides';
import type { ProviderId, ServiceConfig } from '@/lib/providers/types';

/**
 * Shared estimate recomputation with overrides (003 FR-010/FR-012/FR-013,
 * research R5). Every write path that can change the estimate — inline override
 * PATCH, chat turns, direct architecture saves — calls this so the persisted
 * CostEstimate snapshot, the project's denormalized total, and the returned
 * per-line overridden/stale flags always agree.
 *
 * Reads Architecture (to know what to price); never writes it (FR-015 — the
 * write-side decoupling lives in overrides.ts / cost-orchestrator.ts, which
 * cannot touch the model at all). Orphaned overrides — whose node no longer
 * exists — are pruned here (FR-013), which covers node removals from every
 * path (chat edits, canvas edits, attach merges).
 */
export async function recomputeProjectEstimate(
  project: HydratedDocument<ProjectDoc>,
  opts: { persist?: boolean } = {}
): Promise<MergedEstimate> {
  const persist = opts.persist !== false;
  const arch = await Architecture.findOne({ projectId: project._id }).lean();
  const nodes: PricableNode[] = (arch?.nodes ?? []).map((n) => ({
    nodeId: n.nodeId,
    serviceId: n.serviceId,
    provider: n.provider as ProviderId,
    config: (n.config ?? {}) as ServiceConfig,
  }));

  const allOverrides = await CostEstimateOverride.find({ projectId: project._id }).lean();
  const nodeIds = new Set(nodes.map((n) => n.nodeId));
  const orphaned = allOverrides.filter((o) => !nodeIds.has(o.nodeId));
  // Prune orphans only on write paths — a read-only viewer's GET never writes.
  if (persist && orphaned.length > 0) {
    await CostEstimateOverride.deleteMany({
      projectId: project._id,
      nodeId: { $in: orphaned.map((o) => o.nodeId) },
    });
  }
  const overrides: OverrideRecord[] = allOverrides
    .filter((o) => nodeIds.has(o.nodeId))
    .map((o) => ({
      nodeId: o.nodeId,
      quantityOverride: o.quantityOverride ?? null,
      totalCostOverride: o.totalCostOverride ?? null,
      configSnapshot: (o.configSnapshot ?? {}) as ServiceConfig,
    }));

  // Official pricing chain over effective configs (quantity overrides applied to
  // copies — the stored Architecture configs are untouched), then merge flat
  // total-cost overrides + flags.
  const priced = await priceNodes(applyQuantityOverrides(nodes, overrides), project.defaultRegion);
  const merged = mergeOverrides(priced.perService, overrides, nodes);

  if (persist) {
    await CostEstimate.create({
      ownerId: project.ownerId,
      projectId: project._id,
      monthly: merged.monthly,
      annual: merged.annual,
      perService: merged.perService.map((l) => ({
        nodeId: l.nodeId ?? '',
        serviceId: l.serviceId,
        cost: l.cost,
        basis: l.basis,
        region: l.region,
        overridden: l.overridden,
        stale: l.stale,
      })),
      basis: merged.basis,
    });

    project.currentEstimateMonthly = merged.monthly;
    await project.save();
  }

  return merged;
}
