import { describe, expect, it } from 'vitest';
import { sliceIntoChunks } from '@/lib/generate/orchestrator';
import { CHUNK_SIZE } from '@/lib/generate/loop-config';

/**
 * Defensive code-side slicing backstop (005 research R2): guarantees the
 * progressive build-up (FR-001/002/003, SC-001) holds even when a single plan
 * response doesn't self-limit to CHUNK_SIZE new adds.
 */

const basePlan = (overrides: Record<string, unknown> = {}) => ({
  reply: 'Done.',
  moreNeeded: false,
  add: [] as { serviceId: string }[],
  remove: [] as string[],
  update: [] as { nodeId: string; config: Record<string, string> }[],
  edges: [] as { source: string; target: string }[],
  guidance: {},
  containers: { add: [], update: [], remove: [], assignMembers: [] },
  ...overrides,
});

const noNodes = { nodes: [] };

describe('sliceIntoChunks', () => {
  it('splits more-than-CHUNK_SIZE new adds into ordered groups of at most CHUNK_SIZE', () => {
    const add = Array.from({ length: 6 }, (_, i) => ({ serviceId: `svc-${i}` }));
    const plan = basePlan({ add });
    const groups = sliceIntoChunks(plan, noNodes);

    const expectedGroupCount = Math.ceil(6 / CHUNK_SIZE);
    expect(groups).toHaveLength(expectedGroupCount);
    for (const g of groups) expect(g.addIdx.length).toBeLessThanOrEqual(CHUNK_SIZE);
    // Every add index appears exactly once, across all groups, in ascending order.
    expect(groups.flatMap((g) => g.addIdx)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('defers an edge referencing a node only present in a later group', () => {
    const add = Array.from({ length: 6 }, (_, i) => ({ serviceId: `svc-${i}` }));
    // new:0 is in the first group; new:5 only exists once the last group applies.
    const edges = [{ source: 'new:0', target: 'new:5' }];
    const plan = basePlan({ add, edges });
    const groups = sliceIntoChunks(plan, noNodes);
    const lastGroupIdx = groups.length - 1;

    expect(groups[0].edgeIdx).not.toContain(0);
    expect(groups[lastGroupIdx].edgeIdx).toContain(0);
  });

  it('produces exactly one group for a plan with CHUNK_SIZE or fewer adds', () => {
    const add = Array.from({ length: Math.min(3, CHUNK_SIZE) }, (_, i) => ({ serviceId: `svc-${i}` }));
    const plan = basePlan({ add });
    const groups = sliceIntoChunks(plan, noNodes);
    expect(groups).toHaveLength(1);
    expect(groups[0].addIdx).toEqual(add.map((_, i) => i));
  });

  it('produces exactly one group carrying all update/remove when there are no adds', () => {
    const plan = basePlan({
      update: [{ nodeId: 'n1', config: { memory: '512' } }, { nodeId: 'n2', config: { memory: '1024' } }],
      remove: ['n3'],
    });
    const groups = sliceIntoChunks(plan, noNodes);
    expect(groups).toHaveLength(1);
    expect(groups[0].addIdx).toEqual([]);
    expect(groups[0].updateIdx).toEqual([0, 1]);
    expect(groups[0].removeIdx).toEqual([0]);
  });

  it('places an edge between two existing (non-new:) nodes in the first group', () => {
    const add = Array.from({ length: 6 }, (_, i) => ({ serviceId: `svc-${i}` }));
    const edges = [{ source: 'existing1', target: 'existing2' }];
    const plan = basePlan({ add, edges });
    const groups = sliceIntoChunks(plan, noNodes);
    expect(groups[0].edgeIdx).toContain(0);
  });
});
