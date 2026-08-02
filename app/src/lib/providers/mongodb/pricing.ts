import 'server-only';
import type { PriceQuote, PricingAdapter } from '@/lib/providers/types';
import { MONGODB_SERVICES } from '@/lib/providers/mongodb/catalog';

/**
 * MongoDB Atlas pricing adapter (FR-019, research R3).
 * Prices come from the official Atlas tier price table behind this adapter; until a
 * live Atlas pricing source is wired the figures are labelled `indicative` (FR-021)
 * rather than presented as exact. USD; region taken from the cluster's own config
 * (Clarification 2026-07-06 — per-node region).
 */
export const mongodbPricing: PricingAdapter = {
  async estimate(serviceId, config, defaultRegion): Promise<PriceQuote> {
    const region = String(config.region ?? '').trim() || defaultRegion || 'us-east-1';
    const def = MONGODB_SERVICES.find((s) => s.id === serviceId);
    // Dynamic (AI-added) services carry their indicative price in config.monthlyCost.
    const dynamicMonthly = parseFloat(String(config.monthlyCost ?? '')) || 0;
    return { monthly: def ? def.estimate(config) : dynamicMonthly, basis: 'indicative', region };
  },
};
