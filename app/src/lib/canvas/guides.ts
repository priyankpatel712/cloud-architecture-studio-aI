/**
 * Live alignment guides + snap math (002 FR-003, research R3).
 * Pure functions: compare a dragged box's edges/centers against sibling boxes and
 * return the guide lines to draw plus the snapped position within threshold.
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideLine {
  orientation: 'vertical' | 'horizontal';
  /** canvas coordinate of the guide line */
  position: number;
  /** extent of the line so it spans both boxes */
  from: number;
  to: number;
}

export interface GuideResult {
  guides: GuideLine[];
  /** snapped top-left position for the moving box (equals input when no match) */
  x: number;
  y: number;
}

function xAnchors(b: Box): number[] {
  return [b.x, b.x + b.width / 2, b.x + b.width];
}
function yAnchors(b: Box): number[] {
  return [b.y, b.y + b.height / 2, b.y + b.height];
}

/**
 * Compute guides for `moving` against `siblings`. Threshold is in canvas units.
 * The strongest (closest) match per axis wins and snaps the position.
 */
export function computeGuides(moving: Box, siblings: Box[], threshold = 6): GuideResult {
  let bestX: { delta: number; line: GuideLine } | null = null;
  let bestY: { delta: number; line: GuideLine } | null = null;

  const movingXs = xAnchors(moving);
  const movingYs = yAnchors(moving);

  for (const s of siblings) {
    if (s.id === moving.id) continue;

    for (const sx of xAnchors(s)) {
      for (const mx of movingXs) {
        const delta = sx - mx;
        if (Math.abs(delta) > threshold) continue;
        if (bestX && Math.abs(delta) >= Math.abs(bestX.delta)) continue;
        bestX = {
          delta,
          line: {
            orientation: 'vertical',
            position: sx,
            from: Math.min(moving.y, s.y) - 8,
            to: Math.max(moving.y + moving.height, s.y + s.height) + 8,
          },
        };
      }
    }
    for (const sy of yAnchors(s)) {
      for (const my of movingYs) {
        const delta = sy - my;
        if (Math.abs(delta) > threshold) continue;
        if (bestY && Math.abs(delta) >= Math.abs(bestY.delta)) continue;
        bestY = {
          delta,
          line: {
            orientation: 'horizontal',
            position: sy,
            from: Math.min(moving.x, s.x) - 8,
            to: Math.max(moving.x + moving.width, s.x + s.width) + 8,
          },
        };
      }
    }
  }

  return {
    guides: [...(bestX ? [bestX.line] : []), ...(bestY ? [bestY.line] : [])],
    x: moving.x + (bestX?.delta ?? 0),
    y: moving.y + (bestY?.delta ?? 0),
  };
}
