import 'server-only';
import { retrievePatternEntries } from '@/lib/knowledge/store';
import {
  matchReferencePatterns,
  patternsFromEntries,
  selectPatterns,
  type ReferencePattern,
} from '@/lib/generate/reference-patterns';

/**
 * Store-backed reference-pattern matching (feature 008 T079, FR-032).
 *
 * Same patterns, new source of truth: once seeded, the knowledge store owns
 * the pattern set, so an operator can edit a pattern's keywords or switch one
 * off in Settings → AI Knowledge and the NEXT generation reflects it — no
 * deploy. The built-in array remains exactly what the task called it: an
 * OFFLINE FALLBACK, used only when the store has no patterns at all (never
 * seeded, disabled store, database unreachable within the read deadline).
 *
 * The fallback boundary is "no pattern rows", not "no enabled pattern rows":
 * an operator who disables every stored pattern has said "use none", and
 * falling back to the built-in copies of the same patterns would silently
 * override that decision.
 *
 * Selection itself (thresholds, ordering, cap) is `selectPatterns` for both
 * sources, so where a pattern is loaded from can never change whether it
 * matches.
 */
export async function matchPatternsWithStore(text: string, max = 2): Promise<ReferencePattern[]> {
  const stored = await retrievePatternEntries();
  if (stored.length === 0) return matchReferencePatterns(text, max);
  return selectPatterns(text, patternsFromEntries(stored), max);
}
