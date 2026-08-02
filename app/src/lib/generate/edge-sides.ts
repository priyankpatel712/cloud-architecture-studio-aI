import { NODE_W, NODE_H, type ArchContainer, type ArchEdge, type ArchNode } from '@/lib/generate/orchestrator';

/**
 * Connection-side assignment for AI-generated edges.
 *
 * The canvas supports attaching an edge to any side of a node, but the planner
 * never chooses sides — geometry is not the model's job, and asking it to emit
 * handle names would just be one more field to hallucinate. Instead the sides
 * are derived HERE, after layout, from where the nodes actually ended up: an
 * edge to the node below leaves the bottom and enters the top, exactly as a
 * person would draw it.
 *
 * TWO RULES, BOTH DELIBERATE:
 *
 * 1. Fill absent only, never override. A side that is already set — pinned by
 *    a user on the canvas, or assigned on a previous turn — is user-visible
 *    state, and the same preserve-user-work contract that protects node
 *    positions protects it. This is also what makes the function idempotent
 *    across follow-up turns.
 *
 * 2. Horizontal wins ties. The layouts here flow left→right, so a diagonal
 *    edge keeps the canonical horizontal look unless the vertical offset
 *    strictly dominates — assigning top/bottom on every slight diagonal would
 *    make ELK's layered output look jittery rather than intentional.
 *
 * Pure and synchronous: positions in, sides out. No LLM, no I/O.
 */

type Side = 'top' | 'right' | 'bottom' | 'left';

function isSide(v: unknown): v is Side {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left';
}

/**
 * Absolute center of each node. Stored positions are container-relative (the
 * document convention), so the container chain is walked — bounded, and a
 * dangling parent contributes nothing rather than failing the turn.
 */
function nodeCenters(nodes: ArchNode[], containers: ArchContainer[]): Map<string, { x: number; y: number }> {
  const containerById = new Map(containers.map((c) => [c.containerId, c]));
  const centers = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    let x = n.position.x;
    let y = n.position.y;
    let parentId = n.containerId ?? null;
    for (let hops = 0; parentId && hops < 10; hops++) {
      const parent = containerById.get(parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentContainerId ?? null;
    }
    centers.set(n.nodeId, { x: x + NODE_W / 2, y: y + NODE_H / 2 });
  }
  return centers;
}

/**
 * Assign sides to every edge that has none, from the final node geometry.
 * Mutates the edges in place and returns them for chaining. Edges with an
 * unknown endpoint are left untouched — the structural validator owns that
 * complaint, and a guessed side on a broken edge would just decorate the bug.
 */
export function assignEdgeSides(nodes: ArchNode[], containers: ArchContainer[], edges: ArchEdge[]): ArchEdge[] {
  const centers = nodeCenters(nodes, containers);
  for (const e of edges) {
    // Both present (user-pinned or previously assigned) → untouchable. One
    // present is unreachable in practice, but fill only the missing half.
    const hasSource = isSide(e.sourceHandle);
    const hasTarget = isSide(e.targetHandle);
    if (hasSource && hasTarget) continue;

    const s = centers.get(e.source);
    const t = centers.get(e.target);
    if (!s || !t) continue;

    const dx = t.x - s.x;
    const dy = t.y - s.y;
    // Vertical when EITHER:
    //  - the nodes share a column (centers closer than one card width): a node
    //    stacked above/below its peer — subnet members, a cache under its
    //    service — should connect top/bottom no matter how small the offset; or
    //  - the vertical offset strictly dominates (steep diagonals).
    // The column test matters because pure dominance almost never fires in the
    // ELK output this runs on: adjacent layers sit ~260px apart center-to-center
    // (NODE_W 188 + 72 gap) while one row of vertical offset is only ~146px —
    // measured 2026-08-01 after a user reported generated diagrams never using
    // the top/bottom connection points at all.
    const sameColumn = Math.abs(dx) < NODE_W && Math.abs(dy) > NODE_H / 2;
    const vertical = sameColumn || Math.abs(dy) > Math.abs(dx);
    const sourceSide: Side = vertical ? (dy > 0 ? 'bottom' : 'top') : dx >= 0 ? 'right' : 'left';
    const targetSide: Side = vertical ? (dy > 0 ? 'top' : 'bottom') : dx >= 0 ? 'left' : 'right';
    if (!hasSource) e.sourceHandle = sourceSide;
    if (!hasTarget) e.targetHandle = targetSide;
  }
  return edges;
}
