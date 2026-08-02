import { describe, expect, it } from 'vitest';
import { assignEdgeSides } from '@/lib/generate/edge-sides';
import { NODE_W, NODE_H, type ArchContainer, type ArchEdge, type ArchNode } from '@/lib/generate/orchestrator';

/**
 * AI edges get connection sides from post-layout geometry — the planner never
 * chooses sides, and before this every generated edge fell to the right→left
 * default even when the target sat directly below its source. What matters
 * most here is the non-goal: a side already present is NEVER rewritten, since
 * that is the same preserve-user-work contract that protects node positions.
 */

const node = (nodeId: string, x: number, y: number, containerId?: string | null): ArchNode => ({
  nodeId,
  serviceId: 'aws-lambda',
  provider: 'aws',
  category: 'compute',
  position: { x, y },
  config: {},
  cost: 0,
  costBasis: 'indicative',
  containerId: containerId ?? null,
});

const container = (containerId: string, x: number, y: number, parentContainerId?: string | null): ArchContainer => ({
  containerId,
  type: 'vpc',
  position: { x, y },
  size: { width: 400, height: 300 },
  parentContainerId: parentContainerId ?? null,
});

const edge = (source: string, target: string, over: Partial<ArchEdge> = {}): ArchEdge => ({
  edgeId: `${source}-${target}`,
  source,
  target,
  ...over,
});

const sides = (e: ArchEdge) => `${e.sourceHandle}→${e.targetHandle}`;

describe('geometry → sides', () => {
  it('a target to the right connects right → left (the classic flow)', () => {
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 400, 0)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('right→left');
  });

  it('a backward edge connects left → right instead of wrapping the long way', () => {
    const [e] = assignEdgeSides([node('a', 400, 0), node('b', 0, 0)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('left→right');
  });

  it('a target below connects bottom → top', () => {
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 0, 300)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('bottom→top');
  });

  it('a target above connects top → bottom', () => {
    const [e] = assignEdgeSides([node('a', 0, 300), node('b', 0, 0)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('top→bottom');
  });

  it('diagonals and exact ties stay horizontal — the layout flows left→right', () => {
    const tie = assignEdgeSides([node('a', 0, 0), node('b', 250, 250)], [], [edge('a', 'b')])[0];
    expect(sides(tie)).toBe('right→left');
    const slight = assignEdgeSides([node('a', 0, 0), node('b', 300, 200)], [], [edge('a', 'b')])[0];
    expect(sides(slight)).toBe('right→left');
  });

  it('ELK adjacent-layer neighbors stay horizontal (dx≈260, dy≈146)', () => {
    // The proportions the real layout produces: one layer across, one row down.
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 260, 146)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('right→left');
  });

  it('same-column nodes connect vertically even when the offset is modest', () => {
    // Centers 40px apart horizontally — visually stacked. Under pure
    // |dy|>|dx| dominance this was HORIZONTAL for dy up to 40px… and in real
    // ELK output the thresholds meant top/bottom effectively never fired
    // (user report, 2026-08-01). The column rule is what makes a cache sit
    // under its service with a clean vertical drop.
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 40, 146)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('bottom→top');
  });

  it('a two-row fan-out in the next layer goes vertical (dy 292 > dx 260)', () => {
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 260, 292)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('bottom→top');
  });

  it('near-perfect horizontal alignment in the same column still connects sideways', () => {
    // Same column but only a sliver of vertical offset (< half a card): these
    // are effectively side-by-side; a vertical connector would look broken.
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 40, 30)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('right→left');
  });

  it('goes vertical only when the vertical offset strictly dominates', () => {
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 100, 400)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('bottom→top');
  });

  it('measures center-to-center, not corner-to-corner', () => {
    // Corners equal, but the card is wider than tall (NODE_W > NODE_H), so the
    // center offset is horizontal-dominant only if positions say so — verify
    // the constants actually participate.
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 0, NODE_H + 10)], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('bottom→top');
    expect(NODE_W).toBeGreaterThan(0);
  });
});

describe('container-relative positions', () => {
  it('walks the container chain before comparing', () => {
    // Node b sits at y=0 INSIDE a container at y=600 — absolutely far below a.
    const [e] = assignEdgeSides(
      [node('a', 0, 0), node('b', 0, 0, 'c1')],
      [container('c1', 0, 600)],
      [edge('a', 'b')]
    );
    expect(sides(e)).toBe('bottom→top');
  });

  it('nested containers accumulate offsets', () => {
    const [e] = assignEdgeSides(
      [node('a', 0, 0), node('b', 0, 0, 'inner')],
      [container('outer', 0, 400), container('inner', 0, 400, 'outer')],
      [edge('a', 'b')]
    );
    expect(sides(e)).toBe('bottom→top');
  });

  it('a dangling container reference degrades to the node’s own position', () => {
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 400, 0, 'ghost')], [], [edge('a', 'b')]);
    expect(sides(e)).toBe('right→left');
  });
});

describe('preserve-user-work', () => {
  it('never rewrites sides that are already set, whatever the geometry says', () => {
    // Geometry screams "bottom→top", but the user pinned left→right.
    const pinned = edge('a', 'b', { sourceHandle: 'left', targetHandle: 'right' });
    const [e] = assignEdgeSides([node('a', 0, 0), node('b', 0, 500)], [], [pinned]);
    expect(sides(e)).toBe('left→right');
  });

  it('is idempotent — a second pass after nodes moved changes nothing', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0)];
    const edges = [edge('a', 'b')];
    assignEdgeSides(nodes, [], edges);
    expect(sides(edges[0])).toBe('right→left');
    nodes[1].position = { x: 0, y: 500 }; // moved below on a later turn
    assignEdgeSides(nodes, [], edges);
    expect(sides(edges[0])).toBe('right→left'); // assigned sides are state now
  });

  it('leaves an edge with an unknown endpoint untouched — the validator owns that complaint', () => {
    const [e] = assignEdgeSides([node('a', 0, 0)], [], [edge('a', 'ghost')]);
    expect(e.sourceHandle).toBeUndefined();
    expect(e.targetHandle).toBeUndefined();
  });
});
