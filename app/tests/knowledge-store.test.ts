import { describe, expect, it } from 'vitest';
import {
  scoreEntry,
  selectRelevant,
  renderKnowledgeBlock,
  contentHash,
  normalizeText,
  KNOWLEDGE_BLOCK_MAX,
  MIN_CONFIDENCE,
  type KnowledgeEntryLike,
} from '@/lib/knowledge/types';

/**
 * Feature 008 US3 — knowledge retrieval policy (FR-019, FR-022, FR-026).
 *
 * Retrieval is keyword-scored rather than embedding-based on purpose (research
 * R6): it costs no model call — which matters when the point of the feature is
 * to REDUCE model requests — and you can see which keyword matched when a wrong
 * rule is injected. These tests pin the filtering rules that decide what a
 * generation is allowed to be grounded in.
 */

const entry = (over: Partial<KnowledgeEntryLike> = {}): KnowledgeEntryLike => ({
  kind: 'rule',
  provider: 'any',
  designMode: 'any',
  title: 'Data stores stay private',
  content: 'Databases and caches live in private subnets and are never internet-exposed.',
  keywords: ['database', 'private', 'subnet'],
  source: 'seed',
  confidence: 1,
  hash: 'h1',
  ...over,
});

describe('scoreEntry', () => {
  it('scores an explicit keyword hit above an incidental prose mention', () => {
    const e = entry({ keywords: ['database'], content: 'Something about caches.' });
    expect(scoreEntry(e, ['database'])).toBeGreaterThan(scoreEntry(e, ['caches']));
  });

  it('accumulates across multiple matching keywords', () => {
    const e = entry();
    expect(scoreEntry(e, ['database', 'private'])).toBeGreaterThan(scoreEntry(e, ['database']));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(scoreEntry(entry(), ['  DATABASE '])).toBeGreaterThan(0);
  });

  it('scores zero when nothing matches', () => {
    expect(scoreEntry(entry(), ['kubernetes'])).toBe(0);
    expect(scoreEntry(entry(), [])).toBe(0);
  });
});

describe('selectRelevant — filtering', () => {
  const q = { keywords: ['database'], provider: 'aws' as const, designMode: 'cloud' as const };

  it('returns only entries that actually match', () => {
    const hits = selectRelevant([entry(), entry({ hash: 'h2', keywords: ['kubernetes'], content: 'Unrelated.' })], q);
    expect(hits).toHaveLength(1);
    expect(hits[0].hash).toBe('h1');
  });

  it('excludes disabled entries — an operator switch must take effect', () => {
    expect(selectRelevant([entry({ enabled: false })], q)).toEqual([]);
  });

  it('excludes entries below the confidence floor', () => {
    // A lesson that never proved useful decays out of retrieval on its own.
    expect(selectRelevant([entry({ confidence: MIN_CONFIDENCE - 0.01 })], q)).toEqual([]);
    expect(selectRelevant([entry({ confidence: MIN_CONFIDENCE })], q)).toHaveLength(1);
  });

  it('withholds a stale finding so it is re-verified rather than reused (FR-026)', () => {
    const past = new Date('2026-01-01');
    const now = new Date('2026-07-31');
    expect(selectRelevant([entry({ source: 'web', staleAfter: past })], q, now)).toEqual([]);
    const future = new Date('2026-12-01');
    expect(selectRelevant([entry({ source: 'web', staleAfter: future })], q, now)).toHaveLength(1);
  });

  it('keeps provider-agnostic rules for every provider', () => {
    expect(selectRelevant([entry({ provider: 'any' })], q)).toHaveLength(1);
  });

  it('excludes another provider’s rules', () => {
    expect(selectRelevant([entry({ provider: 'mongodb' })], q)).toEqual([]);
  });

  it('excludes rules scoped to a different design mode', () => {
    expect(selectRelevant([entry({ designMode: 'lld' })], q)).toEqual([]);
    expect(selectRelevant([entry({ designMode: 'cloud' })], q)).toHaveLength(1);
  });
});

describe('selectRelevant — ranking and limits', () => {
  it('ranks stronger matches first', () => {
    const weak = entry({ hash: 'weak', keywords: ['storage'], content: 'Mentions database once.' });
    const strong = entry({ hash: 'strong', keywords: ['database', 'private'] });
    const hits = selectRelevant([weak, strong], { keywords: ['database', 'private'], provider: 'any', designMode: 'any' });
    expect(hits[0].hash).toBe('strong');
  });

  it('breaks ties on confidence, preferring proven knowledge', () => {
    const a = entry({ hash: 'a', confidence: 0.6 });
    const b = entry({ hash: 'b', confidence: 1 });
    const hits = selectRelevant([a, b], { keywords: ['database'], provider: 'any', designMode: 'any' });
    expect(hits[0].hash).toBe('b');
  });

  it('honours topK', () => {
    const many = Array.from({ length: 20 }, (_, i) => entry({ hash: `h${i}` }));
    expect(selectRelevant(many, { keywords: ['database'], provider: 'any', designMode: 'any', topK: 3 })).toHaveLength(3);
  });
});

describe('renderKnowledgeBlock', () => {
  it('returns an empty string when there is nothing to inject', () => {
    expect(renderKnowledgeBlock([])).toBe('');
  });

  it('caps the block so rules cannot crowd out the rest of the prompt', () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ hash: `h${i}`, content: 'x'.repeat(600) }));
    expect(renderKnowledgeBlock(many).length).toBeLessThanOrEqual(KNOWLEDGE_BLOCK_MAX + 100);
  });

  it('states that the rules are graded, not merely suggested', () => {
    expect(renderKnowledgeBlock([entry()])).toContain('grades');
  });
});

describe('contentHash — dedupe identity (FR-022)', () => {
  it('is stable for identical knowledge', () => {
    expect(contentHash({ provider: 'aws', content: 'Same rule.', designMode: 'cloud' })).toBe(
      contentHash({ provider: 'aws', content: 'Same rule.', designMode: 'cloud' })
    );
  });

  it('ignores case and whitespace differences', () => {
    expect(contentHash({ provider: 'aws', content: '  Same   RULE. ' })).toBe(
      contentHash({ provider: 'aws', content: 'same rule.' })
    );
  });

  it('differs by content, provider, and design mode', () => {
    const base = contentHash({ provider: 'aws', content: 'A rule.', designMode: 'cloud' });
    expect(contentHash({ provider: 'aws', content: 'Another rule.', designMode: 'cloud' })).not.toBe(base);
    expect(contentHash({ provider: 'mongodb', content: 'A rule.', designMode: 'cloud' })).not.toBe(base);
    expect(contentHash({ provider: 'aws', content: 'A rule.', designMode: 'lld' })).not.toBe(base);
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeText('  Multi   Region   DR ')).toBe('multi region dr');
  });
});
