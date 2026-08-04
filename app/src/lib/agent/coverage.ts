/**
 * Requirements-coverage acceptance policy (generation-quality requirement:
 * every delivered design must cover at least 80–90% of the extracted
 * requirements).
 *
 * The evaluator-optimizer loop still aims for a full pass (100% — every
 * checklist item met); nothing here weakens that goal. What this module adds
 * is the ACCEPTANCE FLOOR for the moment the iteration/time budget runs out:
 * a final draft whose measured coverage is at or above the target is accepted
 * as converged (with the remaining gaps named in the reply), while one below
 * the target stays best-effort and escalates to the human (hitl.ts) instead
 * of being silently delivered.
 *
 * The target defaults to 85% — the midpoint of the required 80–90% band — and
 * is tunable via AGENT_COVERAGE_TARGET_PERCENT without a product change,
 * clamped to [50, 100] so a typo can never make the floor meaningless.
 *
 * Pure math over reviewer.ts RequirementCoverage entries; no I/O.
 */

interface CoverageItem {
  met: boolean;
  requirement?: string;
  gap?: string;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Acceptance floor, percent. Default 85 (the 80–90% band's midpoint). */
export const COVERAGE_TARGET_PERCENT = clamp(intEnv('AGENT_COVERAGE_TARGET_PERCENT', 85), 50, 100);

/**
 * Measured coverage of a graded checklist, as a whole percent. An empty list
 * means the turn had no checklist to grade (small edits) — reported as 100 so
 * callers never punish a turn for having nothing to measure.
 */
export function coveragePercent(coverage: readonly CoverageItem[]): number {
  if (coverage.length === 0) return 100;
  const met = coverage.filter((c) => c.met).length;
  return Math.round((met / coverage.length) * 100);
}

/** True only when a real checklist was graded AND its coverage meets the floor. */
export function meetsCoverageTarget(coverage: readonly CoverageItem[]): boolean {
  return coverage.length > 0 && coveragePercent(coverage) >= COVERAGE_TARGET_PERCENT;
}

/** "8/9 requirements covered (89%)" — shared phrasing for replies and the trace. */
export function coverageSummary(coverage: readonly CoverageItem[]): string {
  if (coverage.length === 0) return 'no requirement checklist to grade';
  const met = coverage.filter((c) => c.met).length;
  return `${met}/${coverage.length} requirements covered (${coveragePercent(coverage)}%)`;
}

/** The unmet items, phrased for a reply: "requirement (gap)" per line item. */
export function unmetRequirements(coverage: readonly CoverageItem[]): string[] {
  return coverage
    .filter((c) => !c.met)
    .map((c) => {
      const req = (c.requirement ?? '').trim() || 'unnamed requirement';
      const gap = (c.gap ?? '').trim();
      return gap ? `${req} (${gap})` : req;
    });
}
