/**
 * Align/distribute transforms (002 FR-004). Pure: boxes in, new top-left
 * positions out — the canvas applies the result as a single undoable step.
 */

import type { Box } from '@/lib/canvas/guides';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** Align ≥2 boxes along an edge or center line. */
export function alignBoxes(boxes: Box[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;

  const lefts = boxes.map((b) => b.x);
  const rights = boxes.map((b) => b.x + b.width);
  const tops = boxes.map((b) => b.y);
  const bottoms = boxes.map((b) => b.y + b.height);

  for (const b of boxes) {
    let { x, y } = b;
    switch (mode) {
      case 'left':
        x = Math.min(...lefts);
        break;
      case 'right':
        x = Math.max(...rights) - b.width;
        break;
      case 'center': {
        const center = (Math.min(...lefts) + Math.max(...rights)) / 2;
        x = center - b.width / 2;
        break;
      }
      case 'top':
        y = Math.min(...tops);
        break;
      case 'bottom':
        y = Math.max(...bottoms) - b.height;
        break;
      case 'middle': {
        const middle = (Math.min(...tops) + Math.max(...bottoms)) / 2;
        y = middle - b.height / 2;
        break;
      }
    }
    if (x !== b.x || y !== b.y) out.set(b.id, { x, y });
  }
  return out;
}

/** Distribute ≥3 boxes so the gaps between them are equal along one axis. */
export function distributeBoxes(
  boxes: Box[],
  axis: DistributeAxis
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 3) return out;

  const horizontal = axis === 'horizontal';
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = horizontal
    ? last.x + last.width - first.x
    : last.y + last.height - first.y;
  const totalSize = sorted.reduce((s, b) => s + (horizontal ? b.width : b.height), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  let cursor = horizontal ? first.x : first.y;
  for (const b of sorted) {
    const target = Math.round(cursor);
    if (horizontal) {
      if (target !== b.x) out.set(b.id, { x: target, y: b.y });
      cursor += b.width + gap;
    } else {
      if (target !== b.y) out.set(b.id, { x: b.x, y: target });
      cursor += b.height + gap;
    }
  }
  return out;
}
