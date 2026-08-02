/**
 * Project-scoped clipboard (002 FR-009, research R6). In-memory only — OS
 * clipboard is deliberately not used (Clarification: same project only, no
 * cross-project semantics). Deep-copies nodes/edges with new ids and a visible
 * paste offset; duplicate = copy immediately followed by paste.
 */

export interface ClipboardNode {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  width?: number;
  height?: number;
}
export interface ClipboardEdge {
  id: string;
  source: string;
  target: string;
  /** connection sides — preserved so a pasted copy attaches exactly like the original */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
  data?: Record<string, unknown>;
}

export interface ClipboardPayload {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

let store: ClipboardPayload | null = null;
const PASTE_OFFSET = 32;

export function copyToClipboard(nodes: ClipboardNode[], edges: ClipboardEdge[]): void {
  const ids = new Set(nodes.map((n) => n.id));
  store = {
    nodes: nodes.map((n) => ({ ...n })),
    // Only carry edges fully inside the selection — pasting a dangling edge has no meaning.
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })),
  };
}

export function hasClipboardContent(): boolean {
  return store !== null && store.nodes.length > 0;
}

function newId(prefix: string, seq: number): string {
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/**
 * Materialize the clipboard as fresh nodes/edges with new ids, offset from their
 * original position, and remapped internal references (edges, parentId within
 * the copied set — a copied container keeps a copied child's membership, but a
 * child whose parent was NOT copied keeps referencing the original parent).
 */
export function pasteFromClipboard(seq = 0): { nodes: ClipboardNode[]; edges: ClipboardEdge[] } {
  if (!store) return { nodes: [], edges: [] };
  const idMap = new Map<string, string>();
  store.nodes.forEach((n, i) => idMap.set(n.id, newId('c', seq * 1000 + i)));

  const nodes = store.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + PASTE_OFFSET, y: n.position.y + PASTE_OFFSET },
    ...(n.parentId ? { parentId: idMap.get(n.parentId) ?? n.parentId } : {}),
    data: { ...n.data },
  }));
  const edges = store.edges.map((e, i) => ({
    ...e,
    id: newId('e', seq * 1000 + i),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
    data: e.data ? { ...e.data } : undefined,
  }));
  return { nodes, edges };
}

/** Duplicate = copy the given selection, then immediately paste it. */
export function duplicateSelection(
  nodes: ClipboardNode[],
  edges: ClipboardEdge[],
  seq = 0
): { nodes: ClipboardNode[]; edges: ClipboardEdge[] } {
  copyToClipboard(nodes, edges);
  return pasteFromClipboard(seq);
}
