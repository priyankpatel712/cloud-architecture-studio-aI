import 'server-only';
import { layoutWithElk, type LayoutEdge, type LayoutNode } from '@/lib/canvas/layout';
import { NODE_W, NODE_H, type ArchNode, type ArchEdge, type ArchContainer } from '@/lib/generate/orchestrator';

/**
 * Final alignment-and-flow pass (feature 006 FR-012, research D6). Runs once at
 * the end of a guided flow, after the pricing option is applied (or skipped):
 *
 * - Fresh build (nothing to preserve): a full ELK layered re-layout — the same
 *   engine the toolbar's Auto-arrange uses — for a consistent left→right flow
 *   with containers wrapping their members.
 * - Revision (user-arranged elements exist): NO global re-layout. Preserved
 *   nodes get their captured pre-build positions restored (when their container
 *   membership is unchanged — a node the AI moved into a container follows the
 *   AI layout, since its old absolute position is meaningless there), and only
 *   AI-added/AI-moved nodes are nudged out of any resulting overlaps.
 * - Either way, a deterministic AABB overlap audit runs per container group
 *   (root-level elements against each other + containers; members within each
 *   container against their siblings), bounded-nudging movable boxes apart.
 *   Residual overlaps are reported honestly (spec edge case) instead of
 *   pretending the layout is clean.
 */

export interface PreservedNode {
  nodeId: string;
  x: number;
  y: number;
  containerId?: string | null;
}

export interface FinalizeInput {
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  /** pre-build position snapshot of user-arranged nodes; empty = fresh build */
  preserved: PreservedNode[];
}

export interface FinalizeResult {
  nodes: ArchNode[];
  containers: ArchContainer[];
  /** nodes whose position the pass changed (layout, restore, or nudge) */
  moved: number;
  residualOverlaps: number;
  /** honest-limit note for the assistant reply; null when the layout is clean */
  note: string | null;
}

// ---- Pure overlap audit + bounded nudge (exported for unit tests) --------------

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  movable: boolean;
}

const NUDGE_MARGIN = 24;
const MAX_NUDGE_PASSES = 40;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** All overlapping pairs, in deterministic (input) order. */
export function findOverlaps(boxes: Box[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) pairs.push([boxes[i].id, boxes[j].id]);
    }
  }
  return pairs;
}

/**
 * Bounded deterministic overlap resolution: for each overlapping pair with a
 * movable box, push the movable one (the later/rightmost when both movable)
 * along the axis of least penetration, plus a margin. Never moves an immovable
 * box, so preserved user positions are untouchable by construction.
 */
export function resolveOverlaps(input: Box[]): { positions: Map<string, { x: number; y: number }>; residual: number; movedIds: Set<string> } {
  const boxes = input.map((b) => ({ ...b }));
  const movedIds = new Set<string>();

  for (let pass = 0; pass < MAX_NUDGE_PASSES; pass++) {
    let movedThisPass = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!overlaps(a, b) || (!a.movable && !b.movable)) continue;
        // Move the movable box; when both are movable, push the one further along the flow.
        let mover = b;
        let anchor = a;
        if (!b.movable || (a.movable && a.x + a.y > b.x + b.y)) {
          mover = a.movable ? a : b;
          anchor = mover === a ? b : a;
        }
        const pushRight = anchor.x + anchor.w + NUDGE_MARGIN - mover.x;
        const pushDown = anchor.y + anchor.h + NUDGE_MARGIN - mover.y;
        if (pushRight <= pushDown) mover.x += pushRight;
        else mover.y += pushDown;
        movedIds.add(mover.id);
        movedThisPass = true;
      }
    }
    if (!movedThisPass) break;
  }

  const positions = new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
  // Residual = overlapping pairs that still involve NO movable box we could separate,
  // or that the pass budget left unresolved.
  const residual = findOverlaps(boxes).length;
  return { positions, residual, movedIds };
}

// ---- Full-canvas ELK layout (fresh builds) --------------------------------------

