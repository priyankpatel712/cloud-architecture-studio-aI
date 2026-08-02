import { describe, expect, it } from 'vitest';
import {
  degradedWalkthrough,
  sanitizeWalkthrough,
  walkthroughFacts,
  MAX_WALKTHROUGH_STEPS,
  type WalkthroughArch,
} from '@/lib/generate/walkthrough-core';

/**
 * The client-report walkthrough hinges on one contract: every step's nodeIds
 * point at REAL diagram nodes, because the PDF renders the diagram section for
 * exactly those ids next to the step. sanitize enforces that against LLM
 * output; the degraded fallback must honor it by construction.
 */

const node = (nodeId: string, displayName?: string): WalkthroughArch['nodes'][number] => ({
  nodeId,
  serviceId: 'aws-lambda',
  displayName,
  config: {},
  cost: 0,
});

const arch = (
  nodes: WalkthroughArch['nodes'],
  edges: WalkthroughArch['edges'] = []
): WalkthroughArch => ({ nodes, edges });

const A = arch([node('a', 'Alpha'), node('b', 'Beta'), node('c', 'Gamma')]);

describe('sanitizeWalkthrough', () => {
  it('keeps valid steps in order and passes prose through trimmed', () => {
    const out = sanitizeWalkthrough(
      {
        introduction: '  intro  ',
        steps: [
          { title: 'One', explanation: 'First.', nodeIds: ['a'] },
          { title: 'Two', explanation: 'Second.', nodeIds: ['b', 'c'] },
        ],
        conclusion: ' done ',
      },
      A
    );
    expect(out).not.toBeNull();
    expect(out!.introduction).toBe('intro');
    expect(out!.conclusion).toBe('done');
    expect(out!.steps.map((s) => s.title)).toEqual(['One', 'Two']);
  });

  it('drops unknown node ids inside a step but keeps the step', () => {
    const out = sanitizeWalkthrough(
      { steps: [{ title: 'T', explanation: 'E.', nodeIds: ['ghost', 'a', 'phantom'] }] },
      A
    );
    expect(out!.steps[0].nodeIds).toEqual(['a']);
  });

  it('drops a step whose node ids are ALL invented — no section pointing nowhere', () => {
    const out = sanitizeWalkthrough(
      {
        steps: [
          { title: 'Real', explanation: 'E.', nodeIds: ['a'] },
          { title: 'Invented', explanation: 'E.', nodeIds: ['ghost'] },
        ],
      },
      A
    );
    expect(out!.steps).toHaveLength(1);
    expect(out!.steps[0].title).toBe('Real');
  });

  it('drops steps with empty title or explanation and dedupes repeated ids', () => {
    const out = sanitizeWalkthrough(
      {
        steps: [
          { title: '', explanation: 'E.', nodeIds: ['a'] },
          { title: 'T', explanation: '   ', nodeIds: ['a'] },
          { title: 'Kept', explanation: 'E.', nodeIds: ['a', 'a', 'b'] },
        ],
      },
      A
    );
    expect(out!.steps).toHaveLength(1);
    expect(out!.steps[0].nodeIds).toEqual(['a', 'b']);
  });

  it('returns null when nothing survives — the caller degrades honestly', () => {
    expect(sanitizeWalkthrough({ steps: [] }, A)).toBeNull();
    expect(sanitizeWalkthrough({ steps: 'not-an-array' }, A)).toBeNull();
    expect(
      sanitizeWalkthrough({ steps: [{ title: 'T', explanation: 'E.', nodeIds: ['ghost'] }] }, A)
    ).toBeNull();
  });

  it(`caps at ${MAX_WALKTHROUGH_STEPS} steps`, () => {
    const steps = Array.from({ length: MAX_WALKTHROUGH_STEPS + 5 }, (_, i) => ({
      title: `S${i}`,
      explanation: 'E.',
      nodeIds: ['a'],
    }));
    expect(sanitizeWalkthrough({ steps }, A)!.steps).toHaveLength(MAX_WALKTHROUGH_STEPS);
  });

  it('tolerates non-string intro/conclusion (→ empty, never a crash)', () => {
    const out = sanitizeWalkthrough(
      { introduction: 42, steps: [{ title: 'T', explanation: 'E.', nodeIds: ['a'] }], conclusion: null },
      A
    );
    expect(out!.introduction).toBe('');
    expect(out!.conclusion).toBe('');
  });
});

describe('degradedWalkthrough', () => {
  it('narrates a chain in flow order, one stage per BFS depth', () => {
    const w = degradedWalkthrough(
      arch(
        [node('a', 'Alpha'), node('b', 'Beta'), node('c', 'Gamma')],
        [
          { source: 'b', target: 'c', label: 'stores' },
          { source: 'a', target: 'b' },
        ]
      )
    );
    expect(w.degraded).toBe(true);
    expect(w.steps).toHaveLength(2);
    expect(w.steps[0].nodeIds).toEqual(['a', 'b']);
    expect(w.steps[1].nodeIds).toEqual(['b', 'c']);
    expect(w.steps[1].explanation).toContain('stores');
  });

  it('groups a fan-out at the same depth into one stage', () => {
    const w = degradedWalkthrough(
      arch(
        [node('a', 'Alpha'), node('b', 'Beta'), node('c', 'Gamma')],
        [
          { source: 'a', target: 'b' },
          { source: 'a', target: 'c' },
        ]
      )
    );
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0].nodeIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('appends unconnected services as a final supporting-services step', () => {
    const w = degradedWalkthrough(
      arch([node('a', 'Alpha'), node('b', 'Beta'), node('x', 'Watcher')], [{ source: 'a', target: 'b' }])
    );
    const last = w.steps[w.steps.length - 1];
    expect(last.title).toBe('Supporting services');
    expect(last.nodeIds).toEqual(['x']);
    expect(last.explanation).toContain('Watcher');
  });

  it('with no edges at all, still walks every service in one honest step', () => {
    const w = degradedWalkthrough(A);
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0].title).toBe('Services in this solution');
    expect(w.steps[0].nodeIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores edges whose endpoints are not on the diagram', () => {
    const w = degradedWalkthrough(arch([node('a', 'Alpha')], [{ source: 'a', target: 'ghost' }]));
    // the broken edge contributes no stage; 'a' falls back to the services step
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0].nodeIds).toEqual(['a']);
  });
});

describe('walkthroughFacts', () => {
  it('exposes every node id verbatim so steps can cite them', () => {
    const facts = walkthroughFacts(
      arch([node('web-1', 'Frontend'), node('db-1', 'Database')], [{ source: 'web-1', target: 'db-1', label: 'reads' }])
    );
    expect(facts).toContain('id=web-1');
    expect(facts).toContain('id=db-1');
    expect(facts).toContain('"Frontend"');
    expect(facts).toContain('- web-1 -> db-1 (reads)');
  });
});
