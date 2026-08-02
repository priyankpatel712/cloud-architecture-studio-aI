import 'server-only';
import { allProviderRules } from '@/lib/providers/registry';
import { CORE_RULES } from '@/lib/knowledge/core-rules';
import { upsertKnowledge, pruneKnowledge } from '@/lib/knowledge/store';
import { REFERENCE_PATTERNS, serializePattern } from '@/lib/generate/reference-patterns';

/**
 * Knowledge seeding (feature 008 US3/US5, FR-018/FR-022;
 * contracts/settings-knowledge.md §reseed).
 *
 * Extracted from `scripts/seed-knowledge.mjs` so the CLI and the admin reseed
 * endpoint run the SAME code. Two implementations of "seeding" would drift, and
 * the drift would show up as rules that exist on one operator's deployment and
 * not another's — with nothing in the diff to explain why.
 *
 * Sources are the provider plugins' own `rules` (constitution II: a provider
 * ships its rules with it) plus the provider-agnostic core rules. Never a list
 * hardcoded here.
 *
 * Idempotent by content hash: re-running updates rather than duplicates, and
 * `upsertKnowledge` applies confidence and `enabled` only on insert — so a
 * reseed cannot resurrect a rule an operator switched off, nor reset trust a
 * lesson earned.
 */

export interface ReseedResult {
  created: number;
  updated: number;
  pruned: number;
}

export async function reseedKnowledge(opts: { prune?: boolean } = {}): Promise<ReseedResult> {
  const seeds = [...CORE_RULES.map((seed) => ({ provider: 'any' as const, seed })), ...allProviderRules()];

  let created = 0;
  let updated = 0;
  for (const { provider, seed } of seeds) {
    const res = await upsertKnowledge({
      kind: seed.kind ?? 'rule',
      provider,
      designMode: seed.designMode ?? 'any',
      title: seed.title,
      content: seed.content,
      keywords: seed.keywords,
      source: 'seed',
      confidence: 1,
    });
    if (res.created) created++;
    else updated++;
  }

  // 008 T079 — the reference-pattern library, seeded so patterns become
  // editable/disableable at runtime like every other knowledge entry. Same
  // idempotence contract: `enabled` is $setOnInsert-only, so reseeding never
  // re-enables a pattern an operator switched off.
  for (const pattern of REFERENCE_PATTERNS) {
    const s = serializePattern(pattern);
    const res = await upsertKnowledge({
      kind: 'pattern',
      provider: 'any', // patterns span AWS + Atlas services
      designMode: 'cloud',
      title: s.title,
      content: s.content,
      keywords: s.keywords,
      source: 'seed',
      confidence: 1,
    });
    if (res.created) created++;
    else updated++;
  }

  const pruned = opts.prune ? await pruneKnowledge() : 0;
  return { created, updated, pruned };
}
