'use client';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type Ref,
} from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes, StickyNote, NotebookText, Shuffle, Keyboard, Grid3x3, Undo2, Redo2,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, ChevronDown,
  Play, Pause, ChevronLeft, ChevronRight, X, Paintbrush, Trash2, Check,
} from 'lucide-react';
import { ServiceNode, type ServiceNodeData as SvcData } from '@/components/studio/ServiceNode';
import { ContainerNode } from '@/components/studio/ContainerNode';
import { AnnotationNode } from '@/components/studio/AnnotationNode';
import { OrthogonalEdge } from '@/components/studio/OrthogonalEdge';
import { AlignmentGuides } from '@/components/studio/AlignmentGuides';
import { computeFlowSteps, type FlowStep } from '@/lib/canvas/walkthrough';
import { suggestNextServices } from '@/lib/canvas/quick-connect';
import {
  FORMAT_RULE_LIMIT, RULE_FIELDS, RULE_OPS, describeRule, newFormatRuleId, sanitizeFormatRules,
} from '@/lib/canvas/conditional-format';
import type { FormatRule } from '@/lib/canvas/model';
import { ServiceIcon } from '@/components/ui/Icon';
import { MiniMapPanel } from '@/components/studio/MiniMapPanel';
import { ShortcutsHelp } from '@/components/studio/ShortcutsHelp';
import { CanvasContextMenu, type ContextMenuTarget, type MenuAction } from '@/components/studio/CanvasContextMenu';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { serviceById, resolveServiceDef, defaultConfig, containerTypeById, CONTAINER_TYPES } from '@/lib/catalog';
import type { CanvasNode } from '@/components/studio/Inspector';
import {
  documentToFlow,
  flowToDocument,
  absolutePosition,
  edgeMarkers,
  isHandleSide,
  DEFAULT_EDGE_STYLE,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  EDGE_COLORS,
  type ArchDocument,
  type ContainerNodeData,
  type AnnotationNodeData,
  type OrthogonalEdgeData,
  type DocEdgeStyle,
} from '@/lib/canvas/model';
import { computeGuides, type Box, type GuideLine } from '@/lib/canvas/guides';
import { alignBoxes, distributeBoxes, type AlignMode, type DistributeAxis } from '@/lib/canvas/align';
import {
  copyToClipboard, pasteFromClipboard, duplicateSelection, hasClipboardContent,
  type ClipboardNode, type ClipboardEdge,
} from '@/lib/canvas/clipboard';
import { layoutWithElk, type LayoutNode, type LayoutEdge } from '@/lib/canvas/layout';
import { cn } from '@/lib/cn';

/**
 * Canvas — the Lucidchart-grade interactive surface (feature 002). Owns all
 * node/edge state (services, containers, annotations) plus routing, guides,
 * multi-select, clipboard, keyboard shortcuts, context menus, and auto-arrange.
 * The studio page treats it as a black box via `CanvasApi`: load/save a full
 * `ArchDocument`, and get notified of dirty/selection/stat changes.
 */

const nodeTypesBase = { service: ServiceNode, container: ContainerNode, annotation: AnnotationNode };
const edgeTypes = { orthogonal: OrthogonalEdge };
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
const HISTORY_LIMIT = 50;

/**
 * Lucid-style canvas background options (Lucidchart's canvas settings offer
 * square grid / dotted grid / no grid): grid lines, dots, cross ticks, or a
 * plain surface. Persisted per browser alongside snap-to-grid — a canvas
 * preference, not document data, so it does not live in the ArchDocument.
 */
type CanvasBackground = 'lines' | 'dots' | 'cross' | 'none';
const CANVAS_BACKGROUNDS: { id: CanvasBackground; label: string }[] = [
  { id: 'lines', label: 'Grid lines' },
  { id: 'dots', label: 'Dotted grid' },
  { id: 'cross', label: 'Cross ticks' },
  { id: 'none', label: 'Plain (no grid)' },
];
const BG_STORAGE_KEY = 'studio.canvas.background';
const SNAP_STORAGE_KEY = 'studio.canvas.snap';

/**
 * View preferences live in localStorage behind useSyncExternalStore: the server
 * snapshot is null (defaults), the client snapshot is the stored value, so SSR
 * hydration stays consistent and a change in another tab syncs via 'storage'.
 * Same-tab writes notify the local listener set (storage events only fire
 * cross-tab).
 */