async function fullLayout(nodes: ArchNode[], edges: ArchEdge[], containers: ArchContainer[]): Promise<{ nodes: ArchNode[]; containers: ArchContainer[] }> {
  const containerIds = new Set(containers.map((c) => c.containerId));
  const layoutNodes: LayoutNode[] = [
    ...nodes.map((n) => ({ id: n.nodeId, width: NODE_W, height: NODE_H, parentId: n.containerId ?? null })),
    ...containers.map((c) => ({ id: c.containerId, width: c.size.width, height: c.size.height, parentId: c.parentContainerId ?? null })),
  ];
  const layoutEdges: LayoutEdge[] = edges.map((e) => ({ id: e.edgeId, source: e.source, target: e.target }));
  const result = await layoutWithElk(layoutNodes, layoutEdges, containerIds);
  const nextNodes = nodes.map((n) => {
    const p = result.positions.get(n.nodeId);
    return p ? { ...n, position: p } : n;
  });
  const nextContainers = containers.map((c) => {
    const p = result.positions.get(c.containerId);
    const s = result.sizes.get(c.containerId);
    return p || s ? { ...c, position: p ?? c.position, size: s ?? c.size } : c;
  });
  return { nodes: nextNodes, containers: nextContainers };
}

// ---- Overlap audit across container groups --------------------------------------

function auditAndNudge(
  nodes: ArchNode[],
  containers: ArchContainer[],
  immovableNodeIds: Set<string>
): { nodes: ArchNode[]; residual: number; movedIds: Set<string> } {
  const next = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const movedIds = new Set<string>();
  let residual = 0;

  // Group by parent: root-level nodes audit against each other AND containers
  // (immovable boxes — moving a container would drag its members); members
  // audit against their siblings within the same container.
  const groups = new Map<string | null, ArchNode[]>();
  for (const n of next) {
    const key = n.containerId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  for (const [parent, groupNodes] of groups) {
    const boxes: Box[] = groupNodes.map((n) => ({
      id: n.nodeId,
      x: n.position.x,
      y: n.position.y,
      w: NODE_W,
      h: NODE_H,
      movable: !immovableNodeIds.has(n.nodeId),
    }));
    if (parent === null) {
      for (const c of containers.filter((c) => !c.parentContainerId)) {
        boxes.push({ id: `container:${c.containerId}`, x: c.position.x, y: c.position.y, w: c.size.width, h: c.size.height, movable: false });
      }
    }
    const resolved = resolveOverlaps(boxes);
    residual += resolved.residual;
    for (const n of groupNodes) {
      const p = resolved.positions.get(n.nodeId);
      if (p && (p.x !== n.position.x || p.y !== n.position.y)) {
        n.position = p;
        movedIds.add(n.nodeId);
      }
    }
  }

  return { nodes: next, residual, movedIds };
}

/** The finalize pass (FR-012). Never throws — a layout failure degrades to the audit alone. */
export async function finalizeArchitecture(input: FinalizeInput): Promise<FinalizeResult> {
  let nodes = input.nodes;
  let containers = input.containers;
  const movedIds = new Set<string>();
  const restoredIds = new Set<string>();

  if (input.preserved.length === 0) {
    // Fresh build — full left→right ELK pass (consistent flow direction, grouped containers).
    try {
      const laid = await fullLayout(nodes, input.edges, containers);
      nodes = laid.nodes;
      containers = laid.containers;
    } catch (e) {
      console.error('[finalize] full layout failed, keeping build placement and auditing overlaps:', e);
    }
  } else {
    // Revision — restore user-arranged positions (US3-S3), container membership permitting.
    const byId = new Map(input.preserved.map((p) => [p.nodeId, p]));
    nodes = nodes.map((n) => {
      const p = byId.get(n.nodeId);
      if (!p) return n;
      if ((n.containerId ?? null) !== (p.containerId ?? null)) return n; // membership changed — old absolute position is meaningless
      restoredIds.add(n.nodeId);
      return { ...n, position: { x: p.x, y: p.y } };
    });
  }

  const audited = auditAndNudge(nodes, containers, restoredIds);
  for (const id of audited.movedIds) movedIds.add(id);
  for (const n of audited.nodes) {
    const before = nodes.find((x) => x.nodeId === n.nodeId);
    if (before && (before.position.x !== n.position.x || before.position.y !== n.position.y)) movedIds.add(n.nodeId);
  }

  let note: string | null = null;
  if (audited.residual > 0) {
    const plural = audited.residual === 1 ? 'element' : 'elements';
    note = `I couldn't fully separate ${audited.residual} overlapping ${plural} without moving your hand-placed work — Auto-arrange on the toolbar will re-layout everything if you'd like a clean sweep.`;
  }

  return { nodes: audited.nodes, containers, moved: movedIds.size, residualOverlaps: audited.residual, note };
}
