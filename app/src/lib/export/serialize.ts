/**
 * Architecture serialization for export (001 FR-024, US7; extended by feature 002
 * per contracts/export-fidelity.md): Mermaid flowchart text (structure-faithful —
 * containers nest as subgraphs, styles/waypoints/positions are not encoded) and a
 * self-describing, round-trippable JSON document (full fidelity, including
 * containers/annotations). Pure module (no imports) — unit-testable and usable
 * from both the export API and the client.
 */

export interface ExportNode {
  nodeId: string;
  serviceId: string;
  provider: string;
  category?: string;
  config?: Record<string, string | number>;
  cost?: number;
  position?: { x: number; y: number } | null;
  /** 002 FR-013 — shown instead of the catalog name when set */
  displayName?: string;
  containerId?: string | null;
}
export interface ExportEdge {
  source: string;
  target: string;
  label?: string | null;
}
export interface ExportContainer {
  containerId: string;
  type: string;
  label?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  parentContainerId?: string | null;
}
export interface ExportAnnotation {
  annotationId: string;
  kind: 'text' | 'sticky';
  content: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  style?: { color?: string };
}
export interface ExportGuidance {
  network?: string;
  security?: string;
  ha?: string;
  dr?: string;
  scaling?: string;
}

const PROVIDER_LABEL: Record<string, string> = { aws: 'AWS', mongodb: 'MongoDB Atlas' };

function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
function mermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;');
}
function nodeLine(n: ExportNode): string {
  const cost = typeof n.cost === 'number' && n.cost > 0 ? `<br/>$${n.cost.toFixed(2)}/mo` : '';
  const label = n.displayName || n.serviceId;
  return `    ${mermaidId(n.nodeId)}["${mermaidLabel(label)}${cost}"]`;
}

/**
 * Structure-faithful Mermaid export: containers nest as `subgraph` blocks
 * mirroring the container tree; nodes with no container fall back to grouping
 * by provider (pre-002 behavior) so a plain diagram still reads cleanly.
 * Geometry, colors, waypoints, and positions are intentionally not encoded
 * (Clarification 2026-07-06 — export-fidelity.md).
 */
export function toMermaid(
  name: string,
  nodes: ExportNode[],
  edges: ExportEdge[],
  containers: ExportContainer[] = []
): string {
  const lines: string[] = ['---', `title: ${name}`, '---', 'flowchart LR'];

  const childContainers = new Map<string | null, ExportContainer[]>();
  for (const c of containers) {
    const key = c.parentContainerId ?? null;
    const arr = childContainers.get(key) ?? [];
    arr.push(c);
    childContainers.set(key, arr);
  }
  const nodesByContainer = new Map<string | null, ExportNode[]>();
  for (const n of nodes) {
    const key = n.containerId ?? null;
    const arr = nodesByContainer.get(key) ?? [];
    arr.push(n);
    nodesByContainer.set(key, arr);
  }

  function renderContainer(c: ExportContainer, indent: string) {
    lines.push(`${indent}subgraph ${mermaidId(c.containerId)}["${mermaidLabel(c.label || c.type)}"]`);
    for (const child of childContainers.get(c.containerId) ?? []) renderContainer(child, indent + '  ');
    for (const n of nodesByContainer.get(c.containerId) ?? []) lines.push(indent + nodeLine(n).trim());
    lines.push(`${indent}end`);
  }
  for (const root of childContainers.get(null) ?? []) renderContainer(root, '  ');

  // Un-contained nodes: group by provider for readability.
  const rootNodes = nodesByContainer.get(null) ?? [];
  const byProvider = new Map<string, ExportNode[]>();
  for (const n of rootNodes) {
    const list = byProvider.get(n.provider) ?? [];
    list.push(n);
    byProvider.set(n.provider, list);
  }
  for (const [provider, group] of byProvider) {
    lines.push(`  subgraph ${provider}["${mermaidLabel(PROVIDER_LABEL[provider] ?? provider)}"]`);
    for (const n of group) lines.push(nodeLine(n));
    lines.push('  end');
  }

  const known = new Set(nodes.map((n) => n.nodeId));
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    const label = e.label ? `|"${mermaidLabel(e.label)}"|` : '';
    lines.push(`  ${mermaidId(e.source)} -->${label} ${mermaidId(e.target)}`);
  }
  return lines.join('\n') + '\n';
}

/** Complete, round-trippable JSON document (SC-005) — full fidelity, including containers/annotations. */
export function toJsonDocument(input: {
  name: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  containers?: ExportContainer[];
  annotations?: ExportAnnotation[];
  guidance?: ExportGuidance;
  estimateMonthly?: number;
  exportedAt?: string;
}): string {
  const monthly = input.estimateMonthly ?? input.nodes.reduce((s, n) => s + (n.cost ?? 0), 0);
  return JSON.stringify(
    {
      format: 'cloud-architecture-studio/v1',
      name: input.name,
      exportedAt: input.exportedAt ?? null,
      estimate: { monthly: Math.round(monthly * 100) / 100, currency: 'USD' },
      nodes: input.nodes,
      edges: input.edges,
      containers: input.containers ?? [],
      annotations: input.annotations ?? [],
      guidance: input.guidance ?? {},
    },
    null,
    2
  );
}
