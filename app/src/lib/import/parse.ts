import { serviceById, providerFromSlug } from '@/lib/catalog';
import type { ArchDocument, DocNode, DocEdge, DocContainer, DocAnnotation } from '@/lib/canvas/model';

/**
 * Diagram import (007 roadmap 1.2): parse pasted/uploaded content into an
 * ArchDocument the canvas can load.
 *
 * - Studio JSON (`cloud-architecture-studio/v1`, our own export) round-trips
 *   with full fidelity — containers, annotations, positions, configs.
 * - Mermaid flowchart/graph — the de-facto interchange format for
 *   AI-generated diagrams — imports deterministically (no LLM): subgraphs
 *   become group containers, node labels map onto the generic system-design
 *   catalog by keyword (a label matching a real catalog serviceId, e.g. our
 *   own Mermaid export, keeps that exact service). Mermaid carries no
 *   geometry, so imported nodes get grid positions and the caller runs
 *   auto-arrange.
 *
 * Pure module — unit-testable; throws Error with a user-facing message on
 * unparseable input, and reports non-fatal `warnings` (dropped edges etc.).
 */

export type ImportFormat = 'json' | 'mermaid';

export interface ImportResult {
  doc: ArchDocument;
  format: ImportFormat;
  warnings: string[];
}

export function detectImportFormat(text: string): ImportFormat | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) return 'json';
  const body = stripFrontmatter(t);
  if (/^\s*(flowchart|graph)\s+/m.test(body)) return 'mermaid';
  return null;
}

export function parseImport(text: string): ImportResult {
  const format = detectImportFormat(text);
  if (format === 'json') return parseStudioJson(text);
  if (format === 'mermaid') return parseMermaid(text);
  throw new Error(
    'Unrecognized format. Paste a studio JSON export or a Mermaid flowchart (starting with "flowchart" or "graph").'
  );
}

// ---- Studio JSON (round-trip of lib/export/serialize.ts toJsonDocument) --------

const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const asNum = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function asPosition(v: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  const p = asObj(v);
  return { x: asNum(p.x, fallback.x), y: asNum(p.y, fallback.y) };
}

function gridPosition(i: number): { x: number; y: number } {
  return { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 150 };
}

