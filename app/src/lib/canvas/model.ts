import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

/**
 * Canvas model (002 T005): the typed mapping between the extended Architecture
 * document (contracts/architecture-extensions.md) and React Flow nodes/edges.
 *
 * Positions are stored exactly as React Flow holds them — relative to the parent
 * container when an element is nested — so load/save round-trips are identity.
 * Containers become parent nodes (official subflows, research R2), annotations
 * become plain nodes, and edge style/waypoints ride in `edge.data`.
 */

/**
 * Connection sides. Service nodes expose one handle per side so edges can
 * attach anywhere, not just left/right. Handle ids ARE these side names — the
 * id is what React Flow stores on the edge and what we persist, so renaming a
 * side is a data migration, not a refactor.
 */
export const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type HandleSide = (typeof HANDLE_SIDES)[number];

export function isHandleSide(v: unknown): v is HandleSide {
  return typeof v === 'string' && (HANDLE_SIDES as readonly string[]).includes(v);
}

/**
 * Defaults for edges that predate side-selectable handles — everything the AI
 * generates, imports, and every document saved before this change. Left-to-
 * right is what those edges have always rendered as, so defaulting here keeps
 * them pixel-identical instead of letting React Flow guess among four handles.
 */
export const DEFAULT_SOURCE_HANDLE: HandleSide = 'right';
export const DEFAULT_TARGET_HANDLE: HandleSide = 'left';

export type EdgeGeometry = 'orthogonal' | 'straight' | 'curved';
export type EdgePattern = 'solid' | 'dashed';
export type EdgeArrowheads = 'none' | 'end' | 'both';
export type EdgeColor = 'default' | 'primary' | 'success' | 'warning' | 'danger';
export type AnnotationColor = 'default' | 'yellow' | 'blue' | 'green' | 'pink';

export interface DocEdgeStyle {
  geometry: EdgeGeometry;
  pattern: EdgePattern;
  arrowheads: EdgeArrowheads;
  color: EdgeColor;
}

export const DEFAULT_EDGE_STYLE: DocEdgeStyle = {
  geometry: 'orthogonal',
  pattern: 'solid',
  arrowheads: 'end',
  color: 'default',
};

/** Constrained palette tokens → concrete stroke colors (no free-form CSS). */
export const EDGE_COLORS: Record<EdgeColor, string> = {
  default: 'var(--color-outline)',
  primary: '#1a73e8',
  success: '#1e8e3e',
  warning: '#e8710a',
  danger: '#d93025',
};

export const ANNOTATION_COLORS: Record<AnnotationColor, { bg: string; border: string }> = {
  default: { bg: 'var(--color-surface-container-lowest)', border: 'var(--color-outline-variant)' },
  yellow: { bg: '#fef7d5', border: '#f0d878' },
  blue: { bg: '#e3f0fd', border: '#a3c9f5' },
  green: { bg: '#e2f4e8', border: '#9cd8b0' },
  pink: { bg: '#fce4ec', border: '#f2a7c0' },
};

export interface DocNode {
  nodeId: string;
  serviceId: string;
  provider: 'aws' | 'mongodb' | 'system';
  category?: string;
  position: { x: number; y: number };
  config: Record<string, string | number>;
  cost: number;
  costBasis?: 'exact' | 'indicative';
  displayName?: string;
  containerId?: string | null;
  /** 007 2.3 — optional user accent override (same constrained tokens as edges) */
  accent?: EdgeColor;
  /** Lucid-parity hotspot: optional external URL opened from the node (docs, console, runbook) */
  link?: string;
}

// ---- Conditional formatting (Lucid-parity data linking) ----------------------
// A rule colors any service node whose DATA matches — cost thresholds,
// provider, category, service, or display name — with the same constrained
// accent tokens as manual overrides. Rules live on the ArchDocument and are
// evaluated at render time (lib/canvas/conditional-format.ts), so they restyle
// nodes as the underlying data changes without touching the nodes themselves.

export type FormatRuleField = 'cost' | 'provider' | 'category' | 'serviceId' | 'name';
export type FormatRuleOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains';

