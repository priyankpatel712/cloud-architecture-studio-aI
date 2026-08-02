import { describe, expect, it } from 'vitest';
import {
  matchReferencePatterns,
  selectPatterns,
  patternGrounding,
  serializePattern,
  parsePatternEntry,
  patternsFromEntries,
  REFERENCE_PATTERNS,
} from '@/lib/generate/reference-patterns';
import { KNOWLEDGE_CONTENT_MAX } from '@/lib/knowledge/types';
import { serviceById } from '@/lib/catalog';

/** Local reference-pattern library: matching threshold + catalog integrity. */

describe('matchReferencePatterns', () => {
  it('matches a serverless API request', () => {
    const hits = matchReferencePatterns('Build a serverless REST API backend for a mobile app');
    expect(hits.map((p) => p.id)).toContain('serverless-api');
  });

  it('matches IoT ingestion and ranks it first for a telemetry request', () => {
    const hits = matchReferencePatterns(
      'Ingest MQTT telemetry from 10,000 IoT sensor devices through a streaming pipeline'
    );
    expect(hits[0]?.id).toBe('event-ingestion');
  });

  it('returns at most two patterns', () => {
    const everything = matchReferencePatterns(
      'serverless api iot telemetry rag chatbot ecommerce cart analytics warehouse video fleet saas payment social feed'
    );
    expect(everything.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing below the 2-keyword threshold (wrong pattern beats none)', () => {
    expect(matchReferencePatterns('hello world')).toEqual([]);
    expect(matchReferencePatterns('a single api mention')).toEqual([]);
  });

  it('formats grounding with services, flow, and notes', () => {
    const [p] = matchReferencePatterns('serverless rest api backend');
    const text = patternGrounding([p]);
    expect(text).toContain(`Reference pattern "${p.name}"`);
    expect(text).toContain('aws-apigw');
    expect(text).toContain('typical flow');
  });
});

describe('pattern library integrity', () => {
  it('every referenced service id exists in the curated catalog', () => {
    for (const p of REFERENCE_PATTERNS) {
      for (const id of p.services) {
        expect(serviceById(id), `${p.id} references unknown service ${id}`).toBeDefined();
      }
      for (const hop of p.flow) {
        for (const id of hop.split('->').map((s) => s.trim())) {
          expect(serviceById(id), `${p.id} flow references unknown service ${id}`).toBeDefined();
        }
      }
    }
  });

  it('keywords are lowercase (matching is lowercase-normalized)', () => {
    for (const p of REFERENCE_PATTERNS) {
      for (const k of p.keywords) expect(k).toBe(k.toLowerCase());
    }
  });
});

/**
 * 008 T079 — store-backed patterns. The serialized form travels through a
 * KnowledgeEntry's 600-char content field, so what these tests really pin is
 * that a pattern survives the store: the round trip is lossless, every
 * built-in pattern FITS (an oversized one would be silently truncated by the
 * upsert), and truncation — if an operator edit ever causes it — can only
 * cost note prose, never the service ids the planner maps onto the canvas.
 */
describe('store round-trip (T079)', () => {
  it('every built-in pattern survives serialize → parse unchanged', () => {
    for (const p of REFERENCE_PATTERNS) {
      const s = serializePattern(p);
      const back = parsePatternEntry({ title: s.title, content: s.content, keywords: s.keywords });
      expect(back, p.id).toEqual({ ...p, name: s.title });
    }
  });

  it('every built-in pattern fits the store content cap', () => {
    for (const p of REFERENCE_PATTERNS) {
      const len = serializePattern(p).content.length;
      expect(len, `${p.id} is ${len} chars`).toBeLessThanOrEqual(KNOWLEDGE_CONTENT_MAX);
    }
  });

  it('cap truncation costs notes prose only — structure is ordered to survive', () => {
    const s = serializePattern(REFERENCE_PATTERNS[0]);
    const truncated = s.content.slice(0, s.content.indexOf('notes=') + 20);
    const back = parsePatternEntry({ title: s.title, content: truncated, keywords: s.keywords });
    expect(back).not.toBeNull();
    expect(back!.services).toEqual(REFERENCE_PATTERNS[0].services);
    expect(back!.flow).toEqual(REFERENCE_PATTERNS[0].flow);
  });

  it('rejects entries an operator edit has broken, rather than half-parsing', () => {
    // A pattern without real service ids cannot ground a plan.
    expect(parsePatternEntry({ title: 'x', content: 'notes=only prose here' })).toBeNull();
    expect(parsePatternEntry({ title: 'x', content: 'id=a | services=' })).toBeNull();
    expect(parsePatternEntry({ title: 'x', content: '' })).toBeNull();
  });
});

describe('operator control via the store (FR-032)', () => {
  const entries = REFERENCE_PATTERNS.map((p) => ({ ...serializePattern(p), enabled: true }));

  it('parses a full stored set back to the library', () => {
    expect(patternsFromEntries(entries)).toHaveLength(REFERENCE_PATTERNS.length);
  });

  it('a disabled entry is excluded — switching a pattern off must stick', () => {
    const oneOff = entries.map((e, i) => (i === 0 ? { ...e, enabled: false } : e));
    const ids = patternsFromEntries(oneOff).map((p) => p.id);
    expect(ids).not.toContain(REFERENCE_PATTERNS[0].id);
    expect(ids).toHaveLength(REFERENCE_PATTERNS.length - 1);
  });

  it('disabling everything yields none — not a silent fallback to the built-ins', () => {
    expect(patternsFromEntries(entries.map((e) => ({ ...e, enabled: false })))).toEqual([]);
  });

  it('an unparseable row is dropped without taking the rest down', () => {
    const withJunk = [...entries, { title: 'broken', content: 'garbage', enabled: true }];
    expect(patternsFromEntries(withJunk)).toHaveLength(REFERENCE_PATTERNS.length);
  });

  it('selection is source-independent: stored patterns match exactly like built-ins', () => {
    const stored = patternsFromEntries(entries);
    for (const text of [
      'Build a serverless REST API backend for a mobile app',
      'Ingest MQTT telemetry from IoT sensor devices through a streaming pipeline',
      'hello world',
    ]) {
      expect(selectPatterns(text, stored).map((p) => p.id)).toEqual(
        matchReferencePatterns(text).map((p) => p.id)
      );
    }
  });
});
