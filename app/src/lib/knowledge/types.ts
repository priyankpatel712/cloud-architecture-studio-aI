import type { ProviderId } from '@/lib/providers/types';
import type { DesignMode } from '@/lib/generate/router';

/**
 * Knowledge store types and pure logic (feature 008 US3; data-model.md,
 * contracts/agent-interfaces.md §3).
 *
 * Deliberately free of database and LLM imports so scoring, hashing, and the
 * lesson-safety filter are unit-testable in isolation — the same discipline
 * diff.ts and trace-emitter.ts follow. The I/O layer lives in store.ts.
 */

export type KnowledgeKind = 'rule' | 'pattern' | 'guidance' | 'lesson' | 'service-note';
export type KnowledgeSource = 'seed' | 'mcp' | 'web' | 'learned';

/** A rule as authored in a provider plugin or in core-rules.ts. */
export interface KnowledgeSeed {
  title: string;
  content: string;
  keywords: string[];
  kind?: KnowledgeKind;
  designMode?: DesignMode | 'any';
}

export interface KnowledgeEntryInput extends KnowledgeSeed {
  provider: ProviderId | 'any';
  source: KnowledgeSource;
  sourceUrl?: string;
  confidence?: number;
  staleAfter?: Date;
}

export interface KnowledgeEntryLike extends KnowledgeEntryInput {
  _id?: unknown;
  kind: KnowledgeKind;
  designMode: DesignMode | 'any';
  confidence: number;
  enabled?: boolean;
  usageCount?: number;
  lastUsedAt?: Date;
  hash: string;
}

/** Prompt-injection budget: 6 entries × ≤600 chars must not crowd out guidance. */
export const KNOWLEDGE_TOP_K = 6;
export const KNOWLEDGE_CONTENT_MAX = 600;
export const KNOWLEDGE_BLOCK_MAX = 2400;

/** Below this an entry has failed to prove itself and is no longer injected. */
export const MIN_CONFIDENCE = 0.5;

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Stable dedupe key (FR-022). Derived from the semantic identity of an entry —
 * who it applies to and what it says — so the same knowledge learned twice
 * updates one row instead of accumulating near-duplicates that would each
 * consume a slot in the top-K.
 *
 * A tiny non-cryptographic hash is deliberate: this is a dedupe key, not a
 * security primitive, and keeping it dependency-free preserves the pure-module
 * property that makes this file testable.
 */
export function contentHash(entry: Pick<KnowledgeEntryInput, 'provider' | 'content'> & { designMode?: string }): string {
  const basis = `${entry.provider}|${entry.designMode ?? 'any'}|${normalizeText(entry.content)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Keyword relevance, using the approach already proven by
 * `matchReferencePatterns`: substring matching over the request's extracted
 * capability keywords. Cheap, debuggable (you can see WHICH keyword matched),
 * and needs no embedding call — which matters when the point of the feature is
 * to reduce model requests, not add one per retrieval.
 */
export function scoreEntry(entry: Pick<KnowledgeEntryLike, 'keywords' | 'title' | 'content'>, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = normalizeText(`${entry.title} ${entry.content} ${entry.keywords.join(' ')}`);
  let score = 0;
  for (const raw of keywords) {
    const k = normalizeText(raw);
    if (!k) continue;
    // An explicit keyword hit is worth more than an incidental prose mention.
    if (entry.keywords.some((ek) => normalizeText(ek) === k)) score += 2;
    else if (haystack.includes(k)) score += 1;
  }
  return score;
}

export interface RetrievalQuery {
  keywords: readonly string[];
  provider: ProviderId | 'any';
  designMode: DesignMode | 'any';
  topK?: number;
}

/**
 * Filter, rank, and cap candidates. Pure so retrieval policy can be tested
 * without a database — store.ts supplies the candidates.
 */
export function selectRelevant<T extends KnowledgeEntryLike>(candidates: readonly T[], q: RetrievalQuery, now: Date = new Date()): T[] {
  const topK = q.topK ?? KNOWLEDGE_TOP_K;
  const applicable = candidates.filter((e) => {
    if (e.enabled === false) return false;
    if (e.confidence < MIN_CONFIDENCE) return false;
    // A stale web/MCP finding must be re-verified before reuse (FR-026), so it
    // is withheld from injection rather than served as if still current.
    if (e.staleAfter && e.staleAfter.getTime() <= now.getTime()) return false;
    if (e.provider !== 'any' && q.provider !== 'any' && e.provider !== q.provider) return false;
    if (e.designMode !== 'any' && q.designMode !== 'any' && e.designMode !== q.designMode) return false;
    return true;
  });

  return applicable
    .map((e) => ({ e, score: scoreEntry(e, q.keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.confidence - a.e.confidence)
    .slice(0, topK)
    .map((x) => x.e);
}

/** Render entries as a prompt block, hard-capped so it cannot crowd the prompt. */
export function renderKnowledgeBlock(entries: readonly KnowledgeEntryLike[], heading = 'HOUSE RULES & LESSONS'): string {
  if (entries.length === 0) return '';
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- ${e.content.slice(0, KNOWLEDGE_CONTENT_MAX)}`;
    if (used + line.length > KNOWLEDGE_BLOCK_MAX) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return '';
  return [`${heading} (apply these; the review grades against them):`, ...lines].join('\n');
}

/**
 * Reject a distilled lesson that leaked project-identifying content (FR-021).
 *
 * Enforced at WRITE time, not read time: a lesson that never contains project
 * data cannot leak it later, no matter who reads the store afterwards. The
 * distiller prompt also asks for generality, but a prompt is a request and this
 * is the guarantee.
 */
export function isProjectSpecific(text: string): boolean {
  return (
    /\bn\d+\b/i.test(text) ||                       // canvas node ids (n1, n12)
    /\b[0-9a-f]{24}\b/i.test(text) ||               // Mongo ObjectIds
    /\bhttps?:\/\//i.test(text) ||                  // links to a specific place
    /"[^"]{1,80}"/.test(text) ||                    // quoted literal from user text
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text) || // IPs
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(text)        // emails
  );
}
