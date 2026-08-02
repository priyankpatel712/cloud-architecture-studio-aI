import 'server-only';
import type { PriceQuote, PricingAdapter } from '@/lib/providers/types';

/**
 * Pricing adapter for the generic 'system' provider: generic design components
 * have no SKU and are not priced — the quote is $0 with basis 'exact' because
 * a zero contribution is definitional (by design), not an estimate. This keeps
 * a pure HLD/LLD diagram's total at an exact $0 instead of dragging a mixed
 * cloud+generic estimate down to 'indicative'.
 */
export const systemPricing: PricingAdapter = {
  async estimate(_serviceId, _config, defaultRegion): Promise<PriceQuote> {
    return { monthly: 0, basis: 'exact', region: defaultRegion || 'global' };
  },
};
