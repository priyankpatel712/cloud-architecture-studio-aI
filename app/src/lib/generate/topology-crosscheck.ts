import 'server-only';
import { callServerTool, resolveMcpServer } from '@/lib/providers/mcp-client';
import type { ArchContainer, ArchEdge, ArchNode } from '@/lib/generate/orchestrator';

/**
 * Advisory topology cross-check (feature 008 FR-040; plan §6).
 *
 * A second, external opinion on whether the drafted topology is even
 * *expressible* as a diagram. The applied graph is rendered to `diagrams` DSL
 * code and handed to the optional AWS Labs diagram MCP; if that server refuses
 * the graph, its complaint is passed to the reviewer as a labelled hint.
 *
 * ADVISORY MEANS ADVISORY (FR-040). Three properties enforce it, and they are
 * the reason this file is safe to have at all:
 *   1. It NEVER throws and never returns a verdict — only a string of prose, or
 *      nothing. Nothing downstream can branch on it.
 *   2. Success is silent. A server that renders the graph contributes no text,
 *      so the reviewer's prompt is unchanged on the common path.
 *   3. The reviewer is told in its system prompt that this note cannot by
 *      itself justify a failing verdict, and the note never reaches the user.
 *
 * KNOW WHAT THIS IS WORTH. The diagram MCP is a renderer, not an architecture
 * validator — it will happily draw a bad design. Its signal is narrow: broken
 * references, and graphs graphviz cannot lay out. Our own structural validator
 * (research R6) already covers most of that and is a HARD gate, which is why
 * this one is off by default and stays advisory. It earns its place by being
 * independent of our code, not by being smarter than it.
 */

const RENDER_TIMEOUT_MS = 20_000;
/** A big graph is slow to render and no more informative than a bounded one. */
const MAX_NODES = 60;

/** Python identifiers from arbitrary node ids — never interpolate ids directly. */
function pyIdent(index: number): string {
  return `n${index}`;
}

/** Python string literal from arbitrary label text. */
function pyStr(value: string): string {
  return JSON.stringify(String(value ?? '').slice(0, 60));
}

function labelOf(node: ArchNode): string {
  return node.displayName?.trim() || node.serviceId;
}

/**
 * Render the applied graph as `diagrams` DSL.
 *
 * Every node is a `Blank`: this is a STRUCTURE check, and resolving real
 * provider icons would make the render fail on icon-name drift — a failure
 * about our icon mapping, not about the topology, reported as if it were the
 * latter. Exported for tests; pure.
 */
export function toDiagramsCode(nodes: ArchNode[], edges: ArchEdge[], containers: ArchContainer[]): string {
  const kept = nodes.slice(0, MAX_NODES);
  const identOf = new Map<string, string>();
  kept.forEach((n, i) => identOf.set(n.nodeId, pyIdent(i)));

  // A container whose parent is missing, or whose ancestry loops, is re-rooted
  // at the top level rather than dropped. Dropping it would silently take its
  // NODES out of the render too, and a check that quietly ignores part of the
  // graph is worse than one that draws it in the wrong box.
  const byId = new Map(containers.map((c) => [c.containerId, c]));
  const effectiveParent = (c: ArchContainer): string | null => {
    const parentId = c.parentContainerId ?? null;
    if (!parentId || !byId.has(parentId)) return null; // dangling — re-root
    const seen = new Set<string>([c.containerId]);
    for (let cursor: string | null = parentId; cursor; cursor = byId.get(cursor)?.parentContainerId ?? null) {
      if (seen.has(cursor)) return null; // ancestry loops and never reaches the top — re-root
      seen.add(cursor);
    }
    return parentId;
  };

  const childContainers = new Map<string | null, ArchContainer[]>();
  for (const c of containers) {
    const parent = effectiveParent(c);
    childContainers.set(parent, [...(childContainers.get(parent) ?? []), c]);
  }
  // Same treatment for a node pointing at a container that isn't there: draw it
  // at the top level rather than losing it (and its edges) from the render.
  const nodesIn = (containerId: string | null) =>
    kept.filter((n) => {
      const own = n.containerId ?? null;
      return (own && byId.has(own) ? own : null) === containerId;
    });

  const lines: string[] = [
    'from diagrams import Cluster, Diagram',
    'from diagrams.generic.blank import Blank',
    '',
    'with Diagram("topology", show=False, outformat="png"):',
  ];

  // Depth-bounded so a malformed parent chain (a cycle, say) cannot recurse
  // forever — this runs on untrusted-ish generated data.
  const emit = (containerId: string | null, depth: number) => {
    const pad = '    '.repeat(depth + 1);
    if (depth > 6) return;
    for (const n of nodesIn(containerId)) {
      lines.push(`${pad}${identOf.get(n.nodeId)} = Blank(${pyStr(labelOf(n))})`);
    }
    for (const c of childContainers.get(containerId) ?? []) {
      lines.push(`${pad}with Cluster(${pyStr(c.label || c.type)}):`);
      const before = lines.length;
      emit(c.containerId, depth + 1);
      // Python has no empty block — an empty cluster needs an explicit `pass`.
      if (lines.length === before) lines.push(`${pad}    pass`);
    }
  };
  emit(null, 0);

  // Edges last, at top level: `a >> b` is valid wherever both names are bound,
  // and emitting them inside a cluster would falsely imply containment.
  const drawn = edges.filter((e) => identOf.has(e.source) && identOf.has(e.target));
  for (const e of drawn) {
    lines.push(`    ${identOf.get(e.source)} >> ${identOf.get(e.target)}`);
  }
  if (kept.length === 0) lines.push('    pass');
  return lines.join('\n');
}

export interface CrossCheckInput {
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  signal?: AbortSignal;
}

/**
 * Ask the optional diagram MCP whether this topology renders.
 *
 * Returns advisory prose for the reviewer, or '' — which is both "all good" and
 * "not configured", deliberately: the caller must not be able to tell those
 * apart, so no code path can come to depend on the check having run.
 */
export async function crossCheckTopology(input: CrossCheckInput): Promise<string> {
  const server = resolveMcpServer('system', 'validation');
  if (!server || input.nodes.length === 0) return '';

  try {
    const code = toDiagramsCode(input.nodes, input.edges, input.containers);
    const raw = await Promise.race([
      callServerTool(server, { code, filename: 'topology-crosscheck', timeout: 15 }),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), RENDER_TIMEOUT_MS)),
    ]);
    if (!raw.trim()) return '';

    // awslabs.aws-diagram-mcp-server answers {status, message, path}. Anything
    // we cannot parse is treated as success — an unrecognised response is not
    // evidence of a problem, and guessing would manufacture false gaps.
    let status = '';
    let message = '';
    try {
      const parsed = JSON.parse(raw) as { status?: unknown; message?: unknown };
      status = typeof parsed.status === 'string' ? parsed.status : '';
      message = typeof parsed.message === 'string' ? parsed.message : '';
    } catch {
      return '';
    }
    if (status !== 'error') return '';

    return [
      'ADVISORY ONLY — an external diagram renderer could not draw this topology:',
      message.slice(0, 400),
      'Treat this as a hint about structure (dangling or contradictory connections), not as a',
      'finding. It is not authoritative and must not be the sole reason for a failing verdict.',
    ].join('\n');
  } catch {
    // An optional advisory rung must never affect a turn it cannot help.
    return '';
  }
}
