import type { ArchDocument } from '@/lib/canvas/model';

/**
 * Capture geometry for the diagram exporters: given a set of node ids, the
 * absolute canvas rect that frames them. Document positions are stored
 * parent-relative (the load/save identity convention in model.ts), so the
 * container chain is walked — bounded, and a dangling parent contributes
 * nothing rather than breaking the export.
 */

/** Rendered service-card size the PNG exporters assume (matches studio/page.tsx). */
export const CAPTURE_NODE_W = 188;
export const CAPTURE_NODE_H = 88;

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function absolutePosition(
  node: ArchDocument['nodes'][number],
  containersById: Map<string, ArchDocument['containers'][number]>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.containerId ?? null;
  for (let hops = 0; parentId && hops < 10; hops++) {
    const parent = containersById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentContainerId ?? null;
  }
  return { x, y };
}

/**
 * Bounding rect (absolute canvas coordinates) around the given nodes, padded
 * so the capture keeps a margin of visual context. Unknown ids are ignored;
 * returns null when none of the ids exist on the canvas.
 */
export function focusBounds(doc: ArchDocument, nodeIds: string[], pad = 56): CaptureRect | null {
  const wanted = new Set(nodeIds);
  const nodes = doc.nodes.filter((n) => wanted.has(n.nodeId));
  if (nodes.length === 0) return null;

  const containersById = new Map(doc.containers.map((c) => [c.containerId, c]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = absolutePosition(n, containersById);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CAPTURE_NODE_W);
    maxY = Math.max(maxY, p.y + CAPTURE_NODE_H);
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
