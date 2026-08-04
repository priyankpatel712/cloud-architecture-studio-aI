#!/usr/bin/env node
/**
 * One-off diagnostic: what LLM config does a report-generation call actually
 * resolve to right now, and does a real structured completion succeed on it?
 * Runs the same loadLlmSettings -> resolveLlmConfigFrom -> llmPing path the
 * app uses. Never prints key material — only presence booleans.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scratch/bedrock-diag.mjs
 */
import { exit } from 'node:process';

async function main() {
  const { loadLlmSettings } = await import('../src/lib/llm-settings.ts');
  const { resolveLlmConfigFrom, envKeyFor, llmPing } = await import('../src/lib/llm.ts');
  const { LLM_PROVIDER_IDS } = await import('../src/lib/llm-catalog.ts');

  const snap = await loadLlmSettings();
  console.log('DB settings  provider:', snap?.provider ?? '(none)', ' model:', snap?.model ?? '(none)');
  console.log('DB stored keys for   :', snap?.storedKeyProviders?.join(', ') || '(none)');
  console.log('DB decrypted keys for:', Object.keys(snap?.keys ?? {}).join(', ') || '(none)');
  for (const id of LLM_PROVIDER_IDS) {
    const env = Boolean(envKeyFor(id));
    if (env) console.log(`env key present      : ${id}`);
  }

  const cfg = resolveLlmConfigFrom(snap);
  console.log(`\nresolved active      : ${cfg.provider} / ${cfg.model}  key=${cfg.apiKey ? 'yes' : 'NO'}  source=${cfg.source}`);
  if (!cfg.apiKey) {
    console.log('-> llmAvailable() is FALSE: every report degrades to the no-LLM fallback.');
    exit(0);
  }
  const started = Date.now();
  try {
    await llmPing(cfg);
    console.log(`PING OK in ${Date.now() - started}ms — structured completion works on the active config.`);
  } catch (e) {
    console.log(`PING FAILED after ${Date.now() - started}ms:`, e instanceof Error ? e.message : e);
  }
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
