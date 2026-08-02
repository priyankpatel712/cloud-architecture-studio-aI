import 'server-only';
import { getProvider } from '@/lib/providers/registry';
import type { CostBasis, ProviderId, ServiceConfig } from '@/lib/providers/types';

/**
 * Shared pricing service (FR-019–021): prices a set of nodes via each provider's
 * pricing adapter (official AWS cost MCP → Price List fallback → labelled
 * indicative). USD; per-node region with project default (Clarification).
 */

export interface PricedNode {
  nodeId?: string;
  serviceId: string;
  cost: number;
  basis: CostBasis;
  region: string;
}

export interface EstimateResult {
  monthly: number;
  annual: number;
  perService: PricedNode[];
  /** 'exact' only if every service was priced exactly (contracts/pricing.md) */
  basis: CostBasis;
}

export async function priceNodes(
  nodes: { nodeId?: string; serviceId: string; provider: ProviderId; config: ServiceConfig }[],
  defaultRegion = 'us-east-1'
): Promise<EstimateResult> {
  const perService = await Promise.all(
    nodes.map(async (n): Promise<PricedNode> => {
      const quote = await getProvider(n.provider).pricing.estimate(n.serviceId, n.config, defaultRegion);
      return {
        nodeId: n.nodeId,
        serviceId: n.serviceId,
        cost: Math.round(quote.monthly * 100) / 100,
        basis: quote.basis,
        region: quote.region,
      };
    })
  );
  const monthly = Math.round(perService.reduce((sum, s) => sum + s.cost, 0) * 100) / 100;
  return {
    monthly,
    annual: Math.round(monthly * 12 * 100) / 100,
    perService,
    basis: perService.length > 0 && perService.every((s) => s.basis === 'exact') ? 'exact' : 'indicative',
  };
}