export function parseStudioJson(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not valid JSON — check the file and try again.');
  }
  const doc = asObj(raw);
  const looksLikeStudio = doc.format === 'cloud-architecture-studio/v1' || (Array.isArray(doc.nodes) && Array.isArray(doc.edges));
  if (!looksLikeStudio) {
    throw new Error('This JSON is not a studio export — expected a "cloud-architecture-studio/v1" document with nodes and edges.');
  }
  const warnings: string[] = [];

  const containers: DocContainer[] = asArray(doc.containers).flatMap((item, i) => {
    const c = asObj(item);
    const containerId = asStr(c.containerId);
    if (!containerId) return [];
    const size = asObj(c.size);
    return [{
      containerId,
      type: asStr(c.type) ?? 'group',
      label: asStr(c.label) ?? '',
      position: asPosition(c.position, { x: 60 + i * 40, y: 60 + i * 40 }),
      size: { width: asNum(size.width, 480), height: asNum(size.height, 360) },
      parentContainerId: asStr(c.parentContainerId) ?? null,
    }];
  });
  const containerIds = new Set(containers.map((c) => c.containerId));
  for (const c of containers) {
    if (c.parentContainerId && !containerIds.has(c.parentContainerId)) {
      warnings.push(`Container "${c.label || c.containerId}" referenced a missing parent — moved to top level.`);
      c.parentContainerId = null;
    }
  }

  const nodes: DocNode[] = asArray(doc.nodes).flatMap((item, i) => {
    const n = asObj(item);
    const nodeId = asStr(n.nodeId);
    const serviceId = asStr(n.serviceId);
    if (!nodeId || !serviceId) {
      warnings.push(`Skipped a node missing nodeId/serviceId (entry ${i + 1}).`);
      return [];
    }
    const declaredProvider = asStr(n.provider);
    const provider =
      declaredProvider === 'aws' || declaredProvider === 'mongodb' || declaredProvider === 'system'
        ? declaredProvider
        : (serviceById(serviceId)?.provider ?? providerFromSlug(serviceId) ?? 'system');
    const containerId = asStr(n.containerId);
    if (containerId && !containerIds.has(containerId)) {
      warnings.push(`"${asStr(n.displayName) ?? serviceId}" referenced a missing container — placed at top level.`);
    }
    const config: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(asObj(n.config))) {
      if (typeof v === 'string' || typeof v === 'number') config[k] = v;
    }
    return [{
      nodeId,
      serviceId,
      provider,
      category: asStr(n.category),
      position: asPosition(n.position, gridPosition(i)),
      config,
      cost: asNum(n.cost, 0),
      costBasis: 'indicative' as const,
      displayName: asStr(n.displayName),
      containerId: containerId && containerIds.has(containerId) ? containerId : null,
    }];
  });
  const nodeIds = new Set(nodes.map((n) => n.nodeId));

  let dropped = 0;
  const edges: DocEdge[] = asArray(doc.edges).flatMap((item, i) => {
    const e = asObj(item);
    const source = asStr(e.source);
    const target = asStr(e.target);
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      dropped++;
      return [];
    }
    return [{
      edgeId: asStr(e.edgeId) ?? `imp-e${i + 1}`,
      source,
      target,
      ...(asStr(e.label) ? { label: asStr(e.label) } : {}),
    }];
  });
  if (dropped > 0) warnings.push(`Dropped ${dropped} connection(s) whose endpoints were missing.`);

  const annotations: DocAnnotation[] = asArray(doc.annotations).flatMap((item, i) => {
    const a = asObj(item);
    const content = typeof a.content === 'string' ? a.content : '';
    const annotationId = asStr(a.annotationId) ?? `imp-a${i + 1}`;
    const size = asObj(a.size);
    const style = asObj(a.style);
    const kind = a.kind === 'sticky' ? ('sticky' as const) : ('text' as const);
    const color = asStr(style.color);
    return [{
      annotationId,
      kind,
      content,
      position: asPosition(a.position, gridPosition(i)),
      size: { width: asNum(size.width, 200), height: asNum(size.height, 120) },
      ...(color && ['default', 'yellow', 'blue', 'green', 'pink'].includes(color)
        ? { style: { color: color as NonNullable<DocAnnotation['style']>['color'] } }
        : {}),
    }];
  });

  if (nodes.length === 0 && containers.length === 0 && annotations.length === 0) {
    throw new Error('The document contains no importable elements.');
  }
  return { doc: { nodes, edges, containers, annotations }, format: 'json', warnings };
}

// ---- Mermaid flowchart/graph ---------------------------------------------------

