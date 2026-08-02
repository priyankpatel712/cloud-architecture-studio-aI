/**
 * Auto-arrange via elkjs (002 FR-018, research R4) — the one justified community
 * dependency (no official React Flow layout engine exists; ELK is the maintained
 * standard for hierarchical, container-aware layout).
 *
 * Adapter only: maps our node/edge/container shape to an ELK graph and back.
 * Container members stay inside their container (ELK hierarchical children);
 * non-members become top-level nodes. Runs whole-diagram or selection-scoped.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string | null;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}
export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, { width: number; height: number }>;
}

const CONTAINER_PADDING = 40;
/** Extra headroom at the top of a container so members clear the label/icon band (ContainerNode.tsx). */
const CONTAINER_PADDING_TOP = 56;

/**
 * Readability options shared by every hierarchy level (ELK layered reference;
 * React Flow's elkjs guide uses the same family of values). ORTHOGONAL routing
 * gives the right-angle edges expected of architecture diagrams; the edge
 * spacings stop labels/lines hugging nodes.
 *
 * `elk.layered.considerModelOrder.strategy` is deliberately NOT here: under
 * INCLUDE_CHILDREN hierarchical layout, setting it on nested container nodes
 * crashes elkjs ("Cannot read properties of undefined (reading 'a')" —
 * reproduced against a cloud>region>vpc>az>subnet graph with cross-hierarchy
 * edges), which surfaced as "Arranging the diagram — failed" in the studio.
 * It is safe, and still effective for the whole flow, on the ROOT graph only.
 */
const FLOW_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.edgeNode': '32',
  'elk.spacing.edgeEdge': '20',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
};

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
}

function buildTree(nodes: LayoutNode[], containerIds: Set<string>): Map<string | null, LayoutNode[]> {
  const children = new Map<string | null, LayoutNode[]>();
  for (const n of nodes) {
    const key = n.parentId && containerIds.has(n.parentId) ? n.parentId : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(n);
  }
  return children;
}

function toElkNode(
  n: LayoutNode,
  children: Map<string | null, LayoutNode[]>,
  isContainer: boolean,
  edgesByParent: Map<string | null, LayoutEdge[]>
): ElkNode {
  const kids = children.get(n.id) ?? [];
  const elkChildren = kids.map((k) => toElkNode(k, children, false, edgesByParent));
  const innerEdges = (edgesByParent.get(n.id) ?? []).map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));
  return {
    id: n.id,
    // A container with members gets its size computed from content; a childless
    // container (e.g. a user-drawn empty boundary) keeps its drawn size instead
    // of collapsing to ELK's tiny default box.
    ...(isContainer && elkChildren.length > 0 ? {} : { width: n.width, height: n.height }),
    ...(elkChildren.length > 0
      ? {
          children: elkChildren,
          edges: innerEdges,
          layoutOptions: {
            ...FLOW_OPTIONS,
            'elk.padding': `[top=${CONTAINER_PADDING_TOP},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
            'elk.spacing.nodeNode': '48',
            'elk.layered.spacing.nodeNodeBetweenLayers': '72',
          },
        }
      : {}),
  };
}

/**
 * Lay out `nodes`/`edges` (optionally scoped to `selectionIds`). `containerIds`
 * marks which node ids are containers (their own width/height come from content).
 */
export async function layoutWithElk(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  containerIds: Set<string>,
  selectionIds?: Set<string>
): Promise<LayoutResult> {
  const scoped = selectionIds ? nodes.filter((n) => selectionIds.has(n.id)) : nodes;
  if (scoped.length === 0) return { positions: new Map(), sizes: new Map() };

  const scopedIds = new Set(scoped.map((n) => n.id));
  const scopedEdges = edges.filter((e) => scopedIds.has(e.source) && scopedIds.has(e.target));
  const edgesByParent = new Map<string | null, LayoutEdge[]>();
  const parentOf = new Map(scoped.map((n) => [n.id, n.parentId && containerIds.has(n.parentId) ? n.parentId : null]));
  for (const e of scopedEdges) {
    const sp = parentOf.get(e.source) ?? null;
    const tp = parentOf.get(e.target) ?? null;
    const key = sp === tp ? sp : null; // cross-container edges route at the root
    if (!edgesByParent.has(key)) edgesByParent.set(key, []);
    edgesByParent.get(key)!.push(e);
  }

  const tree = buildTree(scoped, containerIds);
  const roots = tree.get(null) ?? [];
  const rootGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...FLOW_OPTIONS,
      // Root-only (crashes elkjs when set on nested containers — see
      // FLOW_OPTIONS doc comment): keep the layout following the plan's
      // logical request-flow order instead of an arbitrary permutation.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // Lay the whole hierarchy out as one flow so cross-container edges
      // (e.g. S3-in-region → CloudFront-at-root) still order the layers —
      // without this they are dropped and downstream nodes drift left.
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      // Disconnected subgraphs (e.g. an AWS cloud and an Atlas project with no
      // cross-edge yet) sit side by side with clear separation instead of
      // interleaving.
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '96',
    },
    children: roots.map((n) => toElkNode(n, tree, containerIds.has(n.id), edgesByParent)),
    edges: (edgesByParent.get(null) ?? []).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  const laidOut = (await elk.layout(rootGraph as unknown as Parameters<typeof elk.layout>[0])) as unknown as ElkNode & {
    x?: number;
    y?: number;
  };

  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { width: number; height: number }>();
  const walk = (n: ElkNode & { x?: number; y?: number }) => {
    if (typeof n.x === 'number' && typeof n.y === 'number' && n.id !== 'root') {
      positions.set(n.id, { x: n.x, y: n.y });
    }
    if (typeof n.width === 'number' && typeof n.height === 'number') {
      sizes.set(n.id, { width: n.width, height: n.height });
    }
    for (const c of n.children ?? []) walk(c as ElkNode & { x?: number; y?: number });
  };
  walk(laidOut);

  return { positions, sizes };
}
