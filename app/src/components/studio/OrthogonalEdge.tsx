'use client';
import { memo, useMemo, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getStraightPath,
  useReactFlow,
  useStoreApi,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import {
  orthogonalRoute,
  pointsToSvgPath,
  pathMidpoint,
  type Pt,
  type Rect,
  type Side,
} from '@/lib/canvas/routing';
import {
  DEFAULT_EDGE_STYLE,
  EDGE_COLORS,
  absolutePosition,
  type OrthogonalEdgeData,
} from '@/lib/canvas/model';

/**
 * Custom edge (002 FR-001/002/012, research R1): orthogonal auto-routing by
 * default with straight/curved variants, label, constrained style tokens, and
 * draggable waypoints. Obstacles are read imperatively from the store when the
 * edge's own endpoints change, so only moved edges re-route (research R10) —
 * an edge crossing an unrelated moved node re-routes on its next own change.
 */

const positionToSide: Record<Position, Side> = {
  [Position.Left]: 'left',
  [Position.Right]: 'right',
  [Position.Top]: 'top',
  [Position.Bottom]: 'bottom',
};

function OrthogonalEdgeImpl(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    label,
    markerEnd,
    markerStart,
  } = props;
  const data = (props.data ?? {}) as Partial<OrthogonalEdgeData>;
  const edgeStyle = { ...DEFAULT_EDGE_STYLE, ...data.edgeStyle };
  const waypoints = data.waypoints ?? [];
  const waypointsKey = JSON.stringify(waypoints);

  const store = useStoreApi();
  const { setEdges, screenToFlowPosition } = useReactFlow();
  const dragging = useRef<{ index: number } | null>(null);

  const { path, mid } = useMemo(() => {
    if (edgeStyle.geometry === 'straight') {
      const [p] = getStraightPath({ sourceX, sourceY, targetX, targetY });
      return { path: p, mid: { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 } };
    }
    if (edgeStyle.geometry === 'curved') {
      const [p, labelX, labelY] = getBezierPath({
        sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
      });
      return { path: p, mid: { x: labelX, y: labelY } };
    }
    // Orthogonal: route around service-node bounds (containers/annotations are
    // boundaries the edge may cross). Imperative read — no store subscription.
    const nodes = store.getState().nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const obstacles: Rect[] = [];
    for (const n of nodes) {
      if (n.id === source || n.id === target) continue;
      if (n.type !== 'service') continue;
      const pos = absolutePosition(n, byId);
      const w = n.measured?.width ?? n.width ?? 188;
      const h = n.measured?.height ?? n.height ?? 88;
      obstacles.push({ x: pos.x, y: pos.y, width: w, height: h });
    }
    const points = orthogonalRoute(
      { x: sourceX, y: sourceY },
      positionToSide[sourcePosition],
      { x: targetX, y: targetY },
      positionToSide[targetPosition],
      obstacles,
      waypoints
    );
    return { path: pointsToSvgPath(points), mid: pathMidpoint(points) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    edgeStyle.geometry,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    waypointsKey,
  ]);

  const stroke = EDGE_COLORS[edgeStyle.color];

  const updateWaypoints = (next: Pt[]) => {
    setEdges((eds: Edge[]) =>
      eds.map((e) =>
        e.id === id ? { ...e, data: { ...e.data, edgeStyle, waypoints: next } } : e
      )
    );
  };

  const startWaypointDrag = (event: React.PointerEvent, index: number) => {
    event.stopPropagation();
    event.preventDefault();
    dragging.current = { index };
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const next = [...waypoints];
      next[dragging.current.index] = { x: Math.round(p.x), y: Math.round(p.y) };
      updateWaypoints(next);
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const addWaypoint = (event: React.PointerEvent) => {
    event.stopPropagation();
    const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    updateWaypoints([...waypoints, { x: Math.round(p.x), y: Math.round(p.y) }]);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          stroke,
          strokeWidth: data.walk === 'active' ? 2.5 : selected ? 2.25 : 1.5,
          strokeDasharray: data.walk === 'active' ? '7 5' : edgeStyle.pattern === 'dashed' ? '7 5' : undefined,
          // dashdraw keyframes ship with the React Flow stylesheet (used by its
          // built-in `.animated` edges) — reuse them for the walkthrough pulse.
          animation: data.walk === 'active' ? 'dashdraw 0.45s linear infinite' : undefined,
          opacity: data.walk === 'dim' ? 0.15 : 1,
          transition: 'opacity 200ms',
        }}
      />
      {(label || selected) && (
        <EdgeLabelRenderer>
          {label ? (
            <div
              className="nodrag nopan pointer-events-auto absolute rounded-md border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]"
              style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y - (selected ? 14 : 0)}px)` }}
            >
              {label}
            </div>
          ) : null}
          {selected && edgeStyle.geometry === 'orthogonal' && (
            <>
              {waypoints.map((wp, i) => (
                <button
                  key={`${i}-${wp.x}-${wp.y}`}
                  aria-label={`Move waypoint ${i + 1}`}
                  onPointerDown={(e) => startWaypointDrag(e, i)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    updateWaypoints(waypoints.filter((_, x) => x !== i));
                  }}
                  title="Drag to move · double-click to remove"
                  className="nodrag nopan pointer-events-auto absolute h-3 w-3 cursor-move rounded-full border-2 border-white bg-[var(--color-primary)] shadow"
                  style={{ transform: `translate(-50%, -50%) translate(${wp.x}px, ${wp.y}px)` }}
                />
              ))}
              <button
                aria-label="Add waypoint"
                onPointerDown={addWaypoint}
                title="Add a waypoint to bend this connection"
                className="nodrag nopan pointer-events-auto absolute flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] text-[10px] leading-none text-[var(--color-text-secondary)] shadow-sm"
                style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y + 14}px)` }}
              >
                +
              </button>
            </>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const OrthogonalEdge = memo(OrthogonalEdgeImpl);
