import { describe, expect, it } from 'vitest';
import { orthogonalRoute, pointsToSvgPath, pathMidpoint, simplify } from '@/lib/canvas/routing';

/** Orthogonal routing (002 FR-001/FR-002, research R1). */
describe('orthogonalRoute', () => {
  it('connects two points with only right-angle segments', () => {
    const points = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left');
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const isAxisAligned = a.x === b.x || a.y === b.y;
      expect(isAxisAligned).toBe(true);
    }
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it('routes around an obstacle placed directly between the endpoints', () => {
    const obstacle = { x: 80, y: -50, width: 40, height: 200 };
    const points = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left', [obstacle]);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const crossesObstacle =
        minX < obstacle.x + obstacle.width && maxX > obstacle.x && minY < obstacle.y + obstacle.height && maxY > obstacle.y;
      expect(crossesObstacle).toBe(false);
    }
  });

  it('never fails to produce a path even when every channel is blocked (edge case: connection never disappears)', () => {
    // Obstacles densely packed around the direct path — no clear channel exists.
    const obstacles = Array.from({ length: 6 }, (_, i) => ({ x: 20 + i * 30, y: -20, width: 25, height: 40 }));
    const points = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left', obstacles);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it('threads through manual waypoints (FR-002 — waypoints preserved on re-route)', () => {
    const waypoint = { x: 100, y: 300 };
    const points = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left', [], [waypoint]);
    expect(points.some((p) => p.x === waypoint.x && p.y === waypoint.y)).toBe(true);
  });
});

describe('simplify', () => {
  it('collapses collinear intermediate points', () => {
    const out = simplify([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});

describe('pointsToSvgPath / pathMidpoint', () => {
  it('produces an SVG path string starting with M', () => {
    const path = pointsToSvgPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
    expect(path.startsWith('M 0,0')).toBe(true);
  });

  it('finds the midpoint of the longest segment', () => {
    const mid = pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }]);
    expect(mid).toEqual({ x: 50, y: 0 });
  });
});
