import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from '@/lib/llm';

/**
 * Feature 008 US2 — Retry-After parsing (FR-012).
 *
 * Before this, a 429 was retried immediately and the header ignored, so one
 * rate-limit response became several — burning the turn's budget against a
 * limit that was still in force. The provider is telling us exactly when it
 * will serve us again; these tests pin that we read it correctly in both
 * RFC-7231 forms, and that anything unparseable degrades to the old behavior
 * rather than producing a bogus wait.
 */

describe('parseRetryAfterMs — delta-seconds form', () => {
  it('converts whole seconds to milliseconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs('1')).toBe(1_000);
  });

  it('accepts zero as "retry immediately"', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRetryAfterMs('  5  ')).toBe(5_000);
  });
});

describe('parseRetryAfterMs — HTTP-date form', () => {
  it('returns the remaining time until the given date', () => {
    const now = Date.parse('2026-07-31T12:00:00Z');
    expect(parseRetryAfterMs('Fri, 31 Jul 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('clamps a past date to zero instead of a negative wait', () => {
    const now = Date.parse('2026-07-31T12:00:00Z');
    expect(parseRetryAfterMs('Fri, 31 Jul 2026 11:59:00 GMT', now)).toBe(0);
  });
});

describe('parseRetryAfterMs — absent or malformed', () => {
  it('returns null when the header is missing', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('   ')).toBeNull();
  });

  it('returns null for values that are neither seconds nor a date', () => {
    // Falling back to null keeps the pre-008 behavior (fixed cooldown), which is
    // strictly better than acting on a number we invented.
    for (const bad of ['soon', 'NaN', '30s', '-5', '1.5', 'Fri, 99 Xxx 2026']) {
      expect(parseRetryAfterMs(bad), `"${bad}" should not parse`).toBeNull();
    }
  });
});