/** keyword → generic system-design serviceId (checked in order; first hit wins) */
const KEYWORD_SERVICES: [RegExp, string][] = [
  // NoSQL before relational: "mongo db" must not fall into the generic db bucket.
  [/\b(mongo(?:db)?|dynamo(?:db)?|cassandra|nosql|documentdb|cosmos)\b/, 'sys-nosql-db'],
  [/\b(postgres(?:ql)?|mysql|mariadb|sqlite|sql|relational|rds|aurora|db|database)\b/, 'sys-relational-db'],
  [/\b(redis|memcached|cache)\b/, 'sys-cache'],
  [/\b(kafka|kinesis|stream)\b/, 'sys-stream-processor'],
  [/\b(sqs|rabbit|queue)\b/, 'sys-message-queue'],
  [/\b(sns|pubsub|pub\/sub|topic)\b/, 'sys-pub-sub'],
  [/\b(cdn|cloudfront|fastly|akamai)\b/, 'sys-cdn'],
  [/\b(dns|route ?53)\b/, 'sys-dns'],
  [/\b(load ?balancer|alb|elb|nginx|haproxy|lb)\b/, 'sys-load-balancer'],
  [/\b(api ?gateway|gateway)\b/, 'sys-api-gateway'],
  [/\b(rate ?limit)/, 'sys-rate-limiter'],
  [/\b(waf|firewall)\b/, 'sys-firewall'],
  [/\b(auth|identity|login|sso|oauth|cognito)\b/, 'sys-auth'],
  [/\b(s3|blob|bucket|object storage|storage)\b/, 'sys-blob-storage'],
  [/\b(elasticsearch|opensearch|search)\b/, 'sys-search'],
  [/\b(warehouse|redshift|bigquery|snowflake|analytics)\b/, 'sys-warehouse'],
  [/\b(monitor|logging|metrics|observability|grafana)\b/, 'sys-monitoring'],
  [/\b(websocket|socket)\b/, 'sys-websocket'],
  [/\b(lambda|serverless|function)\b/, 'sys-function'],
  [/\b(worker|job|consumer)\b/, 'sys-worker'],
  [/\b(cron|scheduler|schedule)\b/, 'sys-scheduler'],
  [/\b(ml|model|inference|sagemaker)\b/, 'sys-ml-inference'],
  [/\b(third[- ]party|external|stripe|twilio|payment)\b/, 'sys-external-api'],
  [/\b(user|actor|customer|person)\b/, 'sys-user'],
  [/\b(browser|web ?app|frontend|spa|website|web)\b/, 'sys-web-client'],
  [/\b(mobile|ios|android)\b/, 'sys-mobile-client'],
];

/** Map a Mermaid node label/id onto a service: exact catalog id wins, then keywords, then generic service. */
export function mapLabelToService(label: string, mermaidId: string): { serviceId: string; provider: 'aws' | 'mongodb' | 'system' } {
  // Our own Mermaid export writes the serviceId as the label and the nodeId as
  // the mermaid id — an exact catalog match round-trips to the real service.
  for (const candidate of [label, mermaidId]) {
    const hit = serviceById(candidate.trim());
    if (hit) return { serviceId: hit.id, provider: hit.provider };
  }
  const haystack = `${label} ${mermaidId}`.toLowerCase();
  for (const [pattern, serviceId] of KEYWORD_SERVICES) {
    if (pattern.test(haystack)) return { serviceId, provider: 'system' };
  }
  return { serviceId: 'sys-service', provider: 'system' };
}

function stripFrontmatter(text: string): string {
  return text.replace(/^\s*---[\s\S]*?---\s*/m, '');
}

