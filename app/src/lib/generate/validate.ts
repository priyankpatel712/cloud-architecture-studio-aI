/**
 * Structural validation gate (feature 004 FR-010; research R6). Runs after
 * every apply (initial draft and each refinement): every edge endpoint must
 * resolve to a node, container parent references must be acyclic and exist,
 * and every node must carry a valid non-negative price. Failures are fed to
 * the reviewer as automatic `unmetCapabilities`, driving the refine loop to
 * fix them; if still failing at budget exhaustion, the turn returns the best
 * draft with these gaps named (FR-004).
 *
 * Pure and dependency-free — unit-testable in isolation (diff.ts style).
 */

export interface ValidateNode {
  nodeId: string;
  serviceId: string;
  cost: number;
  containerId?: string | null;
}
export interface ValidateEdge {
  source: string;
  target: string;
}
export interface ValidateContainer {
  containerId: string;
  type: string;
  label?: string;
  parentContainerId?: string | null;
}

export function validateArchitecture(
  nodes: ValidateNode[],
  edges: ValidateEdge[],
  containers: ValidateContainer[]
): string[] {
  const gaps: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.nodeId));
  const containerIds = new Set(containers.map((c) => c.containerId));

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      gaps.push(`a connection references a service that no longer exists (${e.source} -> ${e.target})`);
    }
  }

  for (const n of nodes) {
    if (n.containerId != null && !containerIds.has(n.containerId)) {
      gaps.push(`${n.serviceId} is assigned to a container that does not exist`);
    }
    if (!(typeof n.cost === 'number' && Number.isFinite(n.cost) && n.cost >= 0)) {
      gaps.push(`${n.serviceId} has no valid price`);
    }
  }

  for (const c of containers) {
    if (c.parentContainerId != null && !containerIds.has(c.parentContainerId)) {
      gaps.push(`container "${c.label || c.type}" has a parent that does not exist`);
      continue;
    }
    let cursor = c.parentContainerId ?? null;
    let hops = 0;
    while (cursor != null && hops <= containers.length) {
      if (cursor === c.containerId) {
        gaps.push(`container "${c.label || c.type}" is part of a nesting cycle`);
        break;
      }
      cursor = containers.find((x) => x.containerId === cursor)?.parentContainerId ?? null;
      hops++;
    }
  }

  return gaps;
}
