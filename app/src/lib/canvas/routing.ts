/**
 * Orthogonal edge routing (002 FR-001/FR-002, research R1).
 *
 * Pure geometry — no React Flow imports — so it is unit-testable. Computes a
 * right-angle path between two node anchors that avoids node bounding boxes where
 * a clear channel exists and degrades to a best-effort path otherwise (a
 * connection never disappears — spec edge case). Manual waypoints are routed
 * through verbatim and therefore survive endpoint moves.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Side = 'left' | 'right' | 'top' | 'bottom';

const STUB = 24; // clearance before the first bend
const MARGIN = 12; // obstacle inflation

function stubPoint(p: Pt, side: Side, distance = STUB): Pt {
  switch (side) {
    case 'left':
      return { x: p.x - distance, y: p.y };
    case 'right':
      return { x: p.x + distance, y: p.y };
    case 'top':
      return { x: p.x, y: p.y - distance };
    case 'bottom':
      return { x: p.x, y: p.y + distance };
  }
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/** Does the axis-aligned segment a→b cross the rect? */
function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return minX < r.x + r.width && maxX > r.x && minY < r.y + r.height && maxY > r.y;
}

function pathCost(points: Pt[], obstacles: Rect[]): number {
  let hits = 0;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (const o of obstacles) if (segmentHitsRect(a, b, o)) hits++;
  }
  // Obstacle hits dominate; bends and length break ties.
  return hits * 100_000 + (points.length - 2) * 500 + length;
}

/** Remove collinear and duplicate intermediate points. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Orthogonal connection of two points: try both bend orders. */
function elbowCandidates(a: Pt, b: Pt): Pt[][] {
  if (a.x === b.x || a.y === b.y) return [[a, b]];
  return [
    [a, { x: b.x, y: a.y }, b], // horizontal first
    [a, { x: a.x, y: b.y }, b], // vertical first
  ];
}

/**
 * Compute the orthogonal route. Returns the full point list including the two
 * anchor endpoints. `obstacles` should be the bounding boxes of nodes other than
 * the two endpoint nodes.
 */
export function orthogonalRoute(
  source: Pt,
  sourceSide: Side,
  target: Pt,
  targetSide: Side,
  obstacles: Rect[] = [],
  waypoints: Pt[] = []
): Pt[] {
  const inflated = obstacles.map((o) => inflate(o, MARGIN));
  const start = stubPoint(source, sourceSide);
  const end = stubPoint(target, targetSide);

  // Manual waypoints: honored verbatim (FR-002) — thread orthogonally through them.
  if (waypoints.length > 0) {
    const anchors = [start, ...waypoints, end];
    const points: Pt[] = [source];
    for (let i = 0; i < anchors.length - 1; i++) {
      const legs = elbowCandidates(anchors[i], anchors[i + 1]);
      const best = legs.reduce((p, c) => (pathCost(c, inflated) <= pathCost(p, inflated) ? c : p));
      points.push(...(i === 0 ? best : best.slice(1)));
    }
    points.push(target);
    return simplify(points);
  }

  // Candidate mid-channels: direct elbows plus channels shifted around obstacles.
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const xChannels = new Set<number>([midX, start.x, end.x]);
  const yChannels = new Set<number>([midY, start.y, end.y]);
  for (const o of inflated) {
    xChannels.add(o.x - 1);
    xChannels.add(o.x + o.width + 1);
    yChannels.add(o.y - 1);
    yChannels.add(o.y + o.height + 1);
  }

  const candidates: Pt[][] = [...elbowCandidates(start, end)];
  for (const x of xChannels) {
    candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  }
  for (const y of yChannels) {
    candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  }

  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = pathCost(c, inflated);
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }

  // Best-effort even when every candidate crosses something (never disappears).
  return simplify([source, ...best, target]);
}

/** Points → SVG path with rounded corners. */
export function pointsToSvgPath(points: Pt[], radius = 8): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    const outLen = Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${cur.x},${cur.y}`;
      continue;
    }
    const inDir = { x: Math.sign(cur.x - prev.x), y: Math.sign(cur.y - prev.y) };
    const outDir = { x: Math.sign(next.x - cur.x), y: Math.sign(next.y - cur.y) };
    d += ` L ${cur.x - inDir.x * r},${cur.y - inDir.y * r}`;
    d += ` Q ${cur.x},${cur.y} ${cur.x + outDir.x * r},${cur.y + outDir.y * r}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/** Midpoint of the longest segment — label anchor + waypoint drag handle position. */
export function pathMidpoint(points: Pt[]): Pt {
  let bestLen = -1;
  let mid: Pt = points[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > bestLen) {
      bestLen = len;
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return mid;
}