export interface FormatRule {
  ruleId: string;
  field: FormatRuleField;
  op: FormatRuleOp;
  /** always stored as a string; numeric ops parse it (schema-stable) */
  value: string;
  /** never 'default' — a rule that styles nothing is just deleted */
  accent: Exclude<EdgeColor, 'default'>;
}
export interface DocEdge {
  edgeId: string;
  source: string;
  target: string;
  /** connection sides; absent on pre-existing/AI edges → right → left */
  sourceHandle?: HandleSide;
  targetHandle?: HandleSide;
  label?: string;
  style?: Partial<DocEdgeStyle>;
  waypoints?: { x: number; y: number }[];
}
export interface DocContainer {
  containerId: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  parentContainerId?: string | null;
}
export interface DocAnnotation {
  annotationId: string;
  kind: 'text' | 'sticky';
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  style?: { color?: AnnotationColor };
  /** 007 2.3 — persisted stacking order (bring-to-front/send-to-back) */
  z?: number;
}
export interface ArchDocument {
  nodes: DocNode[];
  edges: DocEdge[];
  containers: DocContainer[];
  annotations: DocAnnotation[];
  /** conditional-formatting rules (Lucid-parity); absent on pre-feature documents */
  formatRules?: FormatRule[];
}

// ---- React Flow node data payloads ----
export interface ServiceNodeData extends Record<string, unknown> {
  serviceId: string;
  config: Record<string, string | number>;
  cost: number;
  displayName?: string;
  /** carried for AI-added dynamic services with no curated catalog entry */
  provider?: 'aws' | 'mongodb' | 'system';
  category?: string;
  /** 007 2.3 — optional user accent override (constrained token) */
  accent?: EdgeColor;
  /** Lucid-parity hotspot: external URL opened from the node */
  link?: string;
}
export interface ContainerNodeData extends Record<string, unknown> {
  ctype: string;
  label: string;
}
export interface AnnotationNodeData extends Record<string, unknown> {
  kind: 'text' | 'sticky';
  content: string;
  color: AnnotationColor;
}
export interface OrthogonalEdgeData extends Record<string, unknown> {
  edgeStyle: DocEdgeStyle;
  waypoints: { x: number; y: number }[];
  /** render-only flow-walkthrough hint (007 3.1) — never persisted */
  walk?: 'active' | 'dim';
}

export type CanvasNodeType = 'service' | 'container' | 'annotation';

/** Order containers so every parent precedes its children (React Flow requirement). */
export function sortContainersParentsFirst(containers: DocContainer[]): DocContainer[] {
  const byId = new Map(containers.map((c) => [c.containerId, c]));
  const visited = new Set<string>();
  const out: DocContainer[] = [];
  const visit = (c: DocContainer) => {
    if (visited.has(c.containerId)) return;
    visited.add(c.containerId);
    const parent = c.parentContainerId ? byId.get(c.parentContainerId) : undefined;
    if (parent && !visited.has(parent.containerId)) visit(parent);
    out.push(c);
  };
  containers.forEach(visit);
  return out;
}

export function edgeMarkers(style: DocEdgeStyle) {
  const marker = { type: MarkerType.ArrowClosed, color: EDGE_COLORS[style.color] };
  return {
    markerEnd: style.arrowheads === 'none' ? undefined : marker,
    markerStart: style.arrowheads === 'both' ? marker : undefined,
  };
}

/** Extended Architecture document → React Flow nodes + edges. */
export function documentToFlow(doc: ArchDocument): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];

  for (const c of sortContainersParentsFirst(doc.containers)) {
    nodes.push({
      id: c.containerId,
      type: 'container',
      position: c.position,
      width: c.size.width,
      height: c.size.height,
      zIndex: -1,
      data: { ctype: c.type, label: c.label ?? '' } satisfies ContainerNodeData,
      ...(c.parentContainerId ? { parentId: c.parentContainerId } : {}),
    });
  }

  for (const n of doc.nodes) {
    nodes.push({
      id: n.nodeId,
      type: 'service',
      position: n.position,
      data: {
        serviceId: n.serviceId,
        config: n.config,
        cost: n.cost,
        displayName: n.displayName || undefined,
        provider: n.provider,
        category: n.category || undefined,
        accent: n.accent && n.accent !== 'default' ? n.accent : undefined,
        link: n.link || undefined,
      } satisfies ServiceNodeData,
      // No `extent: 'parent'` — members may be dragged out of a container to
      // change membership (002 FR-005 drag-in/drag-out).
      ...(n.containerId ? { parentId: n.containerId } : {}),
    });
  }

  for (const a of doc.annotations) {
    nodes.push({
      id: a.annotationId,
      type: 'annotation',
      position: a.position,
      width: a.size.width,
      height: a.size.height,
      ...(typeof a.z === 'number' && a.z !== 0 ? { zIndex: a.z } : {}),
      data: {
        kind: a.kind,
        content: a.content,
        color: a.style?.color ?? 'default',
      } satisfies AnnotationNodeData,
    });
  }

  const edges: Edge[] = doc.edges.map((e) => {
    const style: DocEdgeStyle = { ...DEFAULT_EDGE_STYLE, ...(e.style ?? {}) };
    return {
      id: e.edgeId,
      source: e.source,
      target: e.target,
      // ALWAYS explicit: with four handles per node, an edge without handle ids
      // would leave React Flow to pick one — defaulting here (not in the node)
      // keeps legacy and AI-generated edges attached where they always were.
      sourceHandle: isHandleSide(e.sourceHandle) ? e.sourceHandle : DEFAULT_SOURCE_HANDLE,
      targetHandle: isHandleSide(e.targetHandle) ? e.targetHandle : DEFAULT_TARGET_HANDLE,
      type: 'orthogonal',
      ...(e.label ? { label: e.label } : {}),
      data: { edgeStyle: style, waypoints: e.waypoints ?? [] } satisfies OrthogonalEdgeData,
      ...edgeMarkers(style),
    };
  });

  return { nodes, edges };
}

