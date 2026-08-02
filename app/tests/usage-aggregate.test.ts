import { describe, expect, it } from 'vitest';
import { summarizeUsage, windowStart, isUsageWindow, type UsageBucket } from '@/lib/llm-usage';

/**
 * Feature 008 US5 — usage aggregation (FR-031;
 * contracts/settings-llm-usage.md).
 *
 * These numbers are what an operator uses to decide whether tiering is working
 * and whether a provider is being hammered, so the arithmetic is pinned here
 * rather than trusted to a Mongo pipeline nobody can run in CI. `smallMidShare`
 * in particular IS the SC-004 measurement.
 */

const bucket = (over: Partial<UsageBucket> = {}): UsageBucket => ({
  provider: 'nvidia',
  model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
  role: 'plan',
  tier: 'large',
  requests: 1,
  promptTokens: 0,
  completionTokens: 0,
  rateLimited: 0,
  errors: 0,
  latencySumMs: 0,
  ...over,
});

describe('empty collection', () => {
  it('returns zeros rather than an error', () => {
    const s = summarizeUsage([], { window: '30d', includeByRole: true });
    expect(s.totals).toEqual({ requests: 0, promptTokens: 0, completionTokens: 0 });
    expect(s.byConnection).toEqual([]);
    expect(s.smallMidShare).toBe(0);
  });

  it('does not divide by zero computing the tier share', () => {
    expect(Number.isFinite(summarizeUsage([], { window: '24h', includeByRole: false }).smallMidShare)).toBe(true);
  });
});

describe('totals and per-connection rollup', () => {
  const buckets = [
    bucket({ role: 'plan', tier: 'large', requests: 10, promptTokens: 1000, completionTokens: 200, latencySumMs: 40_000 }),
    bucket({ role: 'review', tier: 'mid', requests: 5, promptTokens: 500, completionTokens: 100, latencySumMs: 10_000, errors: 1 }),
    bucket({ provider: 'groq', model: 'llama-3.1-8b-instant', role: 'route', tier: 'small', requests: 25, promptTokens: 250, latencySumMs: 12_500, rateLimited: 3 }),
  ];

  it('sums totals across every bucket', () => {
    const s = summarizeUsage(buckets, { window: '30d', includeByRole: true });
    expect(s.totals).toEqual({ requests: 40, promptTokens: 1750, completionTokens: 300 });
  });

  it('merges buckets that share a provider and model', () => {
    const s = summarizeUsage(buckets, { window: '30d', includeByRole: true });
    const nvidia = s.byConnection.find((c) => c.provider === 'nvidia')!;
    expect(nvidia.requests).toBe(15);
    expect(nvidia.errors).toBe(1);
  });

  it('weights mean latency by request count, not by bucket', () => {
    // 50s over 15 requests. Averaging the two bucket means (4000, 2000) would
    // give 3000 and quietly overstate the slower, busier path.
    const s = summarizeUsage(buckets, { window: '30d', includeByRole: true });
    expect(s.byConnection.find((c) => c.provider === 'nvidia')!.meanLatencyMs).toBe(3333);
  });

  it('orders connections by request volume', () => {
    const s = summarizeUsage(buckets, { window: '30d', includeByRole: true });
    expect(s.byConnection[0].provider).toBe('groq');
  });

  it('reports rate limiting separately from errors', () => {
    const s = summarizeUsage(buckets, { window: '30d', includeByRole: true });
    const groq = s.byConnection.find((c) => c.provider === 'groq')!;
    expect(groq.rateLimited).toBe(3);
    expect(groq.errors).toBe(0);
  });
});

describe('smallMidShare (SC-004)', () => {
  it('is the fraction of requests kept off the largest tier', () => {
    const s = summarizeUsage(
      [bucket({ tier: 'large', requests: 20 }), bucket({ role: 'route', tier: 'small', requests: 30 })],
      { window: '30d', includeByRole: false }
    );
    expect(s.smallMidShare).toBeCloseTo(0.6);
  });

  it('counts mid alongside small', () => {
    const s = summarizeUsage(
      [bucket({ tier: 'mid', requests: 1 }), bucket({ tier: 'large', requests: 1 })],
      { window: '30d', includeByRole: false }
    );
    expect(s.smallMidShare).toBeCloseTo(0.5);
  });

  it('trusts the recorded tier over the role policy', () => {
    // 'plan' is a large-tier role, but this request was actually served by a
    // small model. Reporting the POLICY here would turn the settings panel into
    // a mirror of its own configuration instead of a measurement.
    const s = summarizeUsage([bucket({ role: 'plan', tier: 'small', requests: 4 })], {
      window: '30d',
      includeByRole: false,
    });
    expect(s.smallMidShare).toBe(1);
  });

  it('falls back to the role tier for rows written before tiers were recorded', () => {
    const legacy = bucket({ role: 'route', requests: 2 });
    (legacy as { tier: unknown }).tier = undefined;
    expect(summarizeUsage([legacy], { window: '30d', includeByRole: false }).smallMidShare).toBe(1);
  });
});

describe('byRole visibility', () => {
  it('is omitted without settings:manage', () => {
    const s = summarizeUsage([bucket()], { window: '30d', includeByRole: false });
    expect(s.byRole).toBeUndefined();
  });

  it('is present, aggregated and ordered for an administrator', () => {
    const s = summarizeUsage(
      [bucket({ role: 'route', tier: 'small', requests: 9 }), bucket({ role: 'plan', requests: 2 }), bucket({ role: 'plan', requests: 1 })],
      { window: '30d', includeByRole: true }
    );
    expect(s.byRole).toEqual([
      { role: 'route', requests: 9, tier: 'small' },
      { role: 'plan', requests: 3, tier: 'large' },
    ]);
  });
});

describe('window handling', () => {
  it('accepts only the documented windows', () => {
    expect(isUsageWindow('24h')).toBe(true);
    expect(isUsageWindow('30d')).toBe(true);
    expect(isUsageWindow('1y')).toBe(false);
    expect(isUsageWindow(undefined)).toBe(false);
  });

  it('computes the start of each window backwards from now', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    expect(windowStart('24h', now).toISOString()).toBe('2026-07-30T12:00:00.000Z');
    expect(windowStart('7d', now).toISOString()).toBe('2026-07-24T12:00:00.000Z');
    expect(windowStart('30d', now).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
