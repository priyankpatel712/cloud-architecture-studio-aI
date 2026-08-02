import { describe, expect, it } from 'vitest';
import { findOverlaps, resolveOverlaps, finalizeArchitecture, type Box } from '@/lib/generate/finalize';
import { NODE_W, NODE_H, type ArchNode, type ArchEdge } from '@/lib/generate/orchestrator';

/**
 * Final alignment-and-flow pass (feature 006 T025/T027 — FR-012, research D6).
 * The overlap audit + nudge are pure; finalizeArchitecture runs elkjs for real
 * on the fresh-build path (same as the orchestrator layout tests).
 */

const box = (id: string, x: number, y: number, movable = true, w = 100, h = 100): Box => ({ id, x, y, w, h, movable });

const node = (nodeId: string, x: number, y: number, containerId: string | null = null): ArchNode => ({
  nodeId, serviceId: 'aws-lambda', provider: 'aws', category: 'Compute',
  position: { x, y }, config: {}, cost: 0, costBasis: 'indicative', containerId,
});

describe('findOverlaps', () => {
  it('detects intersecting boxes and ignores disjoint ones', () => {
    const pairs = findOverlaps([box('a', 0, 0), box('b', 50, 50), box('c', 500, 500)]);
    expect(pairs).toEqual([['a', 'b']]);
  });

  it('touching edges do not count as overlap', () => {
    expect(findOverlaps([box('a', 0, 0), box('b', 100, 0)])).toHaveLength(0);
  });
});

describe('resolveOverlaps', () => {
  it('separates two movable boxes deterministically', () => {
    const { positions, residual } = resolveOverlaps([box('a', 0, 0), box('b', 40, 10)]);
    expect(residual).toBe(0);
    const a = positions.get('a')!;
    const b = positions.get('b')!;
    expect(findOverlaps([{ ...box('a', a.x, a.y) }, { ...box('b', b.x, b.y) }])).toHaveLength(0);
  });

  it('NEVER moves an immovable box — the movable one is pushed clear (FR-012)', () => {
    const { positions, residual } = resolveOverlaps([box('user', 0, 0, false), box('ai', 20, 20, true)]);
    expect(residual).toBe(0);
    expect(positions.get('user')).toEqual({ x: 0, y: 0 });
    expect(positions.get('ai')).not.toEqual({ x: 20, y: 20 });
  });

  it('two immovable overlapping boxes are reported as residual, not forced apart (honest limit)', () => {
    const { positions, residual } = resolveOverlaps([box('u1', 0, 0, false), box('u2', 30, 30, false)]);
    expect(residual).toBe(1);
    expect(positions.get('u1')).toEqual({ x: 0, y: 0 });
    expect(positions.get('u2')).toEqual({ x: 30, y: 30 });
  });

  it('resolves a pile-up of many movable boxes within the pass budget', () => {
    const pile = Array.from({ length: 8 }, (_, i) => box(`n${i}`, 5 * i, 5 * i));
    const { positions, residual } = resolveOverlaps(pile);
    expect(residual).toBe(0);
    const after = pile.map((b) => ({ ...b, ...positions.get(b.id)! }));
    expect(findOverlaps(after)).toHaveLength(0);
  });
});

