import { describe, expect, it } from 'vitest';
import { computeGuides } from '@/lib/canvas/guides';
import { alignBoxes, distributeBoxes } from '@/lib/canvas/align';

/** Alignment guides + snap (002 FR-003) and align/distribute transforms (FR-004). */
describe('computeGuides', () => {
  it('snaps to a sibling left-edge match within threshold', () => {
    const moving = { id: 'a', x: 103, y: 50, width: 100, height: 50 };
    const sibling = { id: 'b', x: 100, y: 300, width: 100, height: 50 };
    const result = computeGuides(moving, [sibling], 6);
    expect(result.x).toBe(100);
    expect(result.guides.some((g) => g.orientation === 'vertical')).toBe(true);
  });

  it('does not snap when nothing is within threshold', () => {
    const moving = { id: 'a', x: 300, y: 500, width: 100, height: 50 };
    const sibling = { id: 'b', x: 0, y: 0, width: 50, height: 50 };
    const result = computeGuides(moving, [sibling], 6);
    expect(result.guides).toHaveLength(0);
    expect(result).toMatchObject({ x: 300, y: 500 });
  });

  it('ignores itself when present in the sibling list', () => {
    const moving = { id: 'a', x: 10, y: 10, width: 50, height: 50 };
    const result = computeGuides(moving, [moving], 6);
    expect(result.guides).toHaveLength(0);
  });
});

describe('alignBoxes', () => {
  const boxes = [
    { id: 'a', x: 0, y: 0, width: 100, height: 40 },
    { id: 'b', x: 50, y: 200, width: 60, height: 20 },
    { id: 'c', x: 300, y: 80, width: 40, height: 40 },
  ];

  it('aligns lefts to the minimum x', () => {
    const updates = alignBoxes(boxes, 'left');
    expect(updates.get('a')).toBeUndefined(); // already at min x
    expect(updates.get('b')?.x).toBe(0);
    expect(updates.get('c')?.x).toBe(0);
  });

  it('aligns centers to the shared midpoint between the outermost edges', () => {
    // overall span: min(x)=0, max(x+width)=340 → center=170; each box lands at 170 - width/2.
    const updates = alignBoxes(boxes, 'center');
    expect(updates.get('a')?.x).toBe(120);
    expect(updates.get('b')?.x).toBe(140);
    expect(updates.get('c')?.x).toBe(150);
  });

  it('is a no-op below the 2-element minimum', () => {
    expect(alignBoxes([boxes[0]], 'left').size).toBe(0);
  });
});

describe('distributeBoxes', () => {
  it('spaces three boxes with equal gaps along the horizontal axis', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 40, y: 0, width: 50, height: 50 }, // will move
      { id: 'c', x: 300, y: 0, width: 50, height: 50 },
    ];
    const updates = distributeBoxes(boxes, 'horizontal');
    const bx = updates.get('b')!.x;
    // span = last.x + last.width - first.x = 300+50-0 = 350; totalSize = 3*50 = 150;
    // gap = (350-150)/2 = 100; b sits after a's box + one gap = 0+50+100 = 150.
    expect(bx).toBe(150);
  });

  it('is a no-op below the 3-element minimum', () => {
    const boxes = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 100, y: 0, width: 50, height: 50 },
    ];
    expect(distributeBoxes(boxes, 'horizontal').size).toBe(0);
  });
});
