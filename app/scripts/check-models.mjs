#!/usr/bin/env node
/**
 * Catalog freshness check.
 *
 * WHY THIS EXISTS. Model ids are perishable — providers withdraw them, and
 * OpenRouter rotates its `:free` pool outright. A withdrawn id sits in the
 * catalog looking fine and 404s on every call, and because a "model not found"
 * is a hard configuration error it does not behave like an outage: it takes the
 * turn down. That happened here — two of six baseline requests failed once the
 * primary rate-limited and the chain fell back to an OpenRouter default that no
 * longer existed.
 *
 * Compares every catalog model id against what each provider actually serves,
 * for providers that have a key. Reports:
 *   - ✗ ids the provider no longer lists (the dangerous case)
 *   - ! a defaultModel that is missing (worse — it is what a fallback picks)
 *
 * USAGE
 *   npm run models:check
 *
 * Exits non-zero when a defaultModel is missing, so this can gate a release.
 */

import { exit } from 'node:process';

async function main() {
  const { LLM_PROVIDER_LIST } = await import('../src/lib/llm-catalog.ts');
  const { llmListModels, envKeyFor } = await import('../src/lib/llm.ts');
  const { loadLlmSettings } = await import('../src/lib/llm-settings.ts');

  const snapshot = await loadLlmSettings().catch(() => null);
  let missingDefaults = 0;
  let checked = 0;

  for (const info of LLM_PROVIDER_LIST) {
    const apiKey = snapshot?.keys?.[info.id] || envKeyFor(info.id);
    if (!apiKey) {
      console.log(`${info.label.padEnd(14)} — no key, skipped`);
      continue;
    }
    let live;
    try {
      live = await llmListModels({ provider: info.id, apiKey });
    } catch (e) {
      console.log(`${info.label.padEnd(14)} ✗ could not list models — ${e instanceof Error ? e.message : e}`);
      continue;
    }
    checked++;
    // An empty list means the provider has no listing endpoint, not that every
    // model is gone — reporting the whole catalog as stale would be worse than
    // saying nothing.
    if (live.length === 0) {
      console.log(`${info.label.padEnd(14)} — provider lists no models, cannot verify`);
      continue;
    }

    const stale = info.models.filter((m) => !live.includes(m));
    const defaultMissing = !live.includes(info.defaultModel);
    if (stale.length === 0) {
      console.log(`${info.label.padEnd(14)} ✓ all ${info.models.length} catalog model(s) still served (${live.length} live)`);
      continue;
    }
    console.log(`${info.label.padEnd(14)} ${stale.length}/${info.models.length} catalog model(s) no longer served:`);
    for (const m of stale) {
      const isDefault = m === info.defaultModel;
      console.log(`  ${isDefault ? '!' : '✗'} ${m}${isDefault ? '   ← defaultModel' : ''}`);
    }
    if (defaultMissing) missingDefaults++;
  }

  console.log(`\n${checked} provider(s) checked.`);
  if (missingDefaults > 0) {
    console.error(
      `${missingDefaults} provider(s) have a defaultModel that no longer exists. This is what a\n` +
        'fallback picks when the active connection is rate-limited — fix the catalog.'
    );
    exit(1);
  }
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