const prefListeners = new Set<() => void>();
function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the preference just won't persist */
  }
  prefListeners.forEach((l) => l());
}
function subscribePrefs(cb: () => void): () => void {
  prefListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    prefListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
/** 002 FR-016/SC-006 — zero out zoom/fit transition time when the OS asks for reduced motion. */
function motionDuration(ms: number): number {
  if (typeof window === 'undefined' || !window.matchMedia) return ms;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}
function nodeBox(n: Node, fallback: { width: number; height: number }): Box {
  return {
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? fallback.width,
    height: n.measured?.height ?? n.height ?? fallback.height,
  };
}
function fallbackSize(n: Node): { width: number; height: number } {
  return n.type === 'container' ? { width: 400, height: 300 } : n.type === 'annotation' ? { width: 200, height: 120 } : { width: 188, height: 88 };
}
function cloneNode(n: Node): Node {
  return { ...n, position: { ...n.position }, data: { ...n.data } };
}
function cloneEdge(e: Edge): Edge {
  return { ...e, data: e.data ? { ...e.data } : e.data };
}

export interface CanvasApi {
  getDocument(): ArchDocument;
  loadDocument(doc: ArchDocument): void;
  addService(serviceId: string, position?: { x: number; y: number }): void;
  updateNodeConfig(nodeId: string, key: string, value: string): void;
  renameNode(nodeId: string, displayName: string): void;
  deleteNodeById(nodeId: string): void;
  clear(): void;
  fitView(): void;
  openShortcuts(): void;
  /** whole-canvas ELK auto-arrange (007 1.2 — used after geometry-less imports) */
  autoArrange(): void;
  /** center + zoom the viewport on a node (007 2.2 — comment anchor jump) */
  centerOnNode(nodeId: string): void;
}

export interface CanvasStats {
  services: number;
  connections: number;
  totalCost: number;
  basis: 'exact' | 'indicative';
}

interface CanvasProps {
  onDirty: () => void;
  onSelectionChange: (selected: CanvasNode | null, all: CanvasNode[]) => void;
  onStats: (stats: CanvasStats) => void;
  /** a service node was clicked (not dragged) — the studio opens its pricing editor */
  onServiceOpen?: (nodeId: string) => void;
  className?: string;
}

function CanvasImpl(
  { onDirty, onSelectionChange, onStats, onServiceOpen, className }: CanvasProps,
  ref: Ref<CanvasApi>
) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, setCenter } = useReactFlow();

  const nodesRef = useRef<Node[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const onDirtyRef = useRef(onDirty);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onStatsRef = useRef(onStats);
  const onServiceOpenRef = useRef(onServiceOpen);
  useEffect(() => {
    onDirtyRef.current = onDirty;
    onSelectionChangeRef.current = onSelectionChange;
    onStatsRef.current = onStats;
    onServiceOpenRef.current = onServiceOpen;
  }, [onDirty, onSelectionChange, onStats, onServiceOpen]);

  const [dragOver, setDragOver] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const storedBg = useSyncExternalStore(subscribePrefs, () => readPref(BG_STORAGE_KEY), () => null);
  const bgStyle: CanvasBackground = CANVAS_BACKGROUNDS.some((b) => b.id === storedBg)
    ? (storedBg as CanvasBackground)
    : 'lines';
  const storedSnap = useSyncExternalStore(subscribePrefs, () => readPref(SNAP_STORAGE_KEY), () => null);
  const snapToGrid = storedSnap === null ? true : storedSnap === 'true';
  const pickBackground = useCallback((bg: CanvasBackground) => writePref(BG_STORAGE_KEY, bg), []);
  const toggleSnap = useCallback(() => writePref(SNAP_STORAGE_KEY, String(!snapToGrid)), [snapToGrid]);
  const [spacePressed, setSpacePressed] = useState(false);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [menu, setMenu] = useState<{ target: ContextMenuTarget; screen: { x: number; y: number } } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [containerDeleteConfirm, setContainerDeleteConfirm] = useState<{ ids: Set<string> } | null>(null);
  const [basis, setBasis] = useState<'exact' | 'indicative'>('indicative');
  const [addContainerOpen, setAddContainerOpen] = useState(false);
  // Lucid-parity conditional formatting — document-level rules, persisted with
  // the architecture and evaluated at render time by ServiceNode.
  const [formatRules, setFormatRules] = useState<FormatRule[]>([]);
  const [formatOpen, setFormatOpen] = useState(false);
  const formatRulesRef = useRef<FormatRule[]>([]);
  useEffect(() => {
    formatRulesRef.current = formatRules;
  }, [formatRules]);

  // ---- History (undo/redo) — snapshots at commit points, not every drag frame ----
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef(-1);
  const suppressHistoryRef = useRef(false);
  // Refs are the source of truth for undo/redo logic (needs synchronous reads);
  // `historyView` mirrors {index, length} into real state purely so the toolbar's
  // canUndo/canRedo can be computed during render without reading `.current`.
  const [historyView, setHistoryView] = useState({ index: -1, length: 0 });
  const syncHistoryView = useCallback(() => {
    setHistoryView({ index: historyIndexRef.current, length: historyRef.current.length });
  }, []);

  const pushHistory = useCallback(
    (n: Node[], e: Edge[]) => {
      if (suppressHistoryRef.current) return;
      const snap = { nodes: n.map(cloneNode), edges: e.map(cloneEdge) };
      const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
      trimmed.push(snap);
      while (trimmed.length > HISTORY_LIMIT) trimmed.shift();
      historyRef.current = trimmed;
      historyIndexRef.current = trimmed.length - 1;
      syncHistoryView();
    },
    [syncHistoryView]
  );

  const commit = useCallback(
    (n: Node[], e: Edge[]) => {
      setNodes(n);
      setEdges(e);
      pushHistory(n, e);
      onDirtyRef.current();
    },
    [setNodes, setEdges, pushHistory]
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = historyRef.current[historyIndexRef.current];
    suppressHistoryRef.current = true;
    setNodes(snap.nodes.map(cloneNode));
    setEdges(snap.edges.map(cloneEdge));
    suppressHistoryRef.current = false;
    onDirtyRef.current();
    syncHistoryView();
  }, [setNodes, setEdges, syncHistoryView]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snap = historyRef.current[historyIndexRef.current];
    suppressHistoryRef.current = true;
    setNodes(snap.nodes.map(cloneNode));
    setEdges(snap.edges.map(cloneEdge));
    suppressHistoryRef.current = false;
    onDirtyRef.current();
    syncHistoryView();
  }, [setNodes, setEdges, syncHistoryView]);

  // ---- Node-data mutation helpers (rename/content/resize) — used by nodeTypes wrappers ----
  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const next = nodesRef.current.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      commit(next, edgesRef.current);
    },
    [commit]
  );
  const resizeElement = useCallback(
    (id: string, box: { x: number; y: number; width: number; height: number }) => {
      const next = nodesRef.current.map((n) =>
        n.id === id ? { ...n, position: { x: box.x, y: box.y }, width: box.width, height: box.height } : n
      );
      commit(next, edgesRef.current);
    },
    [commit]
  );

  // Stable callback identities (not inline arrows in nodeTypes below) so the
  // memoized node components actually skip re-render when unrelated Canvas
  // state changes (research R10 — memoized custom nodes/edges).
  const renameService = useCallback((id: string, name: string) => patchNodeData(id, { displayName: name }), [patchNodeData]);
  const renameContainer = useCallback((id: string, label: string) => patchNodeData(id, { label }), [patchNodeData]);
  const changeAnnotationContent = useCallback((id: string, content: string) => patchNodeData(id, { content }), [patchNodeData]);

  // Rule add/remove mark the document dirty — rules persist with the next Save.
  const addFormatRule = useCallback((rule: Omit<FormatRule, 'ruleId'>) => {
    setFormatRules((rs) => (rs.length >= FORMAT_RULE_LIMIT ? rs : [...rs, { ...rule, ruleId: newFormatRuleId() }]));
    onDirtyRef.current();
  }, []);
  const removeFormatRule = useCallback((ruleId: string) => {
    setFormatRules((rs) => rs.filter((r) => r.ruleId !== ruleId));
    onDirtyRef.current();
  }, []);

  const nodeTypes = useMemo(
    () => ({
      service: (p: Parameters<typeof ServiceNode>[0]) => (
        <nodeTypesBase.service {...p} onRename={renameService} formatRules={formatRules} />
      ),
      container: (p: Parameters<typeof ContainerNode>[0]) => (
        <nodeTypesBase.container {...p} onRename={renameContainer} onResizeEnd={resizeElement} />
      ),
      annotation: (p: Parameters<typeof AnnotationNode>[0]) => (
        <nodeTypesBase.annotation {...p} onContentChange={changeAnnotationContent} onResizeEnd={resizeElement} />
      ),
    }),
    [renameService, renameContainer, changeAnnotationContent, resizeElement, formatRules]
  );

  // ---- Selection + stats reporting ----
  useEffect(() => {
    const serviceNodes = nodes.filter((n) => n.type === 'service');
    const all: CanvasNode[] = serviceNodes.map((n) => {
      const d = n.data as SvcData;
      return {
        id: n.id, serviceId: d.serviceId, config: d.config, cost: d.cost,
        displayName: d.displayName, provider: d.provider, category: d.category,
      };
    });
    const selectedFlow = serviceNodes.find((n) => n.selected);
    const selected = selectedFlow ? (all.find((a) => a.id === selectedFlow.id) ?? null) : null;
    onSelectionChangeRef.current(selected, all);
    const totalCost = all.reduce((s, a) => s + a.cost, 0);
    onStatsRef.current({ services: serviceNodes.length, connections: edges.length, totalCost, basis });
  }, [nodes, edges, basis]);

  // ---- Live pricing refresh (T030 continuation): service nodes only — never
  // containers/annotations (002 FR-017/cost-neutrality guard). ----
  const pricingKey = useMemo(
    () =>
      JSON.stringify(
        nodes.filter((n) => n.type === 'service').map((n) => [n.id, (n.data as SvcData).serviceId, (n.data as SvcData).config])
      ),
    [nodes]
  );
  useEffect(() => {
    const serviceNodes = nodesRef.current.filter((n) => n.type === 'service');
    if (serviceNodes.length === 0) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serviceNodes.map((n) => {
              const d = n.data as SvcData;
              return { nodeId: n.id, serviceId: d.serviceId, provider: d.provider ?? serviceById(d.serviceId)?.provider ?? 'aws', config: d.config };
            }),
          }),
        });
        if (!res.ok) return;
        const est = await res.json();
        setBasis(est.basis);
        setNodes((nds) =>
          nds.map((n) => {
            if (n.type !== 'service') return n;
            const priced = est.perService.find((p: { nodeId?: string }) => p.nodeId === n.id);
            const d = n.data as SvcData;
            return priced && priced.cost !== d.cost ? { ...n, data: { ...d, cost: priced.cost } } : n;
          })
        );
      } catch {
        /* keep catalog estimates; basis stays indicative */
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingKey]);

  // ---- Service creation (palette drop/click) ----
  const addService = useCallback(
    (serviceId: string, position?: { x: number; y: number }) => {
      const def = serviceById(serviceId);
      if (!def) return;
      // Attach-duplicate merge (003 FR-005, US2/AC3): re-adding a quantity-bearing
      // service from the catalog increments the existing node's quantity instead
      // of creating a duplicate node. Copy/paste/duplicate (002 FR-009) bypass
      // this on purpose — there the user's intent is an explicit copy.
      if (def.quantityField) {
        const existing = nodesRef.current.find(
          (n) => n.type === 'service' && (n.data as SvcData).serviceId === serviceId
        );
        if (existing) {
          const qf = def.quantityField;
          const data = existing.data as SvcData;
          const current = Math.max(1, Math.round(Number(data.config[qf]) || 1));
          const config = { ...data.config, [qf]: current + 1 };
          commit(
            nodesRef.current.map((n) =>
              n.id === existing.id
                ? { ...n, data: { ...data, config, cost: def.estimate(config) } }
                : n
            ),
            edgesRef.current
          );
          return;
        }
      }
      const pos = position ?? { x: 220 + Math.random() * 120, y: 120 + Math.random() * 120 };
      const config = defaultConfig(def);
      const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const node: Node = { id, type: 'service', position: pos, data: { serviceId, config, cost: def.estimate(config) } satisfies SvcData };
      commit([...nodesRef.current, node], edgesRef.current);
    },
    [commit]
  );
  const addContainerAction = useCallback(
    (type: string) => {
      const id = `ct${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const typeDef = containerTypeById(type);
      const node: Node = {
        id,
        type: 'container',
        position: { x: 160, y: 120 },
        width: 420,
        height: 300,
        zIndex: -1,
        data: { ctype: type, label: typeDef?.label ?? type } satisfies ContainerNodeData,
      };
      commit([...nodesRef.current, node], edgesRef.current);
      setAddContainerOpen(false);
    },
    [commit]
  );
  const addAnnotationAction = useCallback(
    (kind: 'text' | 'sticky') => {
      const id = `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const node: Node = {
        id,
        type: 'annotation',
        position: { x: 200, y: 400 },
        width: 200,
        height: 120,
        data: { kind, content: '', color: 'default' } satisfies AnnotationNodeData,
      };
      commit([...nodesRef.current, node], edgesRef.current);
    },
    [commit]
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const serviceId = e.dataTransfer.getData('application/service-id');
      if (!serviceId) return;
      addService(serviceId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addService, screenToFlowPosition]
  );

  // ---- Quick-connect (007 2.1): a connection drag dropped on empty canvas
  // opens a suggestion popover — pick a service and it is created there,
  // already wired to the source. Curated adjacency, no LLM on this path.
  const [quickConnect, setQuickConnect] = useState<{
    sourceId: string;
    /** the handle side the drag started from, so the new edge leaves that side */
    sourceHandle: string;
    suggestions: string[];
    screen: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; fromNode: Node | null; fromHandle: { id?: string | null; type: string | null } | null }) => {
      if (connectionState.isValid) return; // a real connection — onConnect handles it
      const fromNode = connectionState.fromNode;
      if (!fromNode || fromNode.type !== 'service' || connectionState.fromHandle?.type !== 'source') return;
      const client =
        'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
      const suggestions = suggestNextServices((fromNode.data as SvcData).serviceId);
      if (suggestions.length === 0) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      setQuickConnect({
        sourceId: fromNode.id,
        sourceHandle: connectionState.fromHandle?.id ?? DEFAULT_SOURCE_HANDLE,
        suggestions,
        screen: { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) },
        flow: screenToFlowPosition(client),
      });
    },
    [screenToFlowPosition]
  );

  const quickAddConnected = useCallback(
    (serviceId: string) => {
      if (!quickConnect) return;
      const def = serviceById(serviceId);
      if (!def) return;
      const config = defaultConfig(def);
      const nodeId = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      // Center the new card on the drop point (ServiceNode is 188px wide).
      const node: Node = {
        id: nodeId,
        type: 'service',
        position: { x: quickConnect.flow.x - 94, y: quickConnect.flow.y - 45 },
        data: { serviceId, config, cost: def.estimate(config) } satisfies SvcData,
      };
      const edge: Edge = {
        id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        source: quickConnect.sourceId,
        target: nodeId,
        // Leave from whichever side the drag started; the new node receives on
        // its left, matching where it was just dropped relative to the drag.
        sourceHandle: isHandleSide(quickConnect.sourceHandle) ? quickConnect.sourceHandle : DEFAULT_SOURCE_HANDLE,
        targetHandle: DEFAULT_TARGET_HANDLE,
        type: 'orthogonal',
        data: { edgeStyle: DEFAULT_EDGE_STYLE, waypoints: [] } satisfies OrthogonalEdgeData,
        ...edgeMarkers(DEFAULT_EDGE_STYLE),
      };
      commit([...nodesRef.current, node], [...edgesRef.current, edge]);
      setQuickConnect(null);
    },
    [quickConnect, commit]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      // Loose mode lets a drag land back on the same node's own handles — a
      // self-loop says nothing in an architecture diagram, so drop it.
      if (c.source === c.target) return;
      const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const edge: Edge = {
        id,
        source: c.source,
        target: c.target,
        // The sides the user actually dragged between. Guarded so an unknown
        // handle id can never be recorded — it would fail the save schema.
        sourceHandle: isHandleSide(c.sourceHandle) ? c.sourceHandle : DEFAULT_SOURCE_HANDLE,
        targetHandle: isHandleSide(c.targetHandle) ? c.targetHandle : DEFAULT_TARGET_HANDLE,
        type: 'orthogonal',
        data: { edgeStyle: DEFAULT_EDGE_STYLE, waypoints: [] } satisfies OrthogonalEdgeData,
        ...edgeMarkers(DEFAULT_EDGE_STYLE),
      };
      commit(nodesRef.current, [...edgesRef.current, edge]);
    },
    [commit]
  );

  // ---- Alignment guides while dragging a single node (002 FR-003) ----
  const onNodeDrag: OnNodeDrag = useCallback(
    (_event, node, draggedNodes) => {
      if (draggedNodes.length !== 1) {
        setGuides([]);
        return;
      }
      const siblings = nodesRef.current.filter((n) => n.id !== node.id && (n.parentId ?? null) === (node.parentId ?? null));
      const moving = nodeBox(node, fallbackSize(node));
      const result = computeGuides(moving, siblings.map((s) => nodeBox(s, fallbackSize(s))));
      setGuides(result.guides);
      if (result.x !== moving.x || result.y !== moving.y) {
        setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: { x: result.x, y: result.y } } : n)));
      }
    },
    [setNodes]
  );

  // ---- Modifier-drag duplicate (Alt/Option-drag leaves a copy, moves the original) ----
  const duplicateActionRef = useRef<() => void>(() => {});
  const onNodeDragStart: OnNodeDrag = useCallback((event) => {
    if ((event as MouseEvent).altKey) duplicateActionRef.current();
  }, []);

  // ---- Container membership on drag stop (002 FR-005/006, research R2) ----
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, _node, draggedNodes) => {
      setGuides([]);
      const all = nodesRef.current;
      const byId = new Map(all.map((n) => [n.id, n]));
      const draggedIds = new Set(draggedNodes.map((n) => n.id));
      let changed = all;

      for (const dragged of draggedNodes) {
        if (dragged.type === 'annotation') continue;
        const current = byId.get(dragged.id);
        if (!current) continue;
        const abs = absolutePosition(current, byId);
        const { width: w, height: h } = nodeBox(current, fallbackSize(current));
        const centerX = abs.x + w / 2;
        const centerY = abs.y + h / 2;

        const excluded = new Set<string>([...draggedIds]);
        if (dragged.type === 'container') {
          let frontier = [dragged.id];
          while (frontier.length > 0) {
            const next: string[] = [];
            for (const n2 of all) {
              if (n2.parentId && frontier.includes(n2.parentId) && !excluded.has(n2.id)) {
                excluded.add(n2.id);
                next.push(n2.id);
              }
            }
            frontier = next;
          }
        }

        let bestContainer: Node | null = null;
        let bestArea = Infinity;
        for (const c of all) {
          if (c.type !== 'container' || excluded.has(c.id)) continue;
          const cAbs = absolutePosition(c, byId);
          const { width: cw, height: ch } = nodeBox(c, fallbackSize(c));
          if (centerX >= cAbs.x && centerX <= cAbs.x + cw && centerY >= cAbs.y && centerY <= cAbs.y + ch) {
            const area = cw * ch;
            if (area < bestArea) {
              bestArea = area;
              bestContainer = c;
            }
          }
        }

        const newParentId = bestContainer?.id;
        if (newParentId !== (current.parentId ?? undefined)) {
          const parentAbs = bestContainer ? absolutePosition(bestContainer, byId) : { x: 0, y: 0 };
          const relX = abs.x - parentAbs.x;
          const relY = abs.y - parentAbs.y;
          changed = changed.map((n) => {
            if (n.id !== current.id) return n;
            const { parentId: _drop, ...rest } = n;
            void _drop;
            return newParentId
              ? { ...rest, parentId: newParentId, position: { x: relX, y: relY } }
              : { ...rest, position: { x: relX, y: relY } };
          });
        }
      }

      setNodes(changed);
      pushHistory(changed, edgesRef.current);
      onDirtyRef.current();
    },
    [setNodes, pushHistory]
  );

  // ---- Delete (with container keep/delete-contents prompt — 002 FR-006) ----
  function removeNodesKeepOrDelete(all: Node[], ids: Set<string>, keepMode: boolean): Node[] {
    const toRemove = new Set(ids);
    if (!keepMode) {
      let changedAny = true;
      while (changedAny) {
        changedAny = false;
        for (const n of all) {
          if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
            toRemove.add(n.id);
            changedAny = true;
          }
        }
      }
    }
    const removedParentOf = new Map<string, string | undefined>();
    if (keepMode) for (const n of all) if (ids.has(n.id)) removedParentOf.set(n.id, n.parentId);

    return all
      .filter((n) => !toRemove.has(n.id))
      .map((n) => {
        if (keepMode && n.parentId && ids.has(n.parentId)) {
          const grandParent = removedParentOf.get(n.parentId);
          const { parentId: _drop, ...rest } = n;
          void _drop;
          return grandParent ? { ...rest, parentId: grandParent } : rest;
        }
        return n;
      });
  }

  const deleteSelection = useCallback(() => {
    const selectedNodes = nodesRef.current.filter((n) => n.selected);
    const selectedEdges = edgesRef.current.filter((e) => e.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
    const hasContainer = selectedNodes.some((n) => n.type === 'container');
    if (hasContainer) {
      setContainerDeleteConfirm({ ids: new Set(selectedNodes.map((n) => n.id)) });
      return;
    }
    const ids = new Set(selectedNodes.map((n) => n.id));
    const nextNodes = ids.size > 0 ? removeNodesKeepOrDelete(nodesRef.current, ids, false) : nodesRef.current;
    const remainingIds = new Set(nextNodes.map((n) => n.id));
    const edgeIds = new Set(selectedEdges.map((e) => e.id));
    const nextEdges = edgesRef.current.filter((e) => remainingIds.has(e.source) && remainingIds.has(e.target) && !edgeIds.has(e.id));
    commit(nextNodes, nextEdges);
  }, [commit]);

  const resolveContainerDelete = useCallback(
    (mode: 'keep' | 'delete') => {
      if (!containerDeleteConfirm) return;
      const nextNodes = removeNodesKeepOrDelete(nodesRef.current, containerDeleteConfirm.ids, mode === 'keep');
      const remainingIds = new Set(nextNodes.map((n) => n.id));
      const nextEdges = edgesRef.current.filter((e) => remainingIds.has(e.source) && remainingIds.has(e.target));
      commit(nextNodes, nextEdges);
      setContainerDeleteConfirm(null);
    },
    [containerDeleteConfirm, commit]
  );

  const deleteNodeById = useCallback(
    (id: string) => {
      const nextNodes = nodesRef.current.filter((n) => n.id !== id);
      const remainingIds = new Set(nextNodes.map((n) => n.id));
      const nextEdges = edgesRef.current.filter((e) => remainingIds.has(e.source) && remainingIds.has(e.target));
      commit(nextNodes, nextEdges);
    },
    [commit]
  );

  // ---- Clipboard + duplicate (002 FR-009) ----
  const pasteSeqRef = useRef(0);
  const copySelectionAction = useCallback(() => {
    const selected = nodesRef.current.filter((n) => n.selected);
    if (selected.length === 0) return;
    copyToClipboard(selected as unknown as ClipboardNode[], edgesRef.current as unknown as ClipboardEdge[]);
  }, []);
  const pasteAction = useCallback(() => {
    if (!hasClipboardContent()) return;
    pasteSeqRef.current += 1;
    const { nodes: newNodes, edges: newEdges } = pasteFromClipboard(pasteSeqRef.current);
    const nextNodes = [
      ...nodesRef.current.map((n) => ({ ...n, selected: false })),
      ...(newNodes as unknown as Node[]).map((n) => ({ ...n, selected: true })),
    ];
    const nextEdges = [...edgesRef.current, ...(newEdges as unknown as Edge[])];
    commit(nextNodes, nextEdges);
  }, [commit]);
  const duplicateAction = useCallback(() => {
    const selected = nodesRef.current.filter((n) => n.selected);
    if (selected.length === 0) return;
    const selectedIds = new Set(selected.map((n) => n.id));
    const innerEdges = edgesRef.current.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target));
    pasteSeqRef.current += 1;
    const { nodes: newNodes, edges: newEdges } = duplicateSelection(
      selected as unknown as ClipboardNode[],
      innerEdges as unknown as ClipboardEdge[],
      pasteSeqRef.current
    );
    const nextNodes = [
      ...nodesRef.current.map((n) => ({ ...n, selected: false })),
      ...(newNodes as unknown as Node[]).map((n) => ({ ...n, selected: true })),
    ];
    const nextEdges = [...edgesRef.current, ...(newEdges as unknown as Edge[])];
    commit(nextNodes, nextEdges);
  }, [commit]);
  useEffect(() => {
    duplicateActionRef.current = duplicateAction;
  }, [duplicateAction]);

  const selectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
  }, [setNodes, setEdges]);

  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeSelection = useCallback(
    (key: string, step: number) => {
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      if (dx === 0 && dy === 0) return;
      const hasSelection = nodesRef.current.some((n) => n.selected);
      if (!hasSelection) return;
      const next = nodesRef.current.map((n) =>
        n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n
      );
      setNodes(next);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => {
        pushHistory(nodesRef.current, edgesRef.current);
        onDirtyRef.current();
      }, 400);
    },
    [setNodes, pushHistory]
  );

  // ---- Align / distribute (002 FR-004) ----
  const applyAlign = useCallback(
    (mode: AlignMode) => {
      const targets = nodesRef.current.filter((n) => n.selected);
      if (targets.length < 2) return;
      const byParent = new Map<string, Box[]>();
      for (const n of targets) {
        const key = n.parentId ?? '';
        const arr = byParent.get(key) ?? [];
        arr.push(nodeBox(n, fallbackSize(n)));
        byParent.set(key, arr);
      }
      const updates = new Map<string, { x: number; y: number }>();
      for (const group of byParent.values()) {
        if (group.length < 2) continue;
        for (const [id, pos] of alignBoxes(group, mode)) updates.set(id, pos);
      }
      if (updates.size === 0) return;
      const next = nodesRef.current.map((n) => (updates.has(n.id) ? { ...n, position: updates.get(n.id)! } : n));
      commit(next, edgesRef.current);
    },
    [commit]
  );
  const applyDistribute = useCallback(
    (axis: DistributeAxis) => {
      const targets = nodesRef.current.filter((n) => n.selected);
      if (targets.length < 3) return;
      const byParent = new Map<string, Box[]>();
      for (const n of targets) {
        const key = n.parentId ?? '';
        const arr = byParent.get(key) ?? [];
        arr.push(nodeBox(n, fallbackSize(n)));
        byParent.set(key, arr);
      }
      const updates = new Map<string, { x: number; y: number }>();
      for (const group of byParent.values()) {
        if (group.length < 3) continue;
        for (const [id, pos] of distributeBoxes(group, axis)) updates.set(id, pos);
      }
      if (updates.size === 0) return;
      const next = nodesRef.current.map((n) => (updates.has(n.id) ? { ...n, position: updates.get(n.id)! } : n));
      commit(next, edgesRef.current);
    },
    [commit]
  );

  // ---- Auto-arrange via elkjs (002 FR-018) ----
  const runAutoArrange = useCallback(
    async (scopeToSelection: boolean) => {
      const currentNodes = nodesRef.current;
      const containerIds = new Set(currentNodes.filter((n) => n.type === 'container').map((n) => n.id));
      const layoutable = currentNodes.filter((n) => n.type === 'service' || n.type === 'container');
      if (layoutable.length === 0) return;
      const selectedIds = new Set(currentNodes.filter((n) => n.selected).map((n) => n.id));
      const scope = scopeToSelection && selectedIds.size > 0 ? selectedIds : undefined;
      const layoutNodes: LayoutNode[] = layoutable.map((n) => {
        const { width, height } = nodeBox(n, fallbackSize(n));
        return { id: n.id, width, height, parentId: n.parentId ?? null };
      });
      const layoutEdges: LayoutEdge[] = edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target }));
      const result = await layoutWithElk(layoutNodes, layoutEdges, containerIds, scope);
      const nextNodes = currentNodes.map((n) => {
        const pos = result.positions.get(n.id);
        const size = result.sizes.get(n.id);
        if (!pos && !size) return n;
        return {
          ...n,
          position: pos ?? n.position,
          ...(n.type === 'container' && size ? { width: size.width, height: size.height } : {}),
        };
      });
      commit(nextNodes, edgesRef.current);
    },
    [commit]
  );

  // ---- Edge style/label (002 FR-012) ----
  const updateEdgeLabel = useCallback(
    (id: string, label: string) => {
      const next = edgesRef.current.map((e) => (e.id === id ? { ...e, label } : e));
      commit(nodesRef.current, next);
    },
    [commit]
  );
  const updateEdgeStyle = useCallback(
    (id: string, patch: Partial<DocEdgeStyle>) => {
      const next = edgesRef.current.map((e) => {
        if (e.id !== id) return e;
        const data = (e.data ?? {}) as Partial<OrthogonalEdgeData>;
        const edgeStyle: DocEdgeStyle = { ...DEFAULT_EDGE_STYLE, ...(data.edgeStyle ?? {}), ...patch };
        return { ...e, data: { ...data, edgeStyle }, ...edgeMarkers(edgeStyle) };
      });
      commit(nodesRef.current, next);
    },
    [commit]
  );

  // ---- Context menu ----
  const openMenuAt = useCallback((clientX: number, clientY: number, target: ContextMenuTarget) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setMenu({ target, screen: { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) } });
  }, []);
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const me = event as React.MouseEvent;
      openMenuAt(me.clientX, me.clientY, { kind: 'canvas', x: me.clientX, y: me.clientY });
    },
    [openMenuAt]
  );
  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      if (!node.selected) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
        setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
      }
      const kind = node.type === 'container' ? 'container' : node.type === 'annotation' ? 'annotation' : 'service';
      openMenuAt(event.clientX, event.clientY, { kind, id: node.id, x: event.clientX, y: event.clientY } as ContextMenuTarget);
    },
    [setNodes, setEdges, openMenuAt]
  );
  const onEdgeContextMenu: EdgeMouseHandler = useCallback(
    (event, edge) => {
      event.preventDefault();
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edge.id })));
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
      openMenuAt(event.clientX, event.clientY, { kind: 'connection', id: edge.id, x: event.clientX, y: event.clientY });
    },
    [setNodes, setEdges, openMenuAt]
  );

  // 007 2.3 — annotation stacking: bounded zIndex bump relative to the other
  // annotations; persisted through the document as `z`.
  const reorderAnnotation = useCallback(
    (id: string, dir: 'front' | 'back') => {
      const zs = nodesRef.current.filter((n) => n.type === 'annotation').map((n) => n.zIndex ?? 0);
      const nextZ = dir === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      commit(
        nodesRef.current.map((n) => (n.id === id ? { ...n, zIndex: Math.max(-100, Math.min(100, nextZ)) } : n)),
        edgesRef.current
      );
    },
    [commit]
  );

  function buildActions(target: ContextMenuTarget): MenuAction[] {
    switch (target.kind) {
      case 'canvas':
        return [
          { label: 'Paste', onSelect: pasteAction, disabled: !hasClipboardContent() },
          { label: 'Select all', onSelect: selectAll },
          { label: 'Fit view', onSelect: () => fitView({ padding: 0.2, duration: motionDuration(200) }) },
          { label: 'Auto-arrange', onSelect: () => runAutoArrange(false) },
        ];
      case 'service':
        return [
          { label: `Duplicate (${MOD}D)`, onSelect: duplicateAction },
          { label: `Copy (${MOD}C)`, onSelect: copySelectionAction },
          { label: 'Delete', destructive: true, onSelect: deleteSelection },
        ];
      case 'container':
        return [
          { label: 'Duplicate', onSelect: duplicateAction },
          { label: 'Delete…', destructive: true, onSelect: deleteSelection },
        ];
      case 'annotation':
        return [
          { label: 'Duplicate', onSelect: duplicateAction },
          { label: 'Bring to front', onSelect: () => reorderAnnotation(target.id, 'front') },
          { label: 'Send to back', onSelect: () => reorderAnnotation(target.id, 'back') },
          { label: 'Delete', destructive: true, onSelect: deleteSelection },
        ];
      case 'connection':
        return [{ label: 'Delete connection', destructive: true, onSelect: deleteSelection }];
    }
  }

  // ---- Keyboard shortcuts (002 FR-010) ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.code === 'Space') {
        setSpacePressed(true);
        return;
      }
      if (e.key === '?') {
        setShortcutsOpen(true);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        nudgeSelection(e.key, e.shiftKey ? 10 : 1);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelectionAction();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteAction();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateAction();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn({ duration: motionDuration(150) });
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomOut({ duration: motionDuration(150) });
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        fitView({ padding: 0.2, duration: motionDuration(200) });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [deleteSelection, nudgeSelection, selectAll, copySelectionAction, pasteAction, duplicateAction, undo, redo, zoomIn, zoomOut, fitView]);

  // ---- Imperative API for the studio page ----
  const serviceMeta = useCallback((serviceId: string) => {
    const def = serviceById(serviceId);
    return { provider: (def?.provider ?? 'aws') as 'aws' | 'mongodb' | 'system', category: def?.category ?? '' };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      // formatRules always included (even []) so an explicit save is
      // authoritative — deleting the last rule persists the deletion.
      getDocument: () => ({ ...flowToDocument(nodesRef.current, edgesRef.current, serviceMeta), formatRules: formatRulesRef.current }),
      loadDocument: (doc: ArchDocument) => {
        const { nodes: n, edges: e } = documentToFlow(doc);
        setNodes(n);
        setEdges(e);
        setFormatRules(sanitizeFormatRules(doc.formatRules));
        historyRef.current = [{ nodes: n.map(cloneNode), edges: e.map(cloneEdge) }];
        historyIndexRef.current = 0;
        syncHistoryView();
      },
      addService,
      updateNodeConfig: (id: string, key: string, value: string) => {
        const next = nodesRef.current.map((n) => {
          if (n.id !== id || n.type !== 'service') return n;
          const d = n.data as SvcData;
          const config = { ...d.config, [key]: value };
          const est = resolveServiceDef(d.serviceId, d).estimate(config);
          return { ...n, data: { ...d, config, cost: est } };
        });
        commit(next, edgesRef.current);
      },
      renameNode: (id: string, displayName: string) => patchNodeData(id, { displayName }),
      deleteNodeById,
      clear: () => commit([], []),
      fitView: () => fitView({ padding: 0.2, duration: motionDuration(300) }),
      openShortcuts: () => setShortcutsOpen(true),
      autoArrange: () => runAutoArrange(false),
      centerOnNode: (nodeId: string) => {
        const n = nodesRef.current.find((x) => x.id === nodeId);
        if (!n) return;
        const byId = new Map(nodesRef.current.map((x) => [x.id, x]));
        const pos = absolutePosition(n, byId);
        const w = n.measured?.width ?? n.width ?? 188;
        const h = n.measured?.height ?? n.height ?? 98;
        setCenter(pos.x + w / 2, pos.y + h / 2, { zoom: 1, duration: motionDuration(400) });
      },
    }),
    [serviceMeta, setNodes, setEdges, addService, commit, patchNodeData, deleteNodeById, fitView, syncHistoryView, runAutoArrange, setCenter]
  );

  // ---- Flow walkthrough (007 3.1) — step through the request path. --------
  // Render-only: display nodes/edges are derived per step; nothing is
  // committed to state/history and exiting restores the plain render.
  const [walkthrough, setWalkthrough] = useState<{ steps: FlowStep[]; index: number; playing: boolean } | null>(null);

  const startWalkthrough = useCallback(() => {
    const walkNodes = nodesRef.current
      .filter((n) => n.type === 'service')
      .map((n) => {
        const d = n.data as SvcData;
        return { id: n.id, name: (d.displayName || resolveServiceDef(d.serviceId, d).name) as string };
      });
    const walkEdges = edgesRef.current.map((e) => ({
      edgeId: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' && e.label ? e.label : undefined,
    }));
    const steps = computeFlowSteps(walkNodes, walkEdges);
    if (steps.length > 0) setWalkthrough({ steps, index: 0, playing: true });
  }, []);

  useEffect(() => {
    if (!walkthrough?.playing) return;
    const t = setTimeout(() => {
      setWalkthrough((w) => (w ? (w.index < w.steps.length - 1 ? { ...w, index: w.index + 1 } : { ...w, playing: false }) : w));
    }, 2200);
    return () => clearTimeout(t);
  }, [walkthrough]);

  useEffect(() => {
    if (!walkthrough) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWalkthrough(null);
      if (e.key === 'ArrowRight') setWalkthrough((w) => (w && w.index < w.steps.length - 1 ? { ...w, index: w.index + 1, playing: false } : w));
      if (e.key === 'ArrowLeft') setWalkthrough((w) => (w && w.index > 0 ? { ...w, index: w.index - 1, playing: false } : w));
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [walkthrough]);

  const walkStep = walkthrough ? walkthrough.steps[walkthrough.index] : null;
  const displayNodes = walkStep
    ? nodes.map((n) => {
        const active = n.id === walkStep.source || n.id === walkStep.target;
        return { ...n, style: { ...n.style, opacity: active ? 1 : 0.25, transition: 'opacity 200ms' } };
      })
    : nodes;
  const displayEdges = walkStep
    ? edges.map((e) => ({
        ...e,
        data: { ...e.data, walk: e.id === walkStep.edgeId ? ('active' as const) : ('dim' as const) },
      }))
    : edges;

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdgesArr = edges.filter((e) => e.selected);
  const singleContainer =
    selectedNodes.length === 1 && selectedEdgesArr.length === 0 && selectedNodes[0].type === 'container' ? selectedNodes[0] : null;
  const singleAnnotation =
    selectedNodes.length === 1 && selectedEdgesArr.length === 0 && selectedNodes[0].type === 'annotation' ? selectedNodes[0] : null;
  const singleEdge = selectedEdgesArr.length === 1 && selectedNodes.length === 0 ? selectedEdgesArr[0] : null;
  const singleService =
    selectedNodes.length === 1 && selectedEdgesArr.length === 0 && selectedNodes[0].type === 'service' ? selectedNodes[0] : null;
  const canUndo = historyView.index > 0;
  const canRedo = historyView.index < historyView.length - 1;
  const canAlign = selectedNodes.length >= 2;
  const canDistribute = selectedNodes.length >= 3;

  return (
    <div
      ref={wrapperRef}
      className={cn('relative h-full w-full', className)}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
    >
      {/* Layout toolbar (002 FR-003/004/018) */}
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-0.5 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1 shadow-sm">
        <div className="relative">
          <button
            onClick={() => setAddContainerOpen((o) => !o)}
            aria-label="Add container"
            aria-expanded={addContainerOpen}
            title="Add a typed boundary container"
            className="flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <Boxes size={15} />
            <ChevronDown size={11} />
          </button>
          {addContainerOpen && (
            <div className="absolute left-0 top-8 z-30 w-44 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
              {CONTAINER_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addContainerAction(t.id)}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: t.accent }} />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton icon={<NotebookText size={15} />} label="Add note" onClick={() => addAnnotationAction('text')} />
        <IconButton icon={<StickyNote size={15} />} label="Add sticky" onClick={() => addAnnotationAction('sticky')} />
        <Divider />
        <IconButton icon={<AlignStartVertical size={15} />} label="Align left" disabled={!canAlign} onClick={() => applyAlign('left')} />
        <IconButton icon={<AlignCenterVertical size={15} />} label="Align center" disabled={!canAlign} onClick={() => applyAlign('center')} />
        <IconButton icon={<AlignEndVertical size={15} />} label="Align right" disabled={!canAlign} onClick={() => applyAlign('right')} />
        <IconButton icon={<AlignStartHorizontal size={15} />} label="Align top" disabled={!canAlign} onClick={() => applyAlign('top')} />
        <IconButton icon={<AlignCenterHorizontal size={15} />} label="Align middle" disabled={!canAlign} onClick={() => applyAlign('middle')} />
        <IconButton icon={<AlignEndHorizontal size={15} />} label="Align bottom" disabled={!canAlign} onClick={() => applyAlign('bottom')} />
        <IconButton
          icon={<AlignHorizontalDistributeCenter size={15} />}
          label="Distribute horizontally"
          disabled={!canDistribute}
          onClick={() => applyDistribute('horizontal')}
        />
        <IconButton
          icon={<AlignVerticalDistributeCenter size={15} />}
          label="Distribute vertically"
          disabled={!canDistribute}
          onClick={() => applyDistribute('vertical')}
        />
        <Divider />
        <IconButton
          icon={<Shuffle size={15} />}
          label={selectedNodes.length > 0 ? 'Auto-arrange selection' : 'Auto-arrange diagram'}
          disabled={nodes.length === 0}
          onClick={() => runAutoArrange(selectedNodes.length > 0)}
        />
        <IconButton
          icon={<Play size={15} />}
          label="Play the request flow"
          disabled={edges.length === 0}
          pressed={walkthrough !== null}
          onClick={() => (walkthrough ? setWalkthrough(null) : startWalkthrough())}
        />
        <div className="relative">
          <button
            onClick={() => setViewMenuOpen((o) => !o)}
            aria-label="Canvas view options"
            aria-expanded={viewMenuOpen}
            title="Canvas view options (background style, snap)"
            className={cn(
              'flex h-7 items-center gap-0.5 rounded-lg px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
              viewMenuOpen
                ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <Grid3x3 size={15} />
            <ChevronDown size={11} />
          </button>
          {viewMenuOpen && (
            <div className="absolute left-0 top-8 z-30 w-48 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
              <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                Background
              </p>
              {CANVAS_BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => pickBackground(b.id)}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <span className="w-3.5">{bgStyle === b.id && <Check size={13} />}</span>
                  {b.label}
                </button>
              ))}
              <div className="mx-1 my-1 h-px bg-[var(--color-surface-variant)]" />
              <button
                onClick={toggleSnap}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <span className="w-3.5">{snapToGrid && <Check size={13} />}</span>
                Snap to grid
              </button>
            </div>
          )}
        </div>
        <IconButton
          icon={<Paintbrush size={15} />}
          label={`Conditional formatting${formatRules.length > 0 ? ` (${formatRules.length} rule${formatRules.length === 1 ? '' : 's'})` : ''}`}
          pressed={formatOpen || formatRules.length > 0}
          onClick={() => setFormatOpen((o) => !o)}
        />
        <Divider />
        <IconButton icon={<Undo2 size={15} />} label={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={undo} />
        <IconButton icon={<Redo2 size={15} />} label={`Redo (${MOD}⇧Z)`} disabled={!canRedo} onClick={redo} />
        <IconButton icon={<Keyboard size={15} />} label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)} />
      </div>

      {/* Lucid-parity conditional formatting — data-linked styling rules. */}
      {formatOpen && (
        <FormatRulesPanel
          rules={formatRules}
          onAdd={addFormatRule}
          onRemove={removeFormatRule}
          onClose={() => setFormatOpen(false)}
        />
      )}

      {/* 007 2.1 — quick-connect suggestion popover at the drop point. */}
      {quickConnect && (
        <>
          <button aria-label="Dismiss suggestions" className="fixed inset-0 z-20 cursor-default" onClick={() => setQuickConnect(null)} />
          <div
            className="absolute z-30 w-56 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg"
            style={{ left: Math.max(8, quickConnect.screen.x - 112), top: quickConnect.screen.y + 8 }}
          >
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              Connect to…
            </p>
            {quickConnect.suggestions.map((sid) => {
              const def = serviceById(sid)!;
              return (
                <button
                  key={sid}
                  onClick={() => quickAddConnected(sid)}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <ServiceIcon def={def} size={22} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{def.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 007 3.1 — walkthrough controls: step caption + prev/play/next/exit. */}
      {walkthrough && walkStep && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] py-1.5 pl-4 pr-1.5 shadow-xl">
          <span className="shrink-0 rounded-full bg-[var(--color-primary-fixed)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--color-on-primary-fixed)]">
            {walkStep.index}/{walkthrough.steps.length}
          </span>
          <span className="max-w-[40vw] truncate text-xs font-medium text-[var(--color-text-primary)]" title={walkStep.caption}>
            {walkStep.caption}
          </span>
          <span className="flex items-center gap-0.5">
            <IconButton
              icon={<ChevronLeft size={14} />}
              label="Previous step"
              disabled={walkthrough.index === 0}
              onClick={() => setWalkthrough((w) => (w && w.index > 0 ? { ...w, index: w.index - 1, playing: false } : w))}
            />
            <IconButton
              icon={walkthrough.playing ? <Pause size={14} /> : <Play size={14} />}
              label={walkthrough.playing ? 'Pause' : 'Play'}
              onClick={() =>
                setWalkthrough((w) =>
                  w ? { ...w, playing: !w.playing, index: !w.playing && w.index === w.steps.length - 1 ? 0 : w.index } : w
                )
              }
            />
            <IconButton
              icon={<ChevronRight size={14} />}
              label="Next step"
              disabled={walkthrough.index >= walkthrough.steps.length - 1}
              onClick={() => setWalkthrough((w) => (w && w.index < w.steps.length - 1 ? { ...w, index: w.index + 1, playing: false } : w))}
            />
            <IconButton icon={<X size={14} />} label="Exit walkthrough (Esc)" onClick={() => setWalkthrough(null)} />
          </span>
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        // Loose: service nodes expose one source-type handle per side, and this
        // is what lets a connection END on any of them too — strict mode would
        // demand dedicated target handles and forbid side-to-side hookups.
        connectionMode={ConnectionMode.Loose}
        onNodeDrag={onNodeDrag}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => setMenu(null)}
        onNodeClick={(_, node) => {
          // Click (React Flow suppresses this for drags) on a service opens its
          // pricing editor; containers/annotations only select.
          if (node.type === 'service') onServiceOpenRef.current?.(node.id);
        }}
        snapToGrid={snapToGrid}
        snapGrid={[16, 16]}
        panOnDrag={spacePressed ? true : [1, 2]}
        selectionOnDrag={!spacePressed}
        selectNodesOnDrag={false}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        fitView
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="!bg-[var(--color-surface-container-low)]"
        onlyRenderVisibleElements={nodes.length > 60}
      >
        {bgStyle !== 'none' && (
          <Background
            variant={
              bgStyle === 'dots'
                ? BackgroundVariant.Dots
                : bgStyle === 'cross'
                  ? BackgroundVariant.Cross
                  : BackgroundVariant.Lines
            }
            gap={bgStyle === 'cross' ? 24 : 16}
            size={bgStyle === 'dots' ? 1.5 : bgStyle === 'cross' ? 5 : undefined}
            color="var(--color-outline-variant)"
          />
        )}
        <Controls className="!rounded-xl !border !border-[var(--color-surface-variant)] !shadow-sm" showInteractive={false} />
        <AlignmentGuides guides={guides} />
      </ReactFlow>

      <MiniMapPanel />

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/5" />
      )}

      {/* Element properties bar — single container/annotation/edge/service selection (002 FR-012/013/014; 007 2.3) */}
      {(singleContainer || singleAnnotation || singleEdge || singleService) && (
        <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-2 shadow-sm">
          {singleService && (
            <>
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Color</span>
              <button
                aria-label="Automatic color"
                title="Automatic (catalog color)"
                onClick={() => patchNodeData(singleService.id, { accent: undefined })}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-semibold text-[var(--color-text-secondary)]',
                  !(singleService.data as SvcData).accent
                    ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30'
                    : 'border-[var(--color-outline-variant)]'
                )}
              >
                A
              </button>
              {(['primary', 'success', 'warning', 'danger'] as const).map((token) => (
                <button
                  key={token}
                  aria-label={`Color ${token}`}
                  title={token}
                  onClick={() => patchNodeData(singleService.id, { accent: token })}
                  className={cn(
                    'h-6 w-6 rounded-full border-2',
                    (singleService.data as SvcData).accent === token
                      ? 'border-[var(--color-text-primary)]'
                      : 'border-transparent'
                  )}
                  style={{ background: EDGE_COLORS[token] }}
                />
              ))}
              {/* Lucid-parity hotspot: attach an external URL to the node. */}
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Link</span>
              <input
                key={singleService.id}
                defaultValue={((singleService.data as SvcData).link as string) ?? ''}
                placeholder="https://…"
                title="Attach an external URL (docs, console, runbook) — opens from the node"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const current = ((singleService.data as SvcData).link as string) ?? '';
                  if (v !== current && (v === '' || /^https?:\/\//i.test(v))) {
                    patchNodeData(singleService.id, { link: v || undefined });
                  }
                }}
                className="nodrag h-7 w-44 rounded-lg border border-[var(--color-outline-variant)] bg-transparent px-2 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
              />
            </>
          )}
          {singleContainer && (
            <>
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Container</span>
              <Select
                aria-label="Container type"
                value={(singleContainer.data as ContainerNodeData).ctype}
                onChange={(e) => patchNodeData(singleContainer.id, { ctype: e.target.value })}
                className="h-7 w-36 text-[11px]"
              >
                {CONTAINER_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </>
          )}
          {singleAnnotation && (
            <>
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Note</span>
              <Select
                aria-label="Annotation kind"
                value={(singleAnnotation.data as AnnotationNodeData).kind}
                onChange={(e) => patchNodeData(singleAnnotation.id, { kind: e.target.value })}
                className="h-7 w-24 text-[11px]"
              >
                <option value="text">Text</option>
                <option value="sticky">Sticky</option>
              </Select>
              <Select
                aria-label="Annotation color"
                value={(singleAnnotation.data as AnnotationNodeData).color}
                onChange={(e) => patchNodeData(singleAnnotation.id, { color: e.target.value })}
                className="h-7 w-24 text-[11px]"
              >
                <option value="default">Default</option>
                <option value="yellow">Yellow</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="pink">Pink</option>
              </Select>
            </>
          )}
          {singleEdge && (
            <>
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Connection</span>
              <input
                aria-label="Connection label"
                defaultValue={typeof singleEdge.label === 'string' ? singleEdge.label : ''}
                key={singleEdge.id}
                placeholder="Label…"
                onBlur={(e) => updateEdgeLabel(singleEdge.id, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="h-7 w-28 rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] px-2 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
              />
              {(() => {
                const style: DocEdgeStyle = { ...DEFAULT_EDGE_STYLE, ...((singleEdge.data as Partial<OrthogonalEdgeData>)?.edgeStyle ?? {}) };
                return (
                  <>
                    <Select
                      aria-label="Connection geometry"
                      value={style.geometry}
                      onChange={(e) => updateEdgeStyle(singleEdge.id, { geometry: e.target.value as DocEdgeStyle['geometry'] })}
                      className="h-7 w-24 text-[11px]"
                    >
                      <option value="orthogonal">Orthogonal</option>
                      <option value="straight">Straight</option>
                      <option value="curved">Curved</option>
                    </Select>
                    <Select
                      aria-label="Connection pattern"
                      value={style.pattern}
                      onChange={(e) => updateEdgeStyle(singleEdge.id, { pattern: e.target.value as DocEdgeStyle['pattern'] })}
                      className="h-7 w-20 text-[11px]"
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                    </Select>
                    <Select
                      aria-label="Connection arrowheads"
                      value={style.arrowheads}
                      onChange={(e) => updateEdgeStyle(singleEdge.id, { arrowheads: e.target.value as DocEdgeStyle['arrowheads'] })}
                      className="h-7 w-24 text-[11px]"
                    >
                      <option value="none">No arrows</option>
                      <option value="end">Arrow end</option>
                      <option value="both">Both ends</option>
                    </Select>
                    <Select
                      aria-label="Connection color"
                      value={style.color}
                      onChange={(e) => updateEdgeStyle(singleEdge.id, { color: e.target.value as DocEdgeStyle['color'] })}
                      className="h-7 w-24 text-[11px]"
                    >
                      <option value="default">Default</option>
                      <option value="primary">Primary</option>
                      <option value="success">Success</option>
                      <option value="warning">Warning</option>
                      <option value="danger">Danger</option>
                    </Select>
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {menu && <CanvasContextMenu screenPosition={menu.screen} actions={buildActions(menu.target)} onClose={() => setMenu(null)} />}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}

      {containerDeleteConfirm && (
        <div role="alertdialog" aria-modal="true" aria-label="Delete container" className="absolute inset-0 z-50 flex items-center justify-center bg-black/25">
          <div className="w-full max-w-sm rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-2xl">
            <h2 className="mb-1.5 text-sm font-semibold text-[var(--color-text-primary)]">Delete container</h2>
            <p className="mb-4 text-xs text-[var(--color-text-secondary)]">
              This deletes {containerDeleteConfirm.ids.size > 1 ? 'these containers' : 'this container'}. Delete their members too, or
              keep them — they&apos;ll move up to the enclosing container or the canvas.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setContainerDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={() => resolveContainerDelete('keep')}>
                Keep contents
              </Button>
              <Button variant="danger" size="sm" onClick={() => resolveContainerDelete('delete')}>
                Delete all
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Conditional-formatting rules panel (Lucid-parity data linking): list the
 * document's rules and add/remove them. Evaluation itself happens in
 * ServiceNode at render time — this panel only edits the rule list.
 */
function FormatRulesPanel({
  rules,
  onAdd,
  onRemove,
  onClose,
}: {
  rules: FormatRule[];
  onAdd: (rule: Omit<FormatRule, 'ruleId'>) => void;
  onRemove: (ruleId: string) => void;
  onClose: () => void;
}) {
  const [field, setField] = useState<FormatRule['field']>('cost');
  const [op, setOp] = useState<FormatRule['op']>('gt');
  const [value, setValue] = useState('');
  const [accent, setAccent] = useState<FormatRule['accent']>('warning');
  const numericField = RULE_FIELDS.find((f) => f.id === field)?.numeric ?? false;
  // Numeric fields get numeric ops; string fields get string ops.
  const ops = RULE_OPS.filter((o) => o.numeric === numericField);
  const opValid = ops.some((o) => o.id === op);
  const canAdd = value.trim().length > 0 && opValid && rules.length < FORMAT_RULE_LIMIT && (!numericField || Number.isFinite(Number(value)));

  return (
    <div className="absolute left-3 top-14 z-30 w-[340px] rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">Conditional formatting</p>
        <button aria-label="Close" onClick={onClose} className="rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]">
          <X size={13} />
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-[var(--color-text-secondary)]">
        Color services by their data — the styling follows the data as it changes. First matching rule wins; rules save with the diagram.
      </p>
      {rules.length > 0 && (
        <ul className="mb-2 space-y-1">
          {rules.map((r) => (
            <li key={r.ruleId} className="flex items-center gap-2 rounded-xl border border-[var(--color-surface-variant)] px-2 py-1">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: EDGE_COLORS[r.accent] }} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-primary)]" title={describeRule(r)}>
                {describeRule(r)}
              </span>
              <button aria-label="Remove rule" title="Remove rule" onClick={() => onRemove(r.ruleId)} className="rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-danger,#d93025)]">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          aria-label="Rule field"
          value={field}
          onChange={(e) => {
            const next = e.target.value as FormatRule['field'];
            setField(next);
            const nextNumeric = RULE_FIELDS.find((f) => f.id === next)?.numeric ?? false;
            const nextOps = RULE_OPS.filter((o) => o.numeric === nextNumeric);
            if (!nextOps.some((o) => o.id === op)) setOp(nextOps[0].id);
          }}
          className="h-7 w-[124px] text-[11px]"
        >
          {RULE_FIELDS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </Select>
        <Select aria-label="Rule operator" value={op} onChange={(e) => setOp(e.target.value as FormatRule['op'])} className="h-7 w-[86px] text-[11px]">
          {ops.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </Select>
        <input
          aria-label="Rule value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && canAdd) {
              onAdd({ field, op, value: value.trim(), accent });
              setValue('');
            }
          }}
          placeholder={numericField ? 'e.g. 100' : 'e.g. mongodb'}
          className="h-7 w-[104px] rounded-lg border border-[var(--color-outline-variant)] bg-transparent px-2 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
        />
        {(['primary', 'success', 'warning', 'danger'] as const).map((token) => (
          <button
            key={token}
            aria-label={`Rule color ${token}`}
            title={token}
            onClick={() => setAccent(token)}
            className={cn('h-5 w-5 rounded-full border-2', accent === token ? 'border-[var(--color-text-primary)]' : 'border-transparent')}
            style={{ background: EDGE_COLORS[token] }}
          />
        ))}
        <Button
          size="sm"
          variant="tonal"
          disabled={!canAdd}
          onClick={() => {
            onAdd({ field, op, value: value.trim(), accent });
            setValue('');
          }}
        >
          Add rule
        </Button>
      </div>
      {rules.length >= FORMAT_RULE_LIMIT && (
        <p className="mt-1.5 text-[10px] text-[var(--color-text-secondary)]">Rule limit reached ({FORMAT_RULE_LIMIT}) — remove one to add another.</p>
      )}
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        pressed
          ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]'
      )}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-[var(--color-surface-variant)]" />;
}

export const Canvas = forwardRef(CanvasImpl);
