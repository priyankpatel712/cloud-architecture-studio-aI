import { describe, expect, it } from 'vitest';
import { focusBounds, CAPTURE_NODE_W, CAPTURE_NODE_H } from '@/lib/canvas/capture';
import type { ArchDocument, DocContainer, DocNode } from '@/lib/canvas/model';

/**
 * focusBounds frames the diagram section printed beside each client-report
 * step. Positions are stored parent-relative, so the one thing this helper
 * must get right is absolute placement through (possibly nested, possibly
 * dangling) container chains.
 */

const node = (nodeId: string, x: number, y: number, containerId?: string | null): DocNode => ({
  nodeId,
  serviceId: 'aws-lambda',
  provider: 'aws',
  position: { x, y },
  config: {},
  cost: 0,
  containerId: containerId ?? null,
});

const container = (containerId: string, x: number, y: number, parentContainerId?: string | null): DocContainer => ({
  containerId,
  type: 'vpc',
  position: { x, y },
  size: { width: 400, height: 300 },
  parentContainerId: parentContainerId ?? null,
});

const doc = (nodes: DocNode[], containers: DocContainer[] = []): ArchDocument => ({
  nodes,
  edges: [],
  containers,
  annotations: [],
});

describe('focusBounds', () => {
  it('frames a single node with padding on all sides', () => {
    const r = focusBounds(doc([node('a', 100, 200)]), ['a'], 50)!;
    expect(r).toEqual({ x: 50, y: 150, width: CAPTURE_NODE_W + 100, height: CAPTURE_NODE_H + 100 });
  });

  it('unions multiple nodes', () => {
    const r = focusBounds(doc([node('a', 0, 0), node('b', 500, 300)]), ['a', 'b'], 0)!;
    expect(r).toEqual({ x: 0, y: 0, width: 500 + CAPTURE_NODE_W, height: 300 + CAPTURE_NODE_H });
  });

  it('resolves a contained node to absolute coordinates', () => {
    const r = focusBounds(doc([node('a', 10, 20, 'c1')], [container('c1', 600, 400)]), ['a'], 0)!;
    expect(r.x).toBe(610);
    expect(r.y).toBe(420);
  });

  it('accumulates nested container offsets', () => {
    const r = focusBounds(
      doc([node('a', 0, 0, 'inner')], [container('outer', 100, 100), container('inner', 50, 50, 'outer')]),
      ['a'],
      0
    )!;
    expect(r.x).toBe(150);
    expect(r.y).toBe(150);
  });

  it('a dangling container reference degrades to the node’s own position', () => {
    const r = focusBounds(doc([node('a', 30, 40, 'ghost')]), ['a'], 0)!;
    expect(r.x).toBe(30);
    expect(r.y).toBe(40);
  });

  it('ignores unknown ids and returns null when none exist', () => {
    const d = doc([node('a', 0, 0)]);
    expect(focusBounds(d, ['a', 'ghost'], 0)!.width).toBe(CAPTURE_NODE_W);
    expect(focusBounds(d, ['ghost'])).toBeNull();
    expect(focusBounds(d, [])).toBeNull();
  });
});
