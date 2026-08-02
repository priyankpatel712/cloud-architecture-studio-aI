#!/usr/bin/env node
/**
 * Seed the knowledge store (feature 008 US3, FR-018/FR-022).
 *
 * Sources rules from two places, never from a hardcoded list here:
 *   - each provider plugin's own `rules` (via the registry) — so adding a
 *     provider ships its rules with it, per constitution Principle II
 *   - `knowledge/core-rules.ts` for genuinely provider-agnostic rules
 *
 * Idempotent by content hash: re-running updates existing entries rather than
 * duplicating them, and never resets confidence a lesson has earned or
 * re-enables a rule an operator disabled.
 *
 * USAGE
 *   npm run seed:knowledge
 *   npm run seed:knowledge -- --prune    also removes decayed/unused entries
 *
 * Requires MONGODB_URI (or the default local instance).
 */

import { argv, exit } from 'node:process';

async function main() {
  const { connectDB } = await import('../src/lib/db.ts');
  // The same function the admin reseed endpoint calls — one implementation, so
  // the CLI and the UI can never seed different sets of rules.
  const { reseedKnowledge } = await import('../src/lib/knowledge/seed.ts');

  await connectDB();

  const prune = argv.includes('--prune');
  const { created, updated, pruned } = await reseedKnowledge({ prune });

  const prunedNote = prune ? `, ${pruned} pruned` : '';
  console.log(`Knowledge seed complete: ${created} created, ${updated} updated${prunedNote}.`);
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
