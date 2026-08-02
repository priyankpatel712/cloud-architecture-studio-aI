import 'server-only';
import type { PriceQuote, PricingAdapter, ServiceConfig } from '@/lib/providers/types';
import { AWS_SERVICES } from '@/lib/providers/aws/catalog';
import { callServerTool, resolveMcpServer } from '@/lib/providers/mcp-client';

/**
 * AWS pricing adapter (FR-019, research R3, constitution v1.1.0).
 *
 * Source chain, first success wins:
 *  1. Official AWS cost MCP  (registry: aws/pricing) — primary source.
 *  2. AWS Price List API     (@aws-sdk/client-pricing) — approved direct fallback.
 *  3. Catalog estimate       — clearly-labelled `indicative` (FR-021).
 *
 * All figures are USD; each service is priced in its own configured region,
 * falling back to the project default (Clarification 2026-07-06). `basis: 'exact'`
 * is set only when the whole quote came from an official source (SC-002).
 */

const HOURS = 730;
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { quote: PriceQuote; at: number }>();

/** Price List API uses human location names, not region codes. */
const REGION_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'EU (Ireland)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
};

function nodeRegion(config: ServiceConfig, defaultRegion: string): string {
  const r = String(config.region ?? '').trim();
  return r || defaultRegion || 'us-east-1';
}

function num(v: string | number | undefined, fallback = 0): number {
  return typeof v === 'number' ? v : v ? parseFloat(String(v)) || fallback : fallback;
}

function indicative(serviceId: string, config: ServiceConfig, region: string): PriceQuote {
  const def = AWS_SERVICES.find((s) => s.id === serviceId);
  // Dynamic (AI-added) services carry their indicative price in config.monthlyCost.
  return { monthly: def ? def.estimate(config) : num(config.monthlyCost, 0), basis: 'indicative', region };
}

/**
 * Extract the first positive OnDemand USD rate from a get_pricing response
 * (JSON from awslabs.aws-pricing-mcp-server: `pricePerUnit: { USD: "0.096" }`),
 * with a regex fallback for any text-shaped answer.
 */
function extractUsdRate(text: string): number | null {
  try {
    const doc: unknown = JSON.parse(text);
    if ((doc as { status?: string })?.status === 'error') return null;
    const stack: unknown[] = [doc];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      for (const [k, v] of Object.entries(cur)) {
        if (k === 'USD') {
          const n = parseFloat(String(v));
          if (Number.isFinite(n) && n > 0) return n;
        } else if (v && typeof v === 'object') {
          stack.push(v);
        }
      }
    }
    return null;
  } catch {
    const m = /"USD"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/.exec(text) ?? /(?:USD|\$)\s*([0-9]+(?:\.[0-9]+)?)/.exec(text);
    return m ? parseFloat(m[1]) : null;
  }
}

/** 1) Official AWS cost MCP (awslabs.aws-pricing-mcp-server): OnDemand hourly rate. */
async function viaCostMcp(serviceId: string, config: ServiceConfig, region: string): Promise<number | null> {
  const server = resolveMcpServer('aws', 'pricing');
  if (!server || serviceId !== 'aws-ec2') return null;
  const text = await callServerTool(server, {
    service_code: 'AmazonEC2',
    region,
    // get_pricing takes Price List-style filters: [{ Field, Value, Type }]
    filters: [
      { Field: 'instanceType', Value: String(config.instance ?? 'm5.large'), Type: 'EQUALS' },
      { Field: 'operatingSystem', Value: 'Linux', Type: 'EQUALS' },
      { Field: 'tenancy', Value: 'Shared', Type: 'EQUALS' },
      { Field: 'preInstalledSw', Value: 'NA', Type: 'EQUALS' },
      { Field: 'capacitystatus', Value: 'Used', Type: 'EQUALS' },
    ],
    max_results: 1,
    output_options: { pricing_terms: ['OnDemand'] },
  });
  const hourly = extractUsdRate(text);
  if (hourly == null) return null;
  return hourly * HOURS * Math.max(1, num(config.count, 1));
}

/** 2) AWS Price List API fallback: on-demand Linux instance-hours + gp3 GB-month. */
async function viaPriceList(serviceId: string, config: ServiceConfig, region: string): Promise<number | null> {
  if (serviceId !== 'aws-ec2') return null; // reference implementation; others stay indicative
  const location = REGION_LOCATION[region];
  if (!location) return null;

  const { PricingClient, GetProductsCommand } = await import('@aws-sdk/client-pricing');
  const client = new PricingClient({ region: 'us-east-1' }); // Pricing API lives in us-east-1
  const res = await client.send(
    new GetProductsCommand({
      ServiceCode: 'AmazonEC2',
      MaxResults: 1,
      Filters: [
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: String(config.instance ?? 'm5.large') },
        { Type: 'TERM_MATCH', Field: 'location', Value: location },
        { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
        { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
        { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
        { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
      ],
    })
  );
  const raw = res.PriceList?.[0];
  if (!raw) return null;
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const onDemand = doc?.terms?.OnDemand ?? {};
  for (const term of Object.values<Record<string, unknown>>(onDemand)) {
    const dims = (term as { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }).priceDimensions ?? {};
    for (const dim of Object.values(dims)) {
      const usd = parseFloat(dim.pricePerUnit?.USD ?? '');
      if (Number.isFinite(usd) && usd > 0) {
        // Storage remains indicative — the composed quote is only 'exact' when every
        // component is official, so EC2-with-EBS reports the stricter basis upstream.
        return usd * HOURS * Math.max(1, num(config.count, 1));
      }
    }
  }
  return null;
}

export const awsPricing: PricingAdapter = {
  async estimate(serviceId, config, defaultRegion): Promise<PriceQuote> {
    const region = nodeRegion(config, defaultRegion);
    const key = `${serviceId}|${region}|${JSON.stringify(config)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.quote;

    let quote: PriceQuote;
    try {
      const officialCompute = (await viaCostMcp(serviceId, config, region)) ?? (await viaPriceList(serviceId, config, region));
      if (officialCompute !== null) {
        const storage = num(config.storage, 0) * 0.08; // EBS component, indicative
        quote = {
          monthly: officialCompute + storage,
          basis: storage > 0 ? 'indicative' : 'exact',
          region,
        };
      } else {
        quote = indicative(serviceId, config, region);
      }
    } catch (e) {
      console.warn(`[pricing:aws] official sources unavailable for ${serviceId}:`, e instanceof Error ? e.message : e);
      quote = indicative(serviceId, config, region);
    }

    cache.set(key, { quote, at: Date.now() });
    return quote;
  },
};