describe('finalizeArchitecture', () => {
  it('fresh build (nothing preserved): full ELK pass yields a left→right flow with no overlaps', async () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)];
    const edgeList: ArchEdge[] = [
      { edgeId: 'e1', source: 'a', target: 'b' },
      { edgeId: 'e2', source: 'b', target: 'c' },
    ];
    const result = await finalizeArchitecture({ nodes, edges: edgeList, containers: [], preserved: [] });
    expect(result.residualOverlaps).toBe(0);
    expect(result.note).toBeNull();
    const pos = Object.fromEntries(result.nodes.map((n) => [n.nodeId, n.position]));
    // ELK layered direction RIGHT: downstream layers sit strictly to the right.
    expect(pos.b.x).toBeGreaterThan(pos.a.x);
    expect(pos.c.x).toBeGreaterThan(pos.b.x);
    const boxes = result.nodes.map((n) => ({ id: n.nodeId, x: n.position.x, y: n.position.y, w: NODE_W, h: NODE_H, movable: false }));
    expect(findOverlaps(boxes)).toHaveLength(0);
  });

  it('revision: preserved nodes get their captured positions back; AI nodes are nudged clear (US3-S3)', async () => {
    const nodes = [
      node('user1', 999, 999), // the build's layout moved it; the user had it at (40, 40)
      node('ai1', 40, 40), // AI-added node the layout dropped onto the user's spot
    ];
    const result = await finalizeArchitecture({
      nodes, edges: [], containers: [],
      preserved: [{ nodeId: 'user1', x: 40, y: 40, containerId: null }],
    });
    const user1 = result.nodes.find((n) => n.nodeId === 'user1')!;
    const ai1 = result.nodes.find((n) => n.nodeId === 'ai1')!;
    expect(user1.position).toEqual({ x: 40, y: 40 }); // restored exactly
    // The AI node cannot stay on top of the restored user node.
    const boxes = [
      { id: 'user1', x: user1.position.x, y: user1.position.y, w: NODE_W, h: NODE_H, movable: false },
      { id: 'ai1', x: ai1.position.x, y: ai1.position.y, w: NODE_W, h: NODE_H, movable: false },
    ];
    expect(findOverlaps(boxes)).toHaveLength(0);
    expect(result.residualOverlaps).toBe(0);
  });

  it('a preserved node whose container membership CHANGED is not restored (old absolute position is meaningless)', async () => {
    const nodes = [node('user1', 300, 300, 'cont1')];
    const result = await finalizeArchitecture({
      nodes, edges: [],
      containers: [{ containerId: 'cont1', type: 'vpc', label: '', position: { x: 250, y: 250 }, size: { width: 480, height: 360 } }],
      preserved: [{ nodeId: 'user1', x: 40, y: 40, containerId: null }],
    });
    expect(result.nodes[0].position).toEqual({ x: 300, y: 300 });
  });

  it('reports residual overlaps honestly instead of moving preserved work (spec edge case)', async () => {
    // Two user-preserved nodes the user themselves overlapped: immovable → residual + note.
    const nodes = [node('u1', 0, 0), node('u2', 30, 30)];
    const result = await finalizeArchitecture({
      nodes, edges: [], containers: [],
      preserved: [
        { nodeId: 'u1', x: 0, y: 0, containerId: null },
        { nodeId: 'u2', x: 30, y: 30, containerId: null },
      ],
    });
    expect(result.residualOverlaps).toBeGreaterThan(0);
    expect(result.note).toContain('Auto-arrange');
    expect(result.nodes.find((n) => n.nodeId === 'u1')!.position).toEqual({ x: 0, y: 0 });
    expect(result.nodes.find((n) => n.nodeId === 'u2')!.position).toEqual({ x: 30, y: 30 });
  });

  it('audits container members against their siblings, not against root-level nodes', async () => {
    const containers = [{ containerId: 'vpc1', type: 'vpc', label: '', position: { x: 1000, y: 1000 }, size: { width: 480, height: 360 } }];
    const nodes = [
      node('m1', 40, 40, 'vpc1'),
      node('m2', 50, 50, 'vpc1'), // overlaps its sibling (parent-relative coords)
      node('root1', 45, 45, null), // same numeric coords but a different coordinate space — must not be dragged into the members' audit
    ];
    const result = await finalizeArchitecture({
      nodes, edges: [], containers,
      preserved: [{ nodeId: 'root1', x: 45, y: 45, containerId: null }],
    });
    const m1 = result.nodes.find((n) => n.nodeId === 'm1')!;
    const m2 = result.nodes.find((n) => n.nodeId === 'm2')!;
    expect(findOverlaps([
      { id: 'm1', x: m1.position.x, y: m1.position.y, w: NODE_W, h: NODE_H, movable: false },
      { id: 'm2', x: m2.position.x, y: m2.position.y, w: NODE_W, h: NODE_H, movable: false },
    ])).toHaveLength(0);
    expect(result.nodes.find((n) => n.nodeId === 'root1')!.position).toEqual({ x: 45, y: 45 });
  });
});
