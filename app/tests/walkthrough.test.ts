import { describe, expect, it } from 'vitest';
import { computeFlowSteps } from '@/lib/canvas/walkthrough';

/** Flow walkthrough ordering (007 roadmap 3.1) — BFS from entry points. */
describe('computeFlowSteps', () => {
  const nodes = [
    { id: 'cdn', name: 'CDN' },
    { id: 'api', name: 'API Gateway' },
    { id: 'svc', name: 'Service' },
    { id: 'db', name: 'Database' },
    { id: 'q', name: 'Queue' },
  ];

  it('orders edges BFS from the entry point, one step per connection', () => {
    const steps = computeFlowSteps(nodes, [
      { edgeId: 'e3', source: 'svc', target: 'db', label: 'reads/writes' },
      { edgeId: 'e1', source: 'cdn', target: 'api' },
      { edgeId: 'e2', source: 'api', target: 'svc' },
      { edgeId: 'e4', source: 'svc', target: 'q' },
    ]);
    expect(steps.map((s) => s.edgeId)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(steps[0].caption).toBe('CDN → API Gateway');
    expect(steps[2].caption).toBe('Service → Database — reads/writes');
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it('appends edges unreachable from entry points (cycles/islands) after the main flow', () => {
    const steps = computeFlowSteps(
      [...nodes, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      [
        { edgeId: 'main', source: 'cdn', target: 'api' },
        // a <-> b is a pure 2-cycle — no entry point reaches it.
        { edgeId: 'c1', source: 'a', target: 'b' },
        { edgeId: 'c2', source: 'b', target: 'a' },
      ]
    );
    expect(steps.map((s) => s.edgeId)).toEqual(['main', 'c1', 'c2']);
  });

  it('handles a fully cyclic graph by treating every node as an entry point', () => {
    const steps = computeFlowSteps(
      [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }],
      [
        { edgeId: 'e1', source: 'x', target: 'y' },
        { edgeId: 'e2', source: 'y', target: 'x' },
      ]
    );
    expect(steps).toHaveLength(2);
  });

  it('drops edges with missing endpoints and returns [] for empty inputs', () => {
    expect(computeFlowSteps(nodes, [{ edgeId: 'e1', source: 'cdn', target: 'ghost' }])).toEqual([]);
    expect(computeFlowSteps([], [])).toEqual([]);
    expect(computeFlowSteps(nodes, [])).toEqual([]);
  });
});
