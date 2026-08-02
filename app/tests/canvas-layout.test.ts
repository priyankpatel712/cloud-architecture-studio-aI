import { describe, expect, it } from 'vitest';
import { layoutWithElk } from '@/lib/canvas/layout';

/** elkjs auto-arrange adapter (002 FR-018, research R4). */
describe('layoutWithElk', () => {
  it('positions every node in a flat graph', async () => {
    const nodes = [
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 100, height: 50 },
      { id: 'c', width: 100, height: 50 },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const result = await layoutWithElk(nodes, edges, new Set());
    expect(result.positions.size).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      const pos = result.positions.get(id);
      expect(pos).toBeDefined();
      expect(Number.isFinite(pos!.x)).toBe(true);
      expect(Number.isFinite(pos!.y)).toBe(true);
    }
  });

  it('lays out container members inside their container and sizes the container to fit', async () => {
    const nodes = [
      { id: 'vpc', width: 400, height: 300 },
      { id: 'svc1', width: 100, height: 50, parentId: 'vpc' },
      { id: 'svc2', width: 100, height: 50, parentId: 'vpc' },
    ];
    const edges = [{ id: 'e1', source: 'svc1', target: 'svc2' }];
    const result = await layoutWithElk(nodes, edges, new Set(['vpc']));
    expect(result.positions.has('svc1')).toBe(true);
    expect(result.positions.has('svc2')).toBe(true);
    const containerSize = result.sizes.get('vpc');
    expect(containerSize).toBeDefined();
    expect(containerSize!.width).toBeGreaterThan(0);
    expect(containerSize!.height).toBeGreaterThan(0);
  });

  it('scopes layout to a selection, leaving out-of-scope nodes untouched', async () => {
    const nodes = [
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 100, height: 50 },
    ];
    const result = await layoutWithElk(nodes, [], new Set(), new Set(['a']));
    expect(result.positions.has('a')).toBe(true);
    expect(result.positions.has('b')).toBe(false);
  });

  it('lays out a deep AWS-style hierarchy with cross-container edges (regression: elkjs crash "reading \'a\'")', async () => {
    // cloud > region > vpc > az > subnet plus a separate project > cluster,
    // with edges crossing hierarchy levels — the shape that crashed elkjs when
    // considerModelOrder was set on nested containers ("Arranging the diagram —
    // failed" in the studio).
    const containers = new Set(['cloud', 'region', 'vpc', 'az', 'subnet', 'project', 'cluster']);
    const nodes = [
      { id: 'cloud', width: 480, height: 360 },
      { id: 'region', width: 480, height: 360, parentId: 'cloud' },
      { id: 'vpc', width: 480, height: 360, parentId: 'region' },
      { id: 'az', width: 480, height: 360, parentId: 'vpc' },
      { id: 'subnet', width: 480, height: 360, parentId: 'az' },
      { id: 'project', width: 480, height: 360 },
      { id: 'cluster', width: 480, height: 360, parentId: 'project' },
      { id: 'cloudfront', width: 188, height: 98 },
      { id: 'apigw', width: 188, height: 98, parentId: 'region' },
      { id: 'lambda', width: 188, height: 98, parentId: 'region' },
      { id: 's3', width: 188, height: 98, parentId: 'region' },
      { id: 'rds', width: 188, height: 98, parentId: 'subnet' },
      { id: 'alb', width: 188, height: 98, parentId: 'subnet' },
      { id: 'atlas', width: 188, height: 98, parentId: 'cluster' },
    ];
    const edges = [
      { id: 'e1', source: 'cloudfront', target: 'apigw' },
      { id: 'e2', source: 'apigw', target: 'lambda' },
      { id: 'e3', source: 'lambda', target: 's3' },
      { id: 'e4', source: 'lambda', target: 'rds' },
      { id: 'e5', source: 'alb', target: 'lambda' },
      { id: 'e6', source: 'lambda', target: 'atlas' },
    ];
    const result = await layoutWithElk(nodes, edges, containers);
    for (const n of nodes) {
      expect(result.positions.has(n.id), `missing position for ${n.id}`).toBe(true);
    }
    // Containers with members get computed (content-fitting) sizes.
    expect(result.sizes.get('subnet')!.width).toBeGreaterThan(0);
  });

  it('keeps a childless container at its drawn size instead of collapsing it', async () => {
    const nodes = [
      { id: 'empty-box', width: 300, height: 200 },
      { id: 'svc1', width: 100, height: 50 },
    ];
    const result = await layoutWithElk(nodes, [], new Set(['empty-box']));
    const size = result.sizes.get('empty-box');
    expect(size).toEqual({ width: 300, height: 200 });
  });

  it('returns empty results for an empty graph', async () => {
    const result = await layoutWithElk([], [], new Set());
    expect(result.positions.size).toBe(0);
    expect(result.sizes.size).toBe(0);
  });
});
