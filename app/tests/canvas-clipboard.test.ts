import { describe, expect, it } from 'vitest';
import { copyToClipboard, pasteFromClipboard, duplicateSelection, hasClipboardContent } from '@/lib/canvas/clipboard';

/** Project-scoped clipboard (002 FR-009, research R6). */
describe('clipboard', () => {
  const nodes = [
    { id: 'n1', type: 'service', position: { x: 10, y: 20 }, data: { serviceId: 'aws-lambda', config: {} } },
    { id: 'n2', type: 'service', position: { x: 210, y: 20 }, data: { serviceId: 'aws-s3', config: {} } },
  ];
  const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];

  it('reports empty until something is copied', () => {
    copyToClipboard([], []);
    expect(hasClipboardContent()).toBe(false);
  });

  it('pastes fresh ids with a visible offset, preserving data', () => {
    copyToClipboard(nodes, edges);
    expect(hasClipboardContent()).toBe(true);
    const { nodes: pasted, edges: pastedEdges } = pasteFromClipboard(1);
    expect(pasted).toHaveLength(2);
    expect(pasted[0].id).not.toBe('n1');
    expect(pasted[0].position.x).toBeGreaterThan(nodes[0].position.x);
    expect(pasted[0].data).toEqual(nodes[0].data);
    // The inner edge is carried and remapped to the new ids.
    expect(pastedEdges).toHaveLength(1);
    expect(pastedEdges[0].source).toBe(pasted[0].id);
    expect(pastedEdges[0].target).toBe(pasted[1].id);
  });

  it('drops edges that reference a node outside the copied selection', () => {
    copyToClipboard([nodes[0]], edges); // n2 (edge target) isn't in the selection
    const { edges: pastedEdges } = pasteFromClipboard(2);
    expect(pastedEdges).toHaveLength(0);
  });

  it('duplicate produces new ids distinct from the originals and from repeated duplicates', () => {
    const first = duplicateSelection(nodes, edges, 10);
    const second = duplicateSelection(nodes, edges, 11);
    expect(first.nodes[0].id).not.toBe(nodes[0].id);
    expect(second.nodes[0].id).not.toBe(first.nodes[0].id);
  });

  it('keeps a copied container as the parent of its copied child', () => {
    const container = { id: 'c1', type: 'container', position: { x: 0, y: 0 }, data: { ctype: 'vpc', label: 'VPC' } };
    const child = { id: 'n1', type: 'service', parentId: 'c1', position: { x: 5, y: 5 }, data: { serviceId: 'aws-lambda', config: {} } };
    copyToClipboard([container, child], []);
    const { nodes: pasted } = pasteFromClipboard(3);
    const pastedContainer = pasted.find((n) => n.type === 'container')!;
    const pastedChild = pasted.find((n) => n.type === 'service')!;
    expect(pastedChild.parentId).toBe(pastedContainer.id);
  });

  it('keeps a reference to an un-copied parent when only the child is copied', () => {
    const child = { id: 'n1', type: 'service', parentId: 'c1', position: { x: 5, y: 5 }, data: { serviceId: 'aws-lambda', config: {} } };
    copyToClipboard([child], []);
    const { nodes: pasted } = pasteFromClipboard(4);
    expect(pasted[0].parentId).toBe('c1');
  });
});
