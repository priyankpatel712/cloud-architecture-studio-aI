import { describe, expect, it } from 'vitest';
import {
  SESSION_MEMORY_LIMIT,
  deriveBriefMemory,
  mergeSessionMemory,
  renderSessionMemory,
  type SessionMemoryEntry,
} from '@/lib/agent/session-memory';

/**
 * Session memory (lib/agent/session-memory.ts) — durable per-conversation
 * facts that survive the transcript window. Pure merge/derive/render logic.
 */

const entry = (text: string, kind: SessionMemoryEntry['kind'] = 'constraint', turn = 1): SessionMemoryEntry => ({ kind, text, turn });

describe('mergeSessionMemory', () => {
  it('appends new entries and drops empties', () => {
    const merged = mergeSessionMemory([entry('budget under $200/mo')], [entry('single region', 'preference', 2), entry('   ', 'decision', 2)]);
    expect(merged.map((e) => e.text)).toEqual(['budget under $200/mo', 'single region']);
  });

  it('dedupes on kind + normalized text, keeping the newest statement', () => {
    const merged = mergeSessionMemory(
      [entry('Budget under $200/mo', 'constraint', 1)],
      [entry('budget   under $200/mo', 'constraint', 5)]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].turn).toBe(5);
  });

  it('keeps the same text under different kinds distinct', () => {
    const merged = mergeSessionMemory([entry('us-east-1', 'preference')], [entry('us-east-1', 'decision', 2)]);
    expect(merged).toHaveLength(2);
  });

  it('a new outcome supersedes the previous outcome', () => {
    const merged = mergeSessionMemory(
      [entry('Turn 2: 6/9 requirements covered (67%)', 'outcome', 2), entry('budget cap', 'constraint', 1)],
      [entry('Turn 3: 9/9 requirements covered (100%)', 'outcome', 3)]
    );
    expect(merged.filter((e) => e.kind === 'outcome')).toHaveLength(1);
    expect(merged.find((e) => e.kind === 'outcome')?.turn).toBe(3);
    expect(merged.find((e) => e.kind === 'constraint')).toBeDefined();
  });

  it('caps at the limit, evicting the oldest', () => {
    const existing = Array.from({ length: SESSION_MEMORY_LIMIT }, (_, i) => entry(`fact ${i}`, 'constraint', i + 1));
    const merged = mergeSessionMemory(existing, [entry('newest fact', 'constraint', 99)]);
    expect(merged).toHaveLength(SESSION_MEMORY_LIMIT);
    expect(merged.at(-1)?.text).toBe('newest fact');
    expect(merged.some((e) => e.text === 'fact 0')).toBe(false);
  });
});

describe('deriveBriefMemory', () => {
  it('derives constraints, assumptions and selections deterministically', () => {
    const entries = deriveBriefMemory(
      {
        constraints: ['PCI compliance required'],
        scaleAssumptions: [{ key: 'traffic', value: '10k req/day', source: 'defaulted' }],
        selections: [{ need: 'relational storage', serviceId: 'aws-aurora' }],
      },
      3
    );
    expect(entries).toEqual([
      { kind: 'constraint', text: 'PCI compliance required', turn: 3 },
      { kind: 'preference', text: 'traffic: 10k req/day (defaulted)', turn: 3 },
      { kind: 'decision', text: 'Selected aws-aurora for relational storage', turn: 3 },
    ]);
  });

  it('handles an empty brief', () => {
    expect(deriveBriefMemory({}, 1)).toEqual([]);
  });
});

describe('renderSessionMemory', () => {
  it('returns empty for no entries and renders the header plus one line per entry', () => {
    expect(renderSessionMemory([])).toBe('');
    const block = renderSessionMemory([entry('budget cap'), entry('picked aurora', 'decision', 2)]);
    expect(block).toContain('SESSION MEMORY');
    expect(block).toContain('- [constraint] budget cap');
    expect(block).toContain('- [decision] picked aurora');
  });

  it('keeps the newest entries when the budget is tight, rendered oldest-first', () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`long durable fact number ${i} with padding text`, 'constraint', i + 1));
    const block = renderSessionMemory(entries, 300);
    expect(block).toContain('fact number 29');
    expect(block).not.toContain('fact number 0 ');
    const lines = block.split('\n').slice(1);
    const nums = lines.map((l) => Number(/number (\d+)/.exec(l)?.[1]));
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });
});
