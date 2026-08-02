/**
 * Flow walkthrough steps (007 roadmap 3.1, IcePanel-Flows-style): order the
 * diagram's connections into a step-by-step request path so the canvas can
 * play through them — one edge per step, BFS from the entry points, so the
 * sequence follows how a request actually transits the architecture.
 *
 * Pure and dependency-free (validate.ts style) — unit-testable in isolation.
 */

export interface WalkNode {
  id: string;
  name: string;
}
export interface WalkEdge {
  edgeId: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowStep {
  edgeId: string;
  source: string;
  target: string;
  /** 1-based step number rendered in the caption chip */
  index: number;
  caption: string;
}

/**
 * BFS edge ordering: entry points are nodes with no incoming connection
 * (every node when the graph is fully cyclic); edges expand outward level by
 * level in stable input order; edges unreachable from any entry point (pure
 * cycles, disconnected islands) are appended afterwards so every connection
 * appears exactly once.
 */
export function computeFlowSteps(nodes: WalkNode[], edges: WalkEdge[]): FlowStep[] {
  if (nodes.length === 0 || edges.length === 0) return [];
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const valid = edges.filter((e) => nameOf.has(e.source) && nameOf.has(e.target));

  const hasIncoming = new Set(valid.map((e) => e.target));
  const roots = nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
  const queue: string[] = roots.length > 0 ? roots : nodes.map((n) => n.id);

  const outgoing = new Map<string, WalkEdge[]>();
  for (const e of valid) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }

  const orderedEdges: WalkEdge[] = [];
  const seenEdges = new Set<string>();
  const visitedNodes = new Set<string>(queue);
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const e of outgoing.get(nodeId) ?? []) {
      if (seenEdges.has(e.edgeId)) continue;
      seenEdges.add(e.edgeId);
      orderedEdges.push(e);
      if (!visitedNodes.has(e.target)) {
        visitedNodes.add(e.target);
        queue.push(e.target);
      }
    }
  }
  // Leftovers: edges inside unreached cycles/islands — still shown, at the end.
  for (const e of valid) {
    if (!seenEdges.has(e.edgeId)) {
      seenEdges.add(e.edgeId);
      orderedEdges.push(e);
    }
  }

  return orderedEdges.map((e, i) => ({
    edgeId: e.edgeId,
    source: e.source,
    target: e.target,
    index: i + 1,
    caption: `${nameOf.get(e.source)} → ${nameOf.get(e.target)}${e.label ? ` — ${e.label}` : ''}`,
  }));
}
