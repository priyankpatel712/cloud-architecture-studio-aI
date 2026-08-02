import { resolveServiceDef } from '@/lib/catalog';

/**
 * Step-by-step client walkthrough — the pure core. The LLM (or the degraded
 * fallback) produces ordered steps that each explain one stage of the
 * architecture AND name the exact diagram nodes involved, so the PDF export
 * can render the matching diagram section next to every step. Everything here
 * is synchronous and Mongoose-free so it can be unit-tested directly; the
 * caching/LLM orchestration lives in walkthrough.ts.
 */

export interface WalkthroughStep {
  /** short client-facing step title */
  title: string;
  /** 2-4 plain-language sentences explaining this stage */
  explanation: string;
  /** diagram nodes this step covers — every id verified against the diagram */
  nodeIds: string[];
}

export interface WalkthroughReport {
  /** 2-4 plain-language sentences framing the whole solution */
  introduction: string;
  steps: WalkthroughStep[];
  /** wrap-up + next steps, client-facing */
  conclusion: string;
  /** true when the LLM was unavailable and steps are diagram-derived */
  degraded: boolean;
  generatedAt: string;
}

/** Structural subset of ArchitectureDoc the walkthrough needs. */
export interface WalkthroughArch {
  nodes: {
    nodeId: string;
    serviceId: string;
    displayName?: string | null;
    config?: Record<string, string | number> | null;
    cost: number;
  }[];
  edges: { source: string; target: string; label?: string | null }[];
}

/** Hard cap on steps — beyond this a "walkthrough" stops being one. */
export const MAX_WALKTHROUGH_STEPS = 15;

function nameMap(arch: WalkthroughArch): Map<string, string> {
  const names = new Map<string, string>();
  for (const n of arch.nodes) {
    const def = resolveServiceDef(n.serviceId, n as never);
    names.set(n.nodeId, n.displayName || def.name);
  }
  return names;
}

/**
 * LLM-readable facts with stable node ids — the walkthrough prompt requires
 * each step to cite ids verbatim, which is what lets the client render the
 * exact diagram portion a step talks about (and lets sanitize catch invention).
 */
