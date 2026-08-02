/**
 * Pure architecture-diff summary (FR-016a): direct canvas saves append a system
 * message to the project's chat thread describing what changed, so follow-up
 * messages build on the edited architecture. Also used for `editsApplied` on
 * assistant messages. No imports — unit-testable in isolation.
 */

export interface DiffNode {
  nodeId: string;
  serviceId: string;
  config?: Record<string, string | number>;
}
export interface DiffEdge {
  edgeId: string;
  source: string;
  target: string;
}
export interface DiffContainer {
  containerId: string;
  type: string;
  label?: string;
  parentContainerId?: string | null;
}
export interface DiffAnnotation {
  annotationId: string;
  content?: string;
}

export function summarizeArchitectureEdit(
  before: { nodes: DiffNode[]; edges: DiffEdge[]; containers?: DiffContainer[]; annotations?: DiffAnnotation[] },
  after: { nodes: DiffNode[]; edges: DiffEdge[]; containers?: DiffContainer[]; annotations?: DiffAnnotation[] }
): string[] {
  const changes: string[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.nodeId, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.nodeId, n]));

  for (const [id, node] of afterNodes) {
    const prev = beforeNodes.get(id);
    if (!prev) {
      changes.push(`added ${node.serviceId}`);
    } else if (JSON.stringify(prev.config ?? {}) !== JSON.stringify(node.config ?? {})) {
      changes.push(`reconfigured ${node.serviceId}`);
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) changes.push(`removed ${node.serviceId}`);
  }

  const edgeKey = (e: DiffEdge) => `${e.source}->${e.target}`;
  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));
  let added = 0;
  let removed = 0;
  for (const k of afterEdges) if (!beforeEdges.has(k)) added++;
  for (const k of beforeEdges) if (!afterEdges.has(k)) removed++;
  if (added) changes.push(`connected ${added} service${added > 1 ? 's' : ''}`);
  if (removed) changes.push(`disconnected ${removed} connection${removed > 1 ? 's' : ''}`);

  // 002 FR-017: container/annotation edits are part of the assistant-visible summary.
  const containerName = (c: DiffContainer) => c.label || c.type;
  const beforeContainers = new Map((before.containers ?? []).map((c) => [c.containerId, c]));
  const afterContainers = new Map((after.containers ?? []).map((c) => [c.containerId, c]));
  for (const [id, c] of afterContainers) {
    const prev = beforeContainers.get(id);
    if (!prev) {
      changes.push(`added ${c.type} container "${containerName(c)}"`);
    } else if (
      prev.label !== c.label ||
      prev.type !== c.type ||
      (prev.parentContainerId ?? null) !== (c.parentContainerId ?? null)
    ) {
      changes.push(`updated container "${containerName(c)}"`);
    }
  }
  for (const [id, c] of beforeContainers) {
    if (!afterContainers.has(id)) changes.push(`removed container "${containerName(c)}"`);
  }

  const beforeAnn = new Map((before.annotations ?? []).map((a) => [a.annotationId, a]));
  const afterAnn = new Map((after.annotations ?? []).map((a) => [a.annotationId, a]));
  let annAdded = 0;
  let annRemoved = 0;
  let annEdited = 0;
  for (const [id, a] of afterAnn) {
    const prev = beforeAnn.get(id);
    if (!prev) annAdded++;
    else if (prev.content !== a.content) annEdited++;
  }
  for (const id of beforeAnn.keys()) if (!afterAnn.has(id)) annRemoved++;
  if (annAdded) changes.push(`added ${annAdded} annotation${annAdded > 1 ? 's' : ''}`);
  if (annEdited) changes.push(`edited ${annEdited} annotation${annEdited > 1 ? 's' : ''}`);
  if (annRemoved) changes.push(`removed ${annRemoved} annotation${annRemoved > 1 ? 's' : ''}`);

  return changes;
}