/**
 * React Flow state → extended document. `serviceMeta` supplies provider/category
 * (from the catalog) and `costBasis` values the canvas tracks separately.
 */
export function flowToDocument(
  nodes: Node[],
  edges: Edge[],
  serviceMeta: (serviceId: string) => { provider: 'aws' | 'mongodb' | 'system'; category: string }
): ArchDocument {
  const doc: ArchDocument = { nodes: [], edges: [], containers: [], annotations: [] };

  for (const n of nodes) {
    if (n.type === 'container') {
      const data = n.data as ContainerNodeData;
      doc.containers.push({
        containerId: n.id,
        type: data.ctype,
        label: data.label,
        position: { x: n.position.x, y: n.position.y },
        size: {
          width: n.width ?? n.measured?.width ?? 400,
          height: n.height ?? n.measured?.height ?? 300,
        },
        parentContainerId: n.parentId ?? null,
      });
    } else if (n.type === 'annotation') {
      const data = n.data as AnnotationNodeData;
      doc.annotations.push({
        annotationId: n.id,
        kind: data.kind,
        content: data.content,
        position: { x: n.position.x, y: n.position.y },
        size: {
          width: n.width ?? n.measured?.width ?? 200,
          height: n.height ?? n.measured?.height ?? 120,
        },
        style: { color: data.color },
        ...(typeof n.zIndex === 'number' && n.zIndex !== 0 ? { z: n.zIndex } : {}),
      });
    } else {
      const data = n.data as ServiceNodeData;
      const meta = serviceMeta(data.serviceId);
      doc.nodes.push({
        nodeId: n.id,
        serviceId: data.serviceId,
        // Dynamic services aren't in the catalog — their identity rides in data.
        provider: data.provider ?? meta.provider,
        category: data.category || meta.category,
        position: { x: n.position.x, y: n.position.y },
        config: data.config,
        cost: data.cost,
        costBasis: 'indicative',
        displayName: data.displayName ?? '',
        containerId: n.parentId ?? null,
        ...(data.accent && data.accent !== 'default' ? { accent: data.accent } : {}),
        ...(typeof data.link === 'string' && data.link.trim() ? { link: data.link.trim() } : {}),
      });
    }
  }

  for (const e of edges) {
    const data = (e.data ?? {}) as Partial<OrthogonalEdgeData>;
    doc.edges.push({
      edgeId: e.id,
      source: e.source,
      target: e.target,
      // Persist only recognised sides — an unknown id (a future handle scheme,
      // a corrupted value) degrades to the defaults on next load rather than
      // being stored as junk the schema then has to accept forever.
      ...(isHandleSide(e.sourceHandle) ? { sourceHandle: e.sourceHandle } : {}),
      ...(isHandleSide(e.targetHandle) ? { targetHandle: e.targetHandle } : {}),
      label: typeof e.label === 'string' ? e.label : '',
      style: { ...DEFAULT_EDGE_STYLE, ...(data.edgeStyle ?? {}) },
      waypoints: data.waypoints ?? [],
    });
  }

  return doc;
}

/** Absolute canvas position of a node, walking the parent chain. */
export function absolutePosition(node: Node, byId: Map<string, Node>): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  let hops = 0;
  while (parentId && hops < 100) {
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
    hops++;
  }
  return { x, y };
}