/** strip mermaid quoting + our export's cost suffix ("Lambda<br/>$12.00/mo") */
function cleanLabel(raw: string): string {
  return raw
    .replace(/<br\s*\/?>.*$/i, '')
    .replace(/#quot;/g, '"')
    .replace(/^"+|"+$/g, '')
    .trim();
}

const NODE_DEF = /^([A-Za-z0-9_.-]+)\s*(\[\[|\[\(|\(\(|\[|\(|\{\{|\{|>)\s*("?)([\s\S]*?)\3\s*(\]\]|\)\]|\)\)|\]|\)|\}\}|\}|\])?$/;

function parseNodeToken(token: string): { id: string; label: string | null } | null {
  const t = token.trim();
  if (!t) return null;
  const m = NODE_DEF.exec(t);
  if (m && m[2]) return { id: m[1], label: cleanLabel(m[4]) };
  if (/^[A-Za-z0-9_.-]+$/.test(t)) return { id: t, label: null };
  return null;
}

export function parseMermaid(text: string): ImportResult {
  const warnings: string[] = [];
  const body = stripFrontmatter(text.trim());
  const lines = body
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean);

  interface PendingNode {
    id: string;
    label: string | null;
    containerId: string | null;
  }
  const nodesById = new Map<string, PendingNode>();
  const containers: DocContainer[] = [];
  const edges: { source: string; target: string; label?: string }[] = [];
  const containerStack: string[] = [];
  let sawHeader = false;
  let containerSeq = 0;

  const upsertNode = (id: string, label: string | null) => {
    const existing = nodesById.get(id);
    if (existing) {
      if (label && !existing.label) existing.label = label;
      return;
    }
    nodesById.set(id, { id, label, containerId: containerStack[containerStack.length - 1] ?? null });
  };

  for (const line of lines) {
    if (/^(flowchart|graph)\s+/.test(line)) {
      sawHeader = true;
      continue;
    }
    if (/^direction\s+/i.test(line)) continue;
    if (/^(classDef|class|style|linkStyle|click)\b/.test(line)) continue;

    const sub = /^subgraph\s+(.+)$/.exec(line);
    if (sub) {
      const token = parseNodeToken(sub[1]) ?? { id: `sg${++containerSeq}`, label: cleanLabel(sub[1]) };
      const containerId = `imp-c-${token.id}`;
      containers.push({
        containerId,
        type: 'group',
        label: token.label || token.id,
        position: { x: 0, y: 0 },
        size: { width: 480, height: 360 },
        parentContainerId: containerStack[containerStack.length - 1] ?? null,
      });
      containerStack.push(containerId);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (containerStack.length > 0) containerStack.pop();
      continue;
    }

    // Edge lines: split on arrow tokens, supporting chained a --> b --> c and
    // labels as -->|label| or --&gt;|"label"|.
    const arrowSplit = line.split(/\s*(?:-{2,3}>|-{3}|-\.->|={2,3}>|-{2,3})\s*/);
    if (arrowSplit.length > 1 && /-|=/.test(line)) {
      const labelMatches = [...line.matchAll(/\|\s*"?([^|"]+)"?\s*\|/g)].map((m) => cleanLabel(m[1]));
      let labelIdx = 0;
      let prev: string | null = null;
      let valid = true;
      for (const segment of arrowSplit) {
        const cleaned = segment.replace(/^\|[^|]*\|\s*/, '').trim();
        const token = parseNodeToken(cleaned);
        if (!token) {
          valid = false;
          break;
        }
        upsertNode(token.id, token.label);
        if (prev) {
          const label = labelIdx < labelMatches.length ? labelMatches[labelIdx++] : undefined;
          edges.push({ source: prev, target: token.id, ...(label ? { label } : {}) });
        }
        prev = token.id;
      }
      if (valid) continue;
    }

    // Standalone node definition.
    const token = parseNodeToken(line.replace(/;$/, ''));
    if (token) {
      upsertNode(token.id, token.label);
      continue;
    }
    warnings.push(`Skipped a line I could not parse: "${line.slice(0, 60)}"`);
  }

  if (!sawHeader) throw new Error('Not a Mermaid flowchart — the text must start with "flowchart" or "graph".');
  if (nodesById.size === 0) throw new Error('No nodes found in the Mermaid diagram.');

  const docNodes: DocNode[] = [...nodesById.values()].map((n, i) => {
    const label = n.label ?? n.id;
    const mapped = mapLabelToService(label, n.id);
    const curated = serviceById(mapped.serviceId);
    // Keep the author's label when it isn't just the catalog name repeated.
    const displayName = curated && label.trim().toLowerCase() === curated.name.toLowerCase() ? undefined : label;
    return {
      nodeId: `imp-${n.id}`,
      serviceId: mapped.serviceId,
      provider: mapped.provider,
      category: curated?.category,
      position: gridPosition(i),
      config: {},
      cost: 0,
      costBasis: 'indicative' as const,
      ...(displayName ? { displayName } : {}),
      containerId: n.containerId,
    };
  });
  const docEdges: DocEdge[] = edges.map((e, i) => ({
    edgeId: `imp-e${i + 1}`,
    source: `imp-${e.source}`,
    target: `imp-${e.target}`,
    ...(e.label ? { label: e.label } : {}),
  }));

  return { doc: { nodes: docNodes, edges: docEdges, containers, annotations: [] }, format: 'mermaid', warnings };
}
