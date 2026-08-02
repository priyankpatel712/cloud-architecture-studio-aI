import { clampToFieldBounds, resolveServiceDef } from '@/lib/catalog';
import type { EditScope } from '@/lib/generate/intent';

/**
 * Deterministic fast path (feature 008 US1, FR-005/FR-039, SC-003;
 * contracts/agent-interfaces.md §2).
 *
 * WHY THIS EXISTS
 * "rename that lambda to OrderProcessor" does not need an architecture-design
 * model. Before 008 it ran the entire plan → review → refine loop: several
 * seconds, several large-model requests against a ~40 req/min ceiling, and a
 * real chance the planner would restructure something nobody asked about.
 *
 * WHAT IT GUARANTEES
 * The diagram must end up exactly as the design loop would have left it:
 *   - removing a node removes every edge that referenced it (no dangling edges)
 *   - a container left with no children is removed (no empty containers — this
 *     is a seeded house rule the reviewer would otherwise flag)
 *   - changed config is clamped to the field's declared bounds BEFORE pricing
 *     (constitution cost-realism: a unit mistake must never inflate an estimate)
 *   - cost is recomputed for any node whose config changed
 *
 * REFUSAL IS ALWAYS SAFE
 * Anything outside the three supported shapes returns `applied: false` with the
 * architecture untouched, and the caller falls through to the normal path. It is
 * never partially applied — a half-done fast edit would be worse than a slow one.
 *
 * No LLM call, and no mutation of the caller's objects.
 */

export interface DirectEditNode {
  nodeId: string;
  serviceId: string;
  provider?: string;
  category?: string;
  position: { x: number; y: number };
  config: Record<string, string | number>;
  cost?: number;
  costBasis?: string;
  displayName?: string;
  containerId?: string | null;
  accent?: string;
}

export interface DirectEditEdge {
  edgeId: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface DirectEditContainer {
  containerId: string;
  type: string;
  label?: string;
  parentContainerId?: string | null;
  [key: string]: unknown;
}

export interface DirectEditArch {
  nodes: DirectEditNode[];
  edges: DirectEditEdge[];
  containers: DirectEditContainer[];
  annotations?: unknown[];
}

export interface DirectEditResult {
  arch: DirectEditArch;
  editsApplied: string[];
  /** false ⇒ caller MUST fall through to the full analyze/build path. */
  applied: boolean;
}

/** The only kinds the fast path handles; everything else needs the design loop. */
const SUPPORTED = new Set(['rename', 'remove', 'reconfigure']);

function refuse(arch: DirectEditArch): DirectEditResult {
  return { arch, editsApplied: [], applied: false };
}

/** Clamp a node's config to its declared bounds and recompute its indicative cost. */
function repriceNode(node: DirectEditNode): DirectEditNode {
  const def = resolveServiceDef(node.serviceId, {
    provider: node.provider as never,
    displayName: node.displayName,
  });
  const config = clampToFieldBounds(def, { ...node.config });
  let cost = node.cost;
  try {
    cost = def.estimate(config);
  } catch {
    // A synthesized def for an AI-invented serviceId may not price cleanly.
    // Keeping the previous figure is better than emitting NaN into the estimate.
  }
  return { ...node, config, ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}) };
}

/**
 * Drop containers that no longer hold anything, repeatedly, so removing the last
 * child of a nested container also collapses its now-empty parent.
 */
function pruneEmptyContainers(
  containers: DirectEditContainer[],
  nodes: DirectEditNode[]
): { containers: DirectEditContainer[]; removed: DirectEditContainer[] } {
  let current = [...containers];
  const removed: DirectEditContainer[] = [];
  for (;;) {
    const occupied = new Set<string>();
    for (const n of nodes) if (n.containerId) occupied.add(n.containerId);
    for (const c of current) if (c.parentContainerId) occupied.add(c.parentContainerId);
    const next = current.filter((c) => occupied.has(c.containerId));
    if (next.length === current.length) return { containers: current, removed };
    removed.push(...current.filter((c) => !occupied.has(c.containerId)));
    current = next;
  }
}

/**
 * Apply a trivially-scoped edit, or refuse.
 *
 * `scope.targets` are assumed to have been verified against this architecture by
 * `sanitizeEditScope`; this function re-checks anyway, because refusing costs
 * one fall-through while acting on a stale id would damage the diagram.
 */
export function applyDirectEdit(scope: EditScope, arch: DirectEditArch): DirectEditResult {
  if (!SUPPORTED.has(scope.kind)) return refuse(arch);
  if (scope.targets.length === 0) return refuse(arch);

  const byId = new Map(arch.nodes.map((n) => [n.nodeId, n]));
  if (scope.targets.some((t) => !byId.has(t.nodeId))) return refuse(arch);

  const editsApplied: string[] = [];

  if (scope.kind === 'rename') {
    const newName = scope.freeform.trim();
    // An empty name would blank the label rather than rename it.
    if (!newName || scope.targets.length !== 1) return refuse(arch);
    const targetId = scope.targets[0].nodeId;
    const nodes = arch.nodes.map((n) => (n.nodeId === targetId ? { ...n, displayName: newName } : n));
    editsApplied.push(`renamed ${byId.get(targetId)!.serviceId} to "${newName}"`);
    return { arch: { ...arch, nodes }, editsApplied, applied: true };
  }

  if (scope.kind === 'remove') {
    const doomed = new Set(scope.targets.map((t) => t.nodeId));
    const nodes = arch.nodes.filter((n) => !doomed.has(n.nodeId));
    const edges = arch.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));
    const { containers, removed } = pruneEmptyContainers(arch.containers, nodes);

    for (const id of doomed) editsApplied.push(`removed ${byId.get(id)!.serviceId}`);
    const droppedEdges = arch.edges.length - edges.length;
    if (droppedEdges > 0) {
      editsApplied.push(`disconnected ${droppedEdges} connection${droppedEdges > 1 ? 's' : ''}`);
    }
    for (const c of removed) editsApplied.push(`removed empty ${c.type} container "${c.label || c.type}"`);

    return { arch: { ...arch, nodes, edges, containers }, editsApplied, applied: true };
  }

  // reconfigure
  const patch = scope.configPatch;
  if (!patch || Object.keys(patch).length === 0 || scope.targets.length !== 1) return refuse(arch);
  const targetId = scope.targets[0].nodeId;
  const nodes = arch.nodes.map((n) =>
    n.nodeId === targetId ? repriceNode({ ...n, config: { ...n.config, ...patch } }) : n
  );
  editsApplied.push(`reconfigured ${byId.get(targetId)!.serviceId}`);
  return { arch: { ...arch, nodes }, editsApplied, applied: true };
}
