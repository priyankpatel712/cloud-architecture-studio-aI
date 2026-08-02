import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { pricingEstimateSchema } from '@/lib/schemas';
import { priceNodes } from '@/lib/pricing';

export const runtime = 'nodejs';

/**
 * POST /api/pricing/estimate equivalent (contracts/pricing.md — mounted at /api/pricing).
 * Per-service + totals with `basis` exact/indicative (FR-019, FR-021). The client may
 * post a single node for instant feedback on a config change (FR-020).
 */
export async function POST(req: Request) {
  try {
    await requireVerified();
    const body = await parseBody(req, pricingEstimateSchema);
    const result = await priceNodes(body.nodes, body.defaultRegion ?? 'us-east-1');
    return NextResponse.json(result);
  } catch (e) {
    return fail(e);
  }
}
