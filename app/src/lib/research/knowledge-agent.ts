import 'server-only';
import { llmAvailable, llmJson, LlmAbortError } from '@/lib/llm';
import { retrieveKnowledge, upsertKnowledge } from '@/lib/knowledge/store';
import { renderKnowledgeBlock, type KnowledgeEntryLike } from '@/lib/knowledge/types';
import { getSearchBackend, toSafeQuery, OFFICIAL_DOC_DOMAINS, webResearchAvailable } from '@/lib/research/web-search';
import type { ProviderId } from '@/lib/providers/types';
import type { DesignMode } from '@/lib/generate/router';

/**
 * Knowledge agent (feature 008 US4, FR-024–FR-027;
 * contracts/agent-interfaces.md §4).
 *
 * SOURCE ORDER IS CONTRACTUAL, and it is ordered by cost:
 *   1. the knowledge store   — one indexed query, no model call, no network
 *   2. provider MCPs         — official, already wired, but a subprocess call
 *   3. web research          — a network round-trip plus a summarising call
 *
 * Each rung runs only if the previous produced nothing usable, and the web rung
 * runs AT MOST ONCE per turn regardless of how many gaps exist. That cap is
 * deliberate: research is the slowest thing in the pipeline and a turn has a
 * 120s budget to respect.
 *
 * The store is also the cache. A web finding is written back before this
 * returns, so the next equivalent request is answered by rung 1 with no lookup
 * at all (SC-007) — which is what makes research affordable to have at all.
 */

const STALE_AFTER_DAYS = 14;

export interface GatherKnowledgeInput {
  keywords: string[];
  provider: ProviderId | 'any';
  designMode: DesignMode | 'any';
  /** Guidance already obtained from provider MCPs this turn, if any. */
  mcpGuidance?: string[];
  /** Trace callback so research is visible in the working trace (FR-029). */
  onStep?: (status: 'running' | 'done' | 'failed', detail?: string) => void;
  signal?: AbortSignal;
}

export interface GatherKnowledgeResult {
  entries: KnowledgeEntryLike[];
  /** Pre-rendered block ready for the planner/reviewer prompts. */
  block: string;
  /** True when a rung was unavailable and the turn is less grounded than it could be. */
  degraded: boolean;
  /** True when the web rung actually ran. */
  researched: boolean;
}

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['useful', 'title', 'finding', 'keywords'],
  properties: {
    useful: { type: 'boolean', description: 'False when the page does not answer the question.' },
    title: { type: 'string', description: 'Short title, under 12 words.' },
    finding: {
      type: 'string',
      description: 'One or two sentences of durable, reusable fact. No marketing copy, no pricing that changes weekly.',
    },
    keywords: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Fill a knowledge gap, cheapest source first.
 *
 * Never throws except on user stop: every rung degrades to the next, and an
 * exhausted waterfall simply means an ungrounded turn — which is how the app
 * behaved before this feature existed.
 */
export async function gatherKnowledge(input: GatherKnowledgeInput): Promise<GatherKnowledgeResult> {
  // Rung 1 — the store. Cheapest by a wide margin, so it always runs first.
  const stored = await retrieveKnowledge({
    keywords: input.keywords,
    provider: input.provider,
    designMode: input.designMode,
  });
  if (stored.length > 0) {
    return { entries: stored, block: renderKnowledgeBlock(stored), degraded: false, researched: false };
  }

  // Rung 2 — provider MCPs. The caller has already run these; if they produced
  // guidance, the turn is grounded and research would be redundant spend.
  const hasMcpGuidance = (input.mcpGuidance ?? []).some((g) => g && g.trim().length > 0);
  if (hasMcpGuidance) {
    return { entries: [], block: '', degraded: false, researched: false };
  }

  // Rung 3 — web research. Optional; absent credentials leave the turn grounded
  // on whatever rungs 1-2 gave it (FR-027).
  if (!webResearchAvailable() || !llmAvailable()) {
    return { entries: [], block: '', degraded: true, researched: false };
  }

  const query = toSafeQuery(input.keywords);
  if (!query) return { entries: [], block: '', degraded: true, researched: false };

  input.onStep?.('running', query);
  try {
    const backend = getSearchBackend();
    const hits = await backend.search(query, { allowDomains: OFFICIAL_DOC_DOMAINS });
    if (hits.length === 0) {
      input.onStep?.('done', 'no official documentation matched');
      return { entries: [], block: '', degraded: true, researched: true };
    }

    // One page is enough to answer most gaps; two is the cap so a slow site
    // cannot eat the turn budget.
    const pages: { url: string; text: string }[] = [];
    for (const hit of hits.slice(0, 2)) {
      const text = await backend.fetchPage(hit.url);
      pages.push({ url: hit.url, text: text || hit.snippet });
    }

    const summary = await llmJson<{ useful?: unknown; title?: unknown; finding?: unknown; keywords?: unknown }>({
      role: 'research',
      system: [
        'You extract one durable, reusable fact from official cloud documentation.',
        'Rules:',
        '- Record only what stays true for months: capabilities, constraints, structural',
        '  guidance. NOT prices, NOT quotas that change weekly, NOT marketing claims.',
        '- Two sentences maximum.',
        '- If the pages do not answer the question, set useful=false.',
      ].join('\n'),
      user: [
        `Question (derived keywords): ${query}`,
        ...pages.map((p) => `Source ${p.url}:\n${p.text.slice(0, 4000)}`),
      ].join('\n\n'),
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 500,
      signal: input.signal,
    });

    const finding = typeof summary?.finding === 'string' ? summary.finding.trim() : '';
    const title = typeof summary?.title === 'string' ? summary.title.trim() : '';
    if (summary?.useful === false || !finding || !title) {
      input.onStep?.('done', 'nothing reusable found');
      return { entries: [], block: '', degraded: true, researched: true };
    }

    const keywords = Array.isArray(summary?.keywords)
      ? summary.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.toLowerCase())
      : input.keywords.slice(0, 4);

    const entry = {
      kind: 'guidance' as const,
      provider: input.provider,
      designMode: input.designMode,
      title: title.slice(0, 120),
      content: finding.slice(0, 600),
      keywords,
      source: 'web' as const,
      sourceUrl: pages[0]?.url,
      confidence: 0.8,
      // Re-verified rather than reused once this passes (FR-026): documentation
      // changes, and a stale "fact" is worse than no fact.
      staleAfter: new Date(Date.now() + STALE_AFTER_DAYS * 24 * 60 * 60 * 1000),
    };

    // Write back BEFORE returning — this is what makes the next equivalent
    // request free (SC-007).
    await upsertKnowledge(entry);
    input.onStep?.('done', title);

    const asEntry = { ...entry, hash: '', enabled: true } as unknown as KnowledgeEntryLike;
    return { entries: [asEntry], block: renderKnowledgeBlock([asEntry]), degraded: false, researched: true };
  } catch (e) {
    if (e instanceof LlmAbortError) throw e;
    console.error('[knowledge-agent] web research failed; continuing ungrounded:', e);
    input.onStep?.('failed');
    return { entries: [], block: '', degraded: true, researched: true };
  }
}
