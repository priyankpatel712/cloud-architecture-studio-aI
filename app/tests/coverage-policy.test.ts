import { describe, expect, it } from 'vitest';
import {
  COVERAGE_TARGET_PERCENT,
  coveragePercent,
  coverageSummary,
  meetsCoverageTarget,
  unmetRequirements,
} from '@/lib/agent/coverage';

/**
 * Coverage acceptance policy (lib/agent/coverage.ts) — the ≥80–90% floor the
 * generation loop enforces when its budget runs out.
 */

const item = (met: boolean, requirement = 'req', gap = '') => ({ met, requirement, gap });

describe('coveragePercent', () => {
  it('reports 100 for an empty checklist (nothing to measure)', () => {
    expect(coveragePercent([])).toBe(100);
  });

  it('computes whole percents', () => {
    expect(coveragePercent([item(true), item(true), item(false)])).toBe(67);
    expect(coveragePercent([item(true), item(false)])).toBe(50);
    expect(coveragePercent([item(true)])).toBe(100);
    expect(coveragePercent([item(false)])).toBe(0);
  });

  it('9 of 10 met sits inside the 80–90 acceptance band', () => {
    const nineOfTen = [...Array.from({ length: 9 }, () => item(true)), item(false)];
    expect(coveragePercent(nineOfTen)).toBe(90);
    expect(meetsCoverageTarget(nineOfTen)).toBe(true);
  });
});

describe('meetsCoverageTarget', () => {
  it('defaults the floor to 85 (midpoint of the required 80–90% band)', () => {
    // Unset env in the test runner → default. Clamped to [50, 100] regardless.
    expect(COVERAGE_TARGET_PERCENT).toBeGreaterThanOrEqual(50);
    expect(COVERAGE_TARGET_PERCENT).toBeLessThanOrEqual(100);
    expect(COVERAGE_TARGET_PERCENT).toBe(85);
  });

  it('never accepts on an empty checklist — nothing measured is not a pass', () => {
    expect(meetsCoverageTarget([])).toBe(false);
  });

  it('accepts at or above the floor, rejects below', () => {
    const sixOfSeven = [...Array.from({ length: 6 }, () => item(true)), item(false)]; // 86%
    expect(meetsCoverageTarget(sixOfSeven)).toBe(true);
    const fourOfFive = [...Array.from({ length: 4 }, () => item(true)), item(false)]; // 80%
    expect(meetsCoverageTarget(fourOfFive)).toBe(false);
  });
});

describe('summaries', () => {
  it('renders the shared phrasing', () => {
    expect(coverageSummary([item(true), item(false)])).toBe('1/2 requirements covered (50%)');
    expect(coverageSummary([])).toBe('no requirement checklist to grade');
  });

  it('lists unmet items with their gaps', () => {
    const coverage = [item(true, 'api'), item(false, 'multi-AZ', 'no second AZ'), item(false, 'WAF')];
    expect(unmetRequirements(coverage)).toEqual(['multi-AZ (no second AZ)', 'WAF']);
  });
});
