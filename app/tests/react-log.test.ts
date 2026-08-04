import { describe, expect, it } from 'vitest';
import { createReActLog, type ReActEntry } from '@/lib/agent/react-log';

/**
 * ReAct log (lib/agent/react-log.ts) — the Thought → Action → Observation
 * transcript the agent loop streams into the trace as 'reason' steps.
 */

describe('createReActLog', () => {
  it('records thought/action/observation entries in order', () => {
    const log = createReActLog();
    log.thought('Requirements Analyst', '3 requirements to cover', 1);
    log.action('Architect', 'drafting the architecture', 1);
    log.observation('Reviewer', '2/3 requirements covered (67%)', 1);
    expect(log.entries.map((e) => e.phase)).toEqual(['thought', 'action', 'observation']);
    expect(log.entries[1].agent).toBe('Architect');
  });

  it('streams each entry to the sink with its index as it is appended', () => {
    const seen: [ReActEntry, number][] = [];
    const log = createReActLog((e, i) => seen.push([e, i]));
    log.thought('A', 'first', 1);
    log.action('B', 'second', 2);
    expect(seen.map(([e, i]) => [i, e.text])).toEqual([[0, 'first'], [1, 'second']]);
  });

  it('drops empty text and truncates oversized text', () => {
    const log = createReActLog();
    log.thought('A', '   ', 1);
    expect(log.entries).toHaveLength(0);
    log.thought('A', 'x'.repeat(500), 1);
    expect(log.entries[0].text.length).toBeLessThanOrEqual(281); // 280 + ellipsis
  });

  it('renders a bounded transcript', () => {
    const log = createReActLog();
    log.thought('Analyst', 'plan the work', 1);
    log.observation('Reviewer', 'all requirements met', 2);
    const rendered = log.render();
    expect(rendered).toContain('Thought[1] Analyst: plan the work');
    expect(rendered).toContain('Observation[2] Reviewer: all requirements met');
    expect(log.render(30).split('\n')).toHaveLength(1);
  });
});