export function walkthroughFacts(arch: WalkthroughArch): string {
  const names = nameMap(arch);
  const services = arch.nodes.map((n) => {
    const def = resolveServiceDef(n.serviceId, n as never);
    const config = Object.entries(n.config ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `- id=${n.nodeId} "${names.get(n.nodeId)}" (${def.category}${config ? `, config: ${config}` : ''})`;
  });
  const connections = arch.edges.map(
    (e) => `- ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ''}`
  );
  return [
    `SERVICES (${arch.nodes.length}) — refer to services ONLY by these ids:`,
    ...services,
    `\nCONNECTIONS (${arch.edges.length}, by id):`,
    ...connections,
  ].join('\n');
}

/**
 * Validate an LLM walkthrough against the real diagram: unknown node ids are
 * dropped (never rendered as if they existed), steps left with no valid nodes
 * or no explanation are removed, and the step count is capped. Returns null
 * when nothing survives — the caller falls back to the degraded walkthrough
 * rather than shipping a report whose sections point nowhere.
 */
export function sanitizeWalkthrough(
  out: { introduction?: unknown; steps?: unknown; conclusion?: unknown },
  arch: WalkthroughArch
): Pick<WalkthroughReport, 'introduction' | 'steps' | 'conclusion'> | null {
  const valid = new Set(arch.nodes.map((n) => n.nodeId));
  const steps: WalkthroughStep[] = [];
  for (const raw of Array.isArray(out.steps) ? out.steps : []) {
    if (steps.length >= MAX_WALKTHROUGH_STEPS) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const explanation = typeof r.explanation === 'string' ? r.explanation.trim() : '';
    const nodeIds = Array.isArray(r.nodeIds)
      ? [...new Set(r.nodeIds.filter((id): id is string => typeof id === 'string' && valid.has(id)))]
      : [];
    if (!title || !explanation || nodeIds.length === 0) continue;
    steps.push({ title, explanation, nodeIds });
  }
  if (steps.length === 0) return null;
  return {
    introduction: typeof out.introduction === 'string' ? out.introduction.trim() : '',
    steps,
    conclusion: typeof out.conclusion === 'string' ? out.conclusion.trim() : '',
  };
}

/** BFS depth per node from the graph's entry points (in-degree 0). */
function flowDepths(arch: WalkthroughArch): Map<string, number> {
  const ids = new Set(arch.nodes.map((n) => n.nodeId));
  const inDeg = new Map<string, number>(arch.nodes.map((n) => [n.nodeId, 0]));
  for (const e of arch.edges) {
    if (inDeg.has(e.target)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const connected = new Set(arch.edges.flatMap((e) => [e.source, e.target]));
  let queue = arch.nodes
    .filter((n) => connected.has(n.nodeId) && (inDeg.get(n.nodeId) ?? 0) === 0)
    .map((n) => n.nodeId);
  // Pure cycle (no entry point): start from the first edge's source.
  if (queue.length === 0 && arch.edges.length > 0 && ids.has(arch.edges[0].source)) {
    queue = [arch.edges[0].source];
  }
  const depth = new Map<string, number>();
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const e of arch.edges) {
      if (e.source !== id || depth.has(e.target)) continue;
      depth.set(e.target, d + 1);
      queue.push(e.target);
    }
  }
  return depth;
}

function listNames(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names[0]} and ${names.length - 1} more`;
}

/**
 * No-LLM fallback: an honest walkthrough derived from the diagram alone. Edges
 * are grouped into stages by BFS depth of their source — "everything the entry
 * layer talks to" is one step, then the next layer, and so on — which mirrors
 * how a person narrates a request moving through the system. Services with no
 * drawn connection get a final "supporting services" step so every node still
 * appears in the report.
 */
export function degradedWalkthrough(arch: WalkthroughArch): WalkthroughReport {
  const names = nameMap(arch);
  const nameOf = (id: string) => names.get(id) ?? id;
  const valid = new Set(arch.nodes.map((n) => n.nodeId));
  const depth = flowDepths(arch);

  const realEdges = arch.edges.filter((e) => valid.has(e.source) && valid.has(e.target));
  const byDepth = new Map<number, typeof realEdges>();
  for (const e of realEdges) {
    const d = depth.get(e.source) ?? 99;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(e);
  }
  const steps: WalkthroughStep[] = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, edges]) => ({
      title: `${listNames([...new Set(edges.map((e) => nameOf(e.source)))])} → ${listNames([...new Set(edges.map((e) => nameOf(e.target)))])}`,
      explanation: edges
        .map((e) => `${nameOf(e.source)} connects to ${nameOf(e.target)}${e.label ? ` (${e.label})` : ''}.`)
        .join(' '),
      nodeIds: [...new Set(edges.flatMap((e) => [e.source, e.target]))],
    }));

  const connected = new Set(realEdges.flatMap((e) => [e.source, e.target]));
  const isolated = arch.nodes.filter((n) => !connected.has(n.nodeId));
  if (isolated.length > 0) {
    steps.push({
      title: steps.length > 0 ? 'Supporting services' : 'Services in this solution',
      explanation:
        steps.length > 0
          ? `These services support the solution without a drawn connection: ${isolated.map((n) => nameOf(n.nodeId)).join(', ')}.`
          : `This solution includes: ${isolated.map((n) => nameOf(n.nodeId)).join(', ')}. Draw connections between services (or let the AI generate them) to see the flow narrated step by step.`,
      nodeIds: isolated.map((n) => n.nodeId),
    });
  }

  return {
    introduction: `AI narration is unavailable — this walkthrough is derived directly from the diagram: ${arch.nodes.length} services with ${arch.edges.length} connections, presented in the order a request flows through them.`,
    steps,
    conclusion: '',
    degraded: true,
    generatedAt: new Date().toISOString(),
  };
}
