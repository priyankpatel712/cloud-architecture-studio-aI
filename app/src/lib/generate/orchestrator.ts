import 'server-only';
import { getProvider, allContainerTypes } from '@/lib/providers/registry';
import { McpUnavailableError, type ProviderId, type ServiceConfig } from '@/lib/providers/types';
import { llmAvailable, llmJson } from '@/lib/llm';
import { priceNodes } from '@/lib/pricing';
import { summarizeArchitectureEdit } from '@/lib/generate/diff';
import { patternGrounding } from '@/lib/generate/reference-patterns';
import { matchPatternsWithStore } from '@/lib/knowledge/patterns';
import { cacheKeys } from '@/lib/generate/guidance-cache';
import { clampToFieldBounds, defaultConfig, providerFromSlug, resolveServiceDef, serviceById } from '@/lib/catalog';
import { layoutWithElk, type LayoutEdge, type LayoutNode } from '@/lib/canvas/layout';
import { CHUNK_SIZE, CHUNK_RENDER_DELAY_MS, sleep } from '@/lib/generate/loop-config';
import { awsPlacementExamples, pruneEmptyContainers } from '@/lib/generate/topology';

/**
 * Chat orchestrator (001 FR-014a–d, FR-015; research R11; contracts/generation.md;
 * extended by feature 002 for container authority — R8, FR-007).
 *
 * One turn: receives the user's message plus the conversation's sticky attached
 * tools, invokes ONLY the attached providers' official MCP adapters, has the LLM
 * turn the request + MCP guidance into concrete edits, applies them to the CURRENT
 * architecture in place (preserve-user-work: untouched nodes/containers keep their
 * positions, configs, memberships, and connections — Clarification 2026-07-06),
 * prices the result via the official pricing chain, and reports per-provider MCP
 * failures distinctly.
 *
 * Cost-neutrality guard (002 FR-014/017): containers/annotations are never sent to
 * `mcp.recommend()` or `priceNodes()` below — only plain node/edge text context and
 * service nodes reach those calls. Annotations are never edited by the AI (only
 * containers have AI authority, per Clarification); they pass through unchanged.
 *
 * Degraded mode (spec Assumptions): when the official MCPs and/or LLM are not
 * configured, results are produced from the catalog and clearly labelled
 * indicative — never presented as exact, never a silent guess.
 *
 * 004 (research R2, data-model.md): the backbone phases below — gather, draft
 * (plan+apply), layout, price — are exported individually so the agentic loop
 * (agent-loop.ts) can re-invoke draft/layout/price alone on each refine pass
 * without repeating the MCP gather. `orchestrateChatTurn` composes them exactly
 * as before for callers (and tests) that just want one backbone pass.
 */

export interface ArchNode {
  nodeId: string;
  serviceId: string;
  provider: ProviderId;
  category: string;
  position: { x: number; y: number };
  config: ServiceConfig;
  cost: number;
  costBasis: 'exact' | 'indicative';
  displayName?: string;
  containerId?: string | null;
}
export interface ArchEdge {
  edgeId: string;
  source: string;
  target: string;
  /**
   * Connection sides ('top' | 'right' | 'bottom' | 'left'). The planner never
   * emits these — geometry is not the model's job. They are assigned after
   * layout by lib/generate/edge-sides.ts, and only when absent, so a side a
   * user pinned on the canvas survives every subsequent AI turn.
   */
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}
export interface ArchContainer {
  containerId: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  parentContainerId?: string | null;
}
export interface ArchAnnotation {
  annotationId: string;
  kind: 'text' | 'sticky';
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  style?: { color?: string };
}
export interface Guidance {
  network?: string;
  security?: string;
  ha?: string;
  dr?: string;
  scaling?: string;
}

/** Live progress event for the chat UI (003 follow-up: AI-IDE-style step list). */
export type ProgressStatus = 'running' | 'done' | 'failed';
export type OnProgress = (id: string, label: string, status: ProgressStatus) => void;

export interface TurnInput {
  text: string;
  activeTools: ProviderId[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
  defaultRegion: string;
  /** optional live progress reporter — streamed to the chat client */
  onProgress?: OnProgress;
}

export interface TurnResult {
  reply: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
  editsApplied: string[];
  mcpCalls: { provider: ProviderId; tool: string; status: 'ok' | 'failed' }[];
  /** produced without the official sources — clearly labelled (FR-021) */
  indicative: boolean;
  changed: boolean;
  /** request cannot be fulfilled (unsupported provider, contradiction) — route returns 422 */
  unsatisfiable: boolean;
  /**
   * nodeId per plan.add entry (003): the created node's id, the merged-into
   * node's id (attach-dedup, FR-005), or null for a skipped add. Lets the cost
   * phase resolve new:<index> refs from the same turn (contracts/cost-overrides.md).
   */
  addRefIds: (string | null)[];
}

interface Plan {
  reply: string;
  /** 005 FR-001/004 — true if another chunk-planning round is needed after this one. */
  moreNeeded: boolean;
  /** 005 research R5 — short summary of this chunk's contents, shown as the trace step's detail. */
  chunkLabel?: string;
  add: {
    serviceId: string;
    config?: Record<string, string>;
    containerRef?: string;
    /** dynamic services (no catalog entry): official name, category, indicative monthly USD */
    name?: string;
    category?: string;
    monthlyCostUsd?: number;
  }[];
  remove: string[];
  update: { nodeId: string; config: Record<string, string> }[];
  edges: { source: string; target: string; label?: string }[];
  guidance?: Guidance;
  unsatisfiable?: boolean;
  containers?: {
    add: { type: string; label?: string; parentRef?: string }[];
    update: { containerId: string; label?: string; type?: string; parentRef?: string | null }[];
    remove: string[];
    assignMembers: { nodeId: string; containerRef: string | null }[];
  };
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'add', 'remove', 'update', 'edges', 'moreNeeded'],
  properties: {
    reply: { type: 'string', description: 'Conversational reply to the user summarizing what changed and why.' },
    moreNeeded: {
      type: 'boolean',
      description:
        'true if this request needs another planning round after this one (you planned at most the chunk limit of new services/containers this round); false if this round fully completes the request.',
    },
    chunkLabel: {
      type: 'string',
      description: 'Short label summarizing what this round adds, e.g. "Adding compute and networking" — shown in the live progress trace.',
    },
    add: {
      type: 'array',
      description: 'New services to place. Reference them in edges as new:<index>.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceId'],
        properties: {
          serviceId: { type: 'string', description: 'catalog serviceId, or a new slug like "aws-route53" for a real provider service not in the catalog' },
          config: { type: 'object', additionalProperties: { type: 'string' } },
          containerRef: { type: 'string', description: 'existing containerId or newContainer:<index> to place this service inside' },
          name: { type: 'string', description: 'REQUIRED for non-catalog services: the official service name, e.g. "Route 53"' },
          category: { type: 'string', description: 'for non-catalog services: Compute|Containers|Networking|Database|Storage|Security|App Integration|Analytics|IoT|Machine Learning|Management' },
          monthlyCostUsd: { type: 'number', description: 'for non-catalog services: your best indicative monthly USD estimate at the requested scale, grounded in the official MCP guidance' },
        },
      },
    },
    remove: { type: 'array', items: { type: 'string' }, description: 'nodeIds to remove — only when the request requires it.' },
    containers: {
      type: 'object',
      additionalProperties: false,
      description:
        'Typed boundary container operations (region/vpc/subnet/az/cluster/group). You have full authority to create and restructure these.',
      properties: {
        add: {
          type: 'array',
          description: 'New containers. Reference an earlier add by index as newContainer:<index> for nesting.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { type: 'string', description: 'exact container type id from the list below, or "group"' },
              label: { type: 'string' },
              parentRef: { type: 'string', description: 'existing containerId or newContainer:<index>, omit for root' },
            },
          },
        },
        update: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['containerId'],
            properties: {
              containerId: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string' },
              parentRef: { type: 'string', description: 'existing containerId, newContainer:<index>, or omit to leave unchanged' },
            },
          },
        },
        remove: { type: 'array', items: { type: 'string' }, description: 'containerIds to remove; members are kept and re-parented up' },
        assignMembers: {
          type: 'array',
          description: 'Move existing service nodes into (or out of) a container.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nodeId', 'containerRef'],
            properties: {
              nodeId: { type: 'string' },
              containerRef: { type: ['string', 'null'], description: 'containerId, newContainer:<index>, or null for canvas root' },
            },
          },
        },
      },
    },
    update: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'config'],
        properties: {
          nodeId: { type: 'string' },
          config: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'target'],
        properties: {
          source: { type: 'string', description: 'existing nodeId or new:<index>' },
          target: { type: 'string', description: 'existing nodeId or new:<index>' },
          label: { type: 'string' },
        },
      },
    },
    guidance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        network: { type: 'string' },
        security: { type: 'string' },
        ha: { type: 'string' },
        dr: { type: 'string' },
        scaling: { type: 'string' },
      },
    },
    unsatisfiable: {
      type: 'boolean',
      description:
        'true ONLY when NOTHING can be built at all (the request targets a provider that is not attached, or is self-contradictory). A request mentioning services missing from the catalog is NOT unsatisfiable — build the closest achievable design from the catalog and explain substitutions in reply.',
    },
  },
} as const;

// ---- Plan sanitization -------------------------------------------------------
// NVIDIA's guided_json is NOT reliably enforced for reasoning models (observed
// live: malformed JSON straight through the "guaranteed" decode path). The plan
// must therefore be treated as untrusted input: coerce what's coercible, drop
// what isn't, and never let a stray number/object where a string was promised
// throw a TypeError halfway through apply (the "Generation failed unexpectedly"
// crash at step apply).

const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
const asNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Keep only primitive config values, stringified (schema promises strings). */
const asConfig = (v: unknown): Record<string, string> | undefined => {
  const src = asObj(v);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(src)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Coerce an untrusted LLM plan into the Plan shape apply can safely execute. */
export function sanitizePlan(raw: unknown): Plan {
  const p = asObj(raw);
  const c = asObj(p.containers);
  const g = asObj(p.guidance);
  const guidance: Guidance = {};
  for (const key of ['network', 'security', 'ha', 'dr', 'scaling'] as const) {
    const v = asStr(g[key]);
    if (v) guidance[key] = v;
  }
  return {
    reply: asStr(p.reply) || 'Done — see the updated diagram and estimate.',
    moreNeeded: p.moreNeeded === true,
    chunkLabel: asStr(p.chunkLabel),
    add: asArray(p.add).flatMap((item) => {
      const a = asObj(item);
      const serviceId = asStr(a.serviceId);
      if (!serviceId) return [];
      return [{
        serviceId,
        config: asConfig(a.config),
        containerRef: asStr(a.containerRef),
        name: asStr(a.name),
        category: asStr(a.category),
        monthlyCostUsd: asNum(a.monthlyCostUsd),
      }];
    }),
    remove: asArray(p.remove).flatMap((r) => asStr(r) ?? []),
    update: asArray(p.update).flatMap((item) => {
      const u = asObj(item);
      const nodeId = asStr(u.nodeId);
      const config = asConfig(u.config);
      return nodeId && config ? [{ nodeId, config }] : [];
    }),
    edges: asArray(p.edges).flatMap((item) => {
      const e = asObj(item);
      const source = asStr(e.source ?? e.from);
      const target = asStr(e.target ?? e.to);
      if (!source || !target) return [];
      const label = asStr(e.label);
      return [{ source, target, ...(label ? { label } : {}) }];
    }),
    guidance,
    unsatisfiable: p.unsatisfiable === true,
    containers: {
      add: asArray(c.add).flatMap((item) => {
        const a = asObj(item);
        const type = asStr(a.type);
        if (!type) return [];
        return [{ type, label: asStr(a.label), parentRef: asStr(a.parentRef) }];
      }),
      update: asArray(c.update).flatMap((item) => {
        const u = asObj(item);
        const containerId = asStr(u.containerId);
        if (!containerId) return [];
        return [{
          containerId,
          label: asStr(u.label),
          type: asStr(u.type),
          // null means "re-root"; undefined means "leave unchanged" — preserve both.
          parentRef: u.parentRef === null ? null : asStr(u.parentRef),
        }];
      }),
      remove: asArray(c.remove).flatMap((r) => asStr(r) ?? []),
      assignMembers: asArray(c.assignMembers).flatMap((item) => {
        const a = asObj(item);
        const nodeId = asStr(a.nodeId);
        if (!nodeId) return [];
        return [{ nodeId, containerRef: a.containerRef === null ? null : (asStr(a.containerRef) ?? null) }];
      }),
    },
  };
}

/**
 * Cost realism (Clarification 2026-07-09): a field's `unit` MUST reach the model,
 * not just its key — `unit: 'M'` fields are ALREADY denominated in millions/mo, and
 * without this the model has filled them with a raw request count (e.g. 1000000
 * instead of 1), inflating the indicative estimate by ~1e6x.
 */
function fieldPrompt(f: { key: string; unit?: string; default: string | number }): string {
  if (f.unit === 'M') return `${f.key} [millions/mo, e.g. 0.01 = 10,000/mo — NOT the raw count; default ${f.default}]`;
  return f.unit ? `${f.key} [${f.unit}, default ${f.default}]` : `${f.key} [default ${f.default}]`;
}

/** Exported for the 006 analyze phase — candidate service sets are grounded in the same catalog listing the planner sees. */
export function catalogPrompt(tools: ProviderId[]): string {
  return tools
    .map((id) => {
      const plugin = getProvider(id);
      const services = plugin.catalog
        .map((s) => `  - ${s.id} (${s.name}, ${s.category}): ${s.fields.map(fieldPrompt).join(', ')}`)
        .join('\n');
      return `${plugin.label} services:\n${services}`;
    })
    .join('\n');
}

function containerTypePrompt(activeTools: ProviderId[]): string {
  const types = allContainerTypes()
    .filter((t) => activeTools.includes(t.provider))
    .map((t) => `  - ${t.id} (${t.label}, ${t.provider})`)
    .join('\n');
  const lines = [`Container types:\n  - group (generic, any provider)\n${types}`];

  if (activeTools.includes('aws')) {
    const { vpc: vpcServices, edge: edgeServices } = awsPlacementExamples();
    lines.push(
      'MANDATORY AWS containment hierarchy (mirrors real AWS topology — not optional decoration):',
      '  cloud > region > vpc > az > subnet.',
      '  - cloud (outer AWS boundary): wrap ALL AWS services in one whenever there are 3+ AWS services',
      '    on the canvas, OR whenever AWS and MongoDB Atlas are both present (visually separates the two',
      '    providers). Skip it only for a trivial 1-2 service AWS-only canvas.',
      '  - region: whenever there are 2+ AWS services, group every non-edge one under a region container',
      '    (nested inside cloud when cloud is used).',
      `  - vpc > az > subnet: services that actually run inside a VPC — ${vpcServices || '(none in catalog)'}`,
      '    — MUST be placed in a vpc container, which MUST be nested inside an az container, which MUST',
      '    be nested inside a subnet container (public subnet for internet-facing load balancers/NAT,',
      '    private subnet for application/data-tier resources). For HA, use two az containers side by',
      '    side inside the same vpc when the request implies high availability or multi-AZ.',
      `  - Edge/global services — ${edgeServices || '(none in catalog)'} — are NEVER placed inside a vpc;`,
      '    they sit at the region or cloud level (edge/CDN/DNS/WAF/certificates operate outside any VPC).',
      '  - Every other AWS service (serverless/managed, e.g. Lambda, API Gateway, S3, DynamoDB, SQS/SNS,',
      '    Cognito, CloudWatch) is region-scoped but NOT VPC-resident — place it under region, not vpc.'
    );
  }
  if (activeTools.includes('mongodb')) {
    lines.push(
      'MANDATORY MongoDB Atlas containment: project > cluster.',
      '  Wrap every Atlas node (cluster, Search, Vector Search, Backup, Data Federation) in a cluster',
      '  container, and wrap that cluster container in an outer project container (an Atlas project maps',
      "  1:1 to the network Atlas peers with the AWS VPC — always show it, even for a single cluster)."
    );
  }
  if (activeTools.includes('aws')) {
    lines.push(
      'HOW TO NEST (this is the part that is easy to get wrong): every container you add EXCEPT the',
      "outermost one MUST set parentRef to newContainer:<index>, where <index> is that PARENT container's",
      "OWN position in THIS SAME containers.add array — a bare {\"type\":\"vpc\"} with no parentRef becomes",
      'a ROOT-LEVEL container, not nested in anything, even if you intended it to sit inside a region.',
      'Worked example JSON for containers.add, creating cloud > region > vpc > az > subnet in one call:',
      '  [',
      '    {"type":"cloud","label":"AWS Cloud"},',
      '    {"type":"region","label":"us-east-1","parentRef":"newContainer:0"},',
      '    {"type":"vpc","label":"VPC","parentRef":"newContainer:1"},',
      '    {"type":"az","label":"us-east-1a","parentRef":"newContainer:2"},',
      '    {"type":"subnet","label":"Private Subnet","parentRef":"newContainer:3"}',
      '  ]',
      '  Then a VPC-resident add (e.g. aws-rds) sets containerRef:"newContainer:4" (the subnet, the LAST',
      '  entry above); a region-scoped-but-not-VPC add (e.g. aws-lambda) sets containerRef:"newContainer:1"',
      '  (the region, skipping past vpc/az/subnet entirely — it does not live inside the VPC).'
    );
  }
  if (activeTools.includes('aws') && activeTools.includes('mongodb')) {
    lines.push(
      'MongoDB Atlas containers are SEPARATE from the AWS cloud container (do not nest project/cluster',
      'inside cloud, or vice versa) — the same "parentRef chains to the previous entry\'s newContainer:',
      '<index>" mechanics above apply: {"type":"project","label":"Atlas Project"} then',
      '{"type":"cluster","label":"Atlas Cluster","parentRef":"newContainer:<project\'s index>"}, and the',
      'atlas-cluster node itself gets containerRef:"newContainer:<cluster\'s index>".'
    );
  }
  if (activeTools.includes('system')) {
    lines.push(
      'Generic system-design containers (provider "system"):',
      '  - system-boundary: wraps the components YOU own; users (sys-user) and external/third-party',
      '    systems (sys-external-api) sit OUTSIDE it (C4 convention). Use one per diagram when there',
      '    are 3+ owned components.',
      '  - tier: horizontal grouping inside the boundary — "Client", "Edge", "Application", "Data"',
      '    tiers for HLD; "Controller layer", "Service layer", "Data layer" for LLD. Only introduce',
      '    tiers when there are 2+ members per tier.',
      '  - package: a code package/module boundary grouping related LLD components.'
    );
  }
  return lines.join('\n');
}

/**
 * Mode-specific planner guidance (dynamic router: cloud | hld | lld). Cloud
 * mode adds nothing — the provider-specific rules above already govern it.
 */
function designModePrompt(mode: 'cloud' | 'hld' | 'lld' | undefined): string[] {
  if (mode === 'hld') {
    return [
      '- DIAGRAM MODE: GENERIC HIGH-LEVEL SYSTEM DESIGN (C4 Level 1/2). Use ONLY the generic',
      '  system-design components (sys-*) — never vendor services. Show deployable containers and',
      '  data stores, not code: clients → edge (DNS/CDN/load balancer/API gateway) → application',
      '  services → data stores, with async paths via queues/pub-sub to workers. Label EVERY edge',
      '  with what flows and how ("REST/HTTPS", "publishes events", "reads/writes"). Set each',
      "  component's tech config field when the request names a technology (e.g. tech: \"Redis\").",
      '  Wrap owned components in a system-boundary container; keep sys-user and sys-external-api',
      '  outside it. Costs do not apply in this mode.',
    ];
  }
  if (mode === 'lld') {
    return [
      '- DIAGRAM MODE: GENERIC LOW-LEVEL DESIGN (C4 Level 3 / component-and-class view). Use ONLY',
      '  the generic Low-Level Design components (sys-module, sys-component, sys-controller,',
      '  sys-endpoint, sys-service-class, sys-repository, sys-entity, sys-dto, sys-interface,',
      '  sys-class, sys-event-handler, sys-db-table, sys-library) — never vendor services and never',
      '  HLD infrastructure unless the request explicitly includes it. Dependencies point inward:',
      '  controller/handler → service class → repository/DAO → DB table; DTOs cross boundaries;',
      '  interfaces where substitution matters. Label edges with the relationship ("calls",',
      '  "implements", "reads/writes", "publishes"). Group components by layer (tier containers:',
      '  "Controller layer", "Service layer", "Data layer") or by package. Costs do not apply.',
    ];
  }
  return [];
}

export function architecturePrompt(nodes: ArchNode[], edges: ArchEdge[], containers: ArchContainer[], annotations: ArchAnnotation[]): string {
  if (nodes.length === 0 && containers.length === 0) return 'The architecture is currently empty.';
  const n =
    nodes
      .map((x) => `  - ${x.nodeId}: ${x.serviceId} config=${JSON.stringify(x.config)}${x.containerId ? ` in=${x.containerId}` : ''}`)
      .join('\n') || '  (none)';
  const e = edges.map((x) => `  - ${x.source} -> ${x.target}`).join('\n') || '  (no connections)';
  const c =
    containers
      .map((x) => `  - ${x.containerId}: ${x.type} "${x.label ?? ''}"${x.parentContainerId ? ` in=${x.parentContainerId}` : ''}`)
      .join('\n') || '  (none)';
  return [
    `Current nodes:\n${n}`,
    `Current connections:\n${e}`,
    `Current containers:\n${c}`,
    annotations.length > 0 ? `The user has ${annotations.length} note(s)/sticky(ies) on the canvas — these are not services, do not touch them.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Rendered service-node footprint (ServiceNode.tsx: 188px card, icon header + cost row). Exported for the 006 finalize pass. */
export const NODE_W = 188;
export const NODE_H = 98;

/**
 * Auto-arrange the generated result with the same ELK layered engine the canvas
 * toolbar uses (left→right flow, container-aware) so AI output reads like a real
 * architecture diagram instead of a grid dump. Positions follow the document
 * convention (container members are parent-relative), which is exactly what ELK
 * child coordinates are. Mutates keptNodes in place; returns the containers
 * (repositioned + resized to wrap their members). Best-effort: on ELK failure the
 * deterministic grid placement stays.
 */
async function autoLayout(keptNodes: ArchNode[], keptEdges: ArchEdge[], keptContainers: ArchContainer[]): Promise<ArchContainer[]> {
  const containerIds = new Set(keptContainers.map((c) => c.containerId));
  const layoutNodes: LayoutNode[] = [
    ...keptNodes.map((n) => ({ id: n.nodeId, width: NODE_W, height: NODE_H, parentId: n.containerId ?? null })),
    ...keptContainers.map((c) => ({ id: c.containerId, width: c.size.width, height: c.size.height, parentId: c.parentContainerId ?? null })),
  ];
  const layoutEdges: LayoutEdge[] = keptEdges.map((e) => ({ id: e.edgeId, source: e.source, target: e.target }));
  const result = await layoutWithElk(layoutNodes, layoutEdges, containerIds);
  for (const n of keptNodes) {
    const p = result.positions.get(n.nodeId);
    if (p) n.position = p;
  }
  return keptContainers.map((c) => {
    const p = result.positions.get(c.containerId);
    const s = result.sizes.get(c.containerId);
    return p || s ? { ...c, position: p ?? c.position, size: s ?? c.size } : c;
  });
}

/** Deterministic placement for new nodes: below the existing design, in rows. */
function placeNewNodes(existing: ArchNode[], count: number): { x: number; y: number }[] {
  const baseY = existing.length ? Math.max(...existing.map((n) => n.position.y)) + 160 : 80;
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({ x: 80 + (i % 4) * 260, y: baseY + Math.floor(i / 4) * 150 });
  }
  return positions;
}

let nodeSeq = 0;
function newNodeId(): string {
  nodeSeq = (nodeSeq + 1) % 1000;
  return `n${Date.now().toString(36)}${nodeSeq}`;
}

/**
 * Attach-duplicate decisions (003 FR-005, research R3), exported for unit tests.
 * A planned add whose service already exists in the kept architecture — and is
 * not separately reconfigured this turn — merges into that node.
 *
 * Dynamic services (follow-up to 003 — the catalog no longer bounds the AI):
 * a serviceId with no catalog entry is still CREATED when the plan supplies an
 * identity (`name`) and its slug maps to an attached provider ('aws-*' /
 * 'atlas-*'). Only identity-less unknown ids and unattached providers skip.
 */
export type AddDecision = { kind: 'skip' } | { kind: 'merge'; nodeId: string } | { kind: 'create' };

export function decideAdds(
  adds: { serviceId: string; config?: Record<string, string>; name?: string }[],
  keptNodes: { nodeId: string; serviceId: string }[],
  updatedIds: Set<string>,
  activeTools: ProviderId[]
): AddDecision[] {
  return adds.map((a) => {
    const def = serviceById(a.serviceId);
    const provider = def?.provider ?? providerFromSlug(a.serviceId);
    if (!provider || !activeTools.includes(provider)) return { kind: 'skip' };
    if (!def && !a.name?.trim()) return { kind: 'skip' };
    const existing = keptNodes.find((n) => n.serviceId === a.serviceId && !updatedIds.has(n.nodeId));
    return existing ? { kind: 'merge', nodeId: existing.nodeId } : { kind: 'create' };
  });
}

/**
 * Apply one merged add onto its existing node (003 FR-005): increment the
 * service's declared quantityField by the requested amount (default 1); a
 * service with no quantity dimension gets the requested config applied in
 * place. Exported for unit tests.
 */
export function applyAddMerge(
  node: { serviceId: string; config: ServiceConfig },
  add: { serviceId: string; config?: Record<string, string> }
): void {
  const toNum = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : fallback;
  };
  const qf = serviceById(node.serviceId)?.quantityField;
  if (qf) {
    const current = Math.max(1, Math.round(toNum(node.config[qf], 1)));
    const increment = Math.max(1, Math.round(toNum(add.config?.[qf], 1)));
    node.config = { ...node.config, [qf]: current + increment };
  } else if (add.config && Object.keys(add.config).length > 0) {
    node.config = clampToFieldBounds(resolveServiceDef(node.serviceId), { ...node.config, ...add.config });
  }
}

/**
 * Defensive code-side slicing backstop (005 research R2): partitions one plan
 * response's `add` entries into ordered groups of at most CHUNK_SIZE, so the
 * progressive build-up (FR-001/002, SC-001) holds even when a single response
 * doesn't comply with the "at most CHUNK_SIZE per round" prompt instruction.
 *
 * `plan.edges` are bucketed into the LATEST group among their new:<index>
 * endpoints (an existing-node endpoint never constrains); this guarantees an
 * edge only ever appears once every node it touches is already applied
 * (FR-003) — never dangling on a not-yet-applied later group.
 *
 * Container operations are intentionally NOT sliced here: they are resolved
 * atomically before any group is applied (draftAndApply), which trivially
 * satisfies FR-003 for containers and keeps the (rare, small-cardinality)
 * container-restructuring logic — cycle guards, ref resolution — untouched by
 * chunking. `update`/`remove` (existing-node operations) attach to the first
 * group for the same reason: they don't depend on anything new:<index>.
 * `currentState` is accepted per the design (research.md §2) though this
 * grouping only needs `plan` itself — kept for callers that may extend it.
 */
export interface ChunkGroup {
  /** indices into plan.add belonging to this group, in original order */
  addIdx: number[];
  /** indices into plan.edges ready once this group's adds are applied */
  edgeIdx: number[];
  /** indices into plan.update — always attached to the first group */
  updateIdx: number[];
  /** indices into plan.remove — always attached to the first group */
  removeIdx: number[];
}

export function sliceIntoChunks(plan: Plan, currentState: { nodes: ArchNode[] }): ChunkGroup[] {
  void currentState; // reserved for future group-aware validation; grouping itself only needs `plan`
  const addCount = plan.add.length;
  const groupCount = addCount > 0 ? Math.ceil(addCount / CHUNK_SIZE) : 1;
  const groups: ChunkGroup[] = Array.from({ length: groupCount }, () => ({ addIdx: [], edgeIdx: [], updateIdx: [], removeIdx: [] }));

  const groupOfAddIdx = (idx: number): number => Math.min(Math.floor(idx / CHUNK_SIZE), groupCount - 1);
  for (let i = 0; i < addCount; i++) groups[groupOfAddIdx(i)].addIdx.push(i);

  const refGroup = (ref: string | undefined): number => {
    if (!ref?.startsWith('new:')) return 0;
    const idx = Number(ref.slice('new:'.length));
    return Number.isInteger(idx) && idx >= 0 && idx < addCount ? groupOfAddIdx(idx) : 0;
  };
  plan.edges.forEach((e, i) => {
    groups[Math.max(refGroup(e.source), refGroup(e.target))].edgeIdx.push(i);
  });

  plan.update.forEach((_, i) => groups[0].updateIdx.push(i));
  plan.remove.forEach((_, i) => groups[0].removeIdx.push(i));

  return groups;
}

/** Labelled-indicative starter plan used when the LLM is not configured. */
function heuristicPlan(currentNodes: ArchNode[], activeTools: ProviderId[]): Plan {
  if (currentNodes.length > 0) {
    return {
      reply:
        'The AI assistant is not fully configured in this environment (no LLM key), so I did not change your existing architecture. Configure LLM_API_KEY to enable conversational edits, or use the canvas directly.',
      moreNeeded: false,
      add: [], remove: [], update: [], edges: [],
      containers: { add: [], update: [], remove: [], assignMembers: [] },
    };
  }
  const add: Plan['add'] = [];
  const edges: Plan['edges'] = [];
  if (activeTools.includes('aws')) {
    add.push({ serviceId: 'aws-cloudfront' }, { serviceId: 'aws-apigw' }, { serviceId: 'aws-lambda' }, { serviceId: 'aws-dynamodb' }, { serviceId: 'aws-s3' });
    edges.push(
      { source: 'new:0', target: 'new:1' },
      { source: 'new:1', target: 'new:2' },
      { source: 'new:2', target: 'new:3' },
      { source: 'new:2', target: 'new:4' }
    );
  }
  if (activeTools.includes('mongodb')) {
    const base = add.length;
    add.push({ serviceId: 'atlas-cluster' });
    const lambdaIdx = add.findIndex((a) => a.serviceId === 'aws-lambda');
    if (lambdaIdx >= 0) edges.push({ source: `new:${lambdaIdx}`, target: `new:${base}` });
  }
  return {
    reply:
      'Here is an indicative starter architecture from the service catalog. Note: the official provider MCPs and LLM are not configured in this environment, so this design and its costs are indicative only — not grounded in the official tools yet.',
    moreNeeded: false,
    add, remove: [], update: [],
    edges,
    guidance: {
      network: 'Indicative: front the API with a CDN and API gateway; keep data services in private networking.',
      security: 'Indicative: least-privilege IAM per function; encrypt data at rest and in transit.',
      ha: 'Indicative: serverless components are multi-AZ by default; verify data-tier replication.',
      dr: 'Indicative: enable point-in-time recovery and cross-region backups for data stores.',
      scaling: 'Indicative: serverless scales per request; watch data-tier connection and throughput limits.',
    },
  };
}

// ---- 004 loop-invocable phases ----------------------------------------------
// Split out of the former monolithic orchestrateChatTurn so the agentic loop
// (agent-loop.ts) can run gather ONCE per turn and re-invoke draft/layout/price
// alone on each refine pass (research R2; plan.md Scale/Scope: refine adds only
// the review+refine calls, not a repeated gather).

export interface GatherResult {
  mcpCalls: TurnResult['mcpCalls'];
  mcpGuidance: string[];
  failed: ProviderId[];
  official: boolean;
}

/**
 * Reusable MCP-guidance cache port (generation-quality improvement). Keyed by
 * provider + the matched curated reference-pattern ids (below), NOT raw
 * request text, so a differently-worded request that lands on the same
 * recognized architecture family reuses the same official guidance instead of
 * re-querying the live MCP server. Dependency-injected and optional so
 * `gatherGuidance` stays byte-identical (and DB-free) for every existing
 * caller/test that omits it — see lib/models/McpGuidanceCache.ts for the
 * persisted shape.
 */
export interface GuidanceCachePort {
  get(provider: ProviderId, patternIds: string[]): Promise<{ guidanceText: string; toolsInvoked: string[] } | null>;
  set(provider: ProviderId, patternIds: string[], guidanceText: string, toolsInvoked: string[]): Promise<void>;
}

/** Ground in the official MCPs — only the attached providers (001 FR-014b/c, FR-015). */
export async function gatherGuidance(
  text: string,
  activeTools: ProviderId[],
  current: { nodes: ArchNode[]; edges: ArchEdge[]; containers: ArchContainer[]; annotations: ArchAnnotation[] },
  progress: OnProgress,
  cache?: GuidanceCachePort,
  /** 008 FR-023 — capability keywords, used as the cache key when no curated
   * reference pattern matched so unmatched requests are cacheable too. */
  requirements?: string[]
): Promise<GatherResult> {
  const context = architecturePrompt(current.nodes, current.edges, current.containers, current.annotations);
  const mcpCalls: TurnResult['mcpCalls'] = [];
  const mcpGuidance: string[] = [];
  const failed: ProviderId[] = [];

  // Hoisted above the provider loop (was computed after it) so the matched
  // pattern ids are available as the cache key before any MCP call is made.
  // 008 T079 — store-backed: once seeded, the knowledge store owns the pattern
  // set (editable/disableable in Settings → AI Knowledge, live next turn); the
  // built-in library serves only when the store has no patterns at all.
  const patterns = await matchPatternsWithStore(text);
  // 008 FR-023 — when nothing curated matched, fall back to the request's own
  // capability keywords so the long tail of requests becomes cacheable too.
  // Previously an unmatched request produced an empty key and was never cached,
  // so it re-hit the MCP on every single turn.
  const patternIds = cacheKeys(patterns.map((p) => p.id), requirements ?? []);

  for (const id of activeTools) {
    const label = `Consulting official ${getProvider(id).label} MCP`;
    progress(`mcp:${id}`, label, 'running');
    const cached = patternIds.length > 0 && cache ? await cache.get(id, patternIds) : null;
    if (cached) {
      mcpGuidance.push(`--- Official ${getProvider(id).label} MCP guidance (cached) ---\n${cached.guidanceText}`);
      progress(`mcp:${id}`, label, 'done');
      continue;
    }
    try {
      const result = await getProvider(id).mcp.recommend(text, context);
      for (const tool of result.toolsInvoked) mcpCalls.push({ provider: id, tool, status: 'ok' });
      // Cap per provider: MCP answers are inserted verbatim into the plan
      // prompt — an unbounded payload can blow the token budget (or trip
      // request-size-capped providers like Groq's free tier).
      if (result.rawText) {
        const capped = result.rawText.slice(0, 6000);
        mcpGuidance.push(`--- Official ${getProvider(id).label} MCP guidance ---\n${capped}`);
        if (patternIds.length > 0 && cache) await cache.set(id, patternIds, capped, result.toolsInvoked);
      }
      progress(`mcp:${id}`, label, 'done');
    } catch (e) {
      failed.push(id);
      mcpCalls.push({
        provider: id,
        tool: e instanceof McpUnavailableError ? 'recommend' : 'recommend',
        status: 'failed',
      });
      progress(`mcp:${id}`, label, 'failed');
    }
  }
  const official = failed.length === 0 && mcpGuidance.length > 0;

  // Local reference-pattern library (curated from AWS Architecture Center /
  // Atlas guidance, expressed in catalog service ids): appended AFTER the
  // official-flag computation — it grounds the plan structurally but is not
  // an official source, and unlike the MCPs it also works offline.
  if (patterns.length > 0) {
    mcpGuidance.push(`--- Curated reference patterns (local library) ---\n${patternGrounding(patterns)}`);
  }

  return { mcpCalls, mcpGuidance, failed, official };
}

export interface DraftInput {
  text: string;
  activeTools: ProviderId[];
  current: { nodes: ArchNode[]; edges: ArchEdge[]; containers: ArchContainer[]; annotations: ArchAnnotation[] };
  guidance: Guidance;
  mcpGuidance: string[];
  failed: ProviderId[];
  official: boolean;
  /** research R2 — fed into the planner's user prompt verbatim on refine passes */
  refinementInstructions?: string;
  /**
   * Requirement checklist extracted by the understand phase (agent-loop) —
   * restated to the planner as explicit MUSTs so coverage is designed in, not
   * hoped for. The reviewer later grades the applied result against the same
   * list, item by item.
   */
  requirements?: string[];
  /** diagram mode from the dynamic router: cloud (default) | hld | lld */
  designMode?: import('@/lib/generate/router').DesignMode;
  /**
   * 008 FR-001 — rendered recent conversation (conversation-context.ts): prior
   * requests, what the assistant applied each turn, and manual canvas edits.
   */
  conversationContext?: string;
  /**
   * 008 FR-019 — retrieved house rules and learned lessons, pre-rendered.
   * Injected into the planner AND graded by the reviewer: a rule that is applied
   * but never checked quietly stops being followed.
   */
  knowledgeBlock?: string;
  /**
   * 008 FR-009 — when the intent resolver scoped this turn to specific existing
   * nodes, the ids it resolved. Stated to the planner as a hard constraint AND
   * enforced code-side afterwards, because a prompt instruction alone has never
   * been sufficient to keep the planner in scope.
   */
  editScopeNodeIds?: string[];
  /**
   * 006 T012 — consolidated clarify-round brief: confirmed capabilities and
   * explicit service selections become planner MUSTs; user-approved defaults
   * are restated so the plan matches what the user signed off on.
   */
  brief?: import('@/lib/generate/flow').GuidedBriefContext | null;
  signal?: AbortSignal;
}

export interface DraftResult {
  reply: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
  /** the plan's raw guidance before merging with `current` — drives `changed` detection */
  rawGuidance: Guidance;
  indicative: boolean;
  unsatisfiable: boolean;
  addRefIds: (string | null)[];
  structuralChange: boolean;
}

/** 005 — called after each chunk/slice-group is applied, with the FULL running snapshot. */
export type OnChunkApplied = (nodes: ArchNode[], edges: ArchEdge[], containers: ArchContainer[]) => void | Promise<void>;

export interface ChunkRoundState {
  /** 1-based iteration this round belongs to (004's review/refine loop) */
  iteration: number;
  /** 1-based chunk-planning round within this iteration's draft phase */
  round: number;
}

export interface ChunkRoundResult extends DraftResult {
  /** whether another chunk-planning round is needed to fully satisfy the request (FR-001/004) */
  moreNeeded: boolean;
}

/**
 * Plan ONE chunk-planning round (LLM or heuristic) + apply in place (005
 * research R1 — extends 004's draft phase, re-run on every refine pass AND on
 * every chunk-planning round within a pass). `sliceIntoChunks` is the
 * defensive backstop (research R2): even if this round's response doesn't
 * self-limit to CHUNK_SIZE new adds, the result still streams progressively.
 * `onChunkApplied` fires once per resulting group with the running snapshot,
 * paced by CHUNK_RENDER_DELAY_MS between groups (skipped entirely when a
 * response already fits in one group — FR-009/SC-003, the overwhelmingly
 * common case).
 */
export async function planOneChunk(
  input: DraftInput,
  roundState: ChunkRoundState,
  progress: OnProgress,
  onChunkApplied?: OnChunkApplied
): Promise<ChunkRoundResult> {
  const { text, activeTools, current, mcpGuidance, failed, official } = input;
  const context = architecturePrompt(current.nodes, current.edges, current.containers, current.annotations);

  // 2) Plan edits — LLM primary; labelled-indicative heuristic ONLY when the LLM
  // was never configured (001 degraded-mode assumption). A configured-but-failing
  // LLM propagates its LlmError to the route — with its actionable, specific
  // message and retryable flag — instead of silently degrading to the heuristic,
  // so a configuration-cause failure is never presented as retryable (003 R1,
  // FR-002, contracts/generation-reliability.md).
  let plan: Plan;
  let indicative = !official;
  progress('plan', 'Designing the architecture plan', 'running');
  if (llmAvailable()) {
    // sanitizePlan: the model's JSON is untrusted even under guided decoding —
    // coerce/drop malformed fields so apply never crashes on a bad plan shape.
    plan = sanitizePlan(await llmJson<unknown>({
        system: [
          'You are a cloud architecture assistant. You design and edit an architecture diagram',
          'by returning a JSON edit plan. Rules:',
          '- Prefer services from the catalog below (exact serviceId values) — they carry precise',
          '  config fields and pricing.',
          '- You may ALSO add any other real service of an attached provider that the request',
          '  needs: use a new slug serviceId ("aws-route53", "aws-eventbridge", "atlas-datalake"),',
          '  set name to the official service name ("Route 53"), pick the closest category, and',
          '  set monthlyCostUsd to your best indicative monthly estimate at the requested scale,',
          '  grounded in the official MCP guidance. Never invent services that do not exist.',
          '- PRESERVE USER WORK: edit only what the request requires; never remove or reconfigure',
          '  nodes the request does not target; keep existing connections unless asked.',
          '- Follow Well-Architected guidance (network, security, HA/DR, scaling) and set the',
          '  guidance fields when the architecture changed.',
          '- Reference new services in edges as new:<index into add>.',
          '- You have full authority over typed boundary containers (cloud/region/vpc/az/subnet/',
          '  project/cluster/group): create, relabel, retype, restructure (nesting), and move',
          '  services in/out via containers.assignMembers. The MANDATORY containment hierarchy',
          '  below is a real correctness requirement, not decoration — a reviewer checks it.',
          '- Containers/annotations are NEVER priced and never sent to provider tools — purely',
          '  organizational. Annotations (notes/stickies) are user content: never edit them.',
          '- NEVER leave a container empty: only create a container when at least one service will',
          '  be placed inside it (via add containerRef or containers.assignMembers), and create it',
          '  in the SAME round as its first member. An empty boundary box conveys nothing and is',
          '  removed automatically — plan the container together with its contents.',
          '- NEVER add a network/structural concept (VPC, Region, Availability Zone, Subnet, AWS Cloud,',
          '  Atlas Project, Atlas Cluster) as an entry in add — those are containers ONLY, created via',
          "  containers.add. A VPC, subnet, AZ, etc. is not a priced service and must never appear as",
          '  its own node on the canvas.',
          '- COST-ESTIMATE instructions ("set the X cost to $N/month", "assume N instances in the',
          '  estimate") are handled by a separate cost step and MUST NOT change any service',
          '  configuration — return an empty edit plan for them unless the message ALSO asks for',
          '  an architecture change.',
          '- ALWAYS FULFIL THE REQUEST: every real service the user asks for is buildable — from',
          '  the catalog when it exists there, dynamically otherwise. Set unsatisfiable: true ONLY',
          '  when nothing at all can be built (unattached provider, self-contradictory request).',
          '- IMPORT FROM CODE/IaC (007 3.2): when the request contains Terraform/CloudFormation/CDK,',
          '  SQL DDL, docker-compose, or application code, treat it as the source of truth: map each',
          '  resource/table/module to the corresponding service (aws_lambda_function → aws-lambda,',
          '  aws_db_instance → aws-rds, aws_s3_bucket → aws-s3, mongodbatlas_cluster → atlas-cluster,',
          '  CREATE TABLE → sys-db-table, a compose service → sys-service, etc.), carry sizing values',
          '  into matching config fields (instance class, memory, storage), and derive connections',
          '  from the references between resources (environment variables, security-group/IAM refs,',
          '  foreign keys, depends_on). Never invent resources that are not in the pasted content.',
          '- COST REALISM: unless the request states real production scale (explicit traffic/data/user',
          '  numbers), assume a small MVP/prototype workload — use each field\'s catalog default, or',
          '  lower, for usage-scale fields (requests, writes, storage, transfer, etc.) rather than a',
          '  large hypothetical number. Prefer serverless/on-demand and the smallest adequate size over',
          '  large fixed capacity, so the estimate stays realistic and cost-conscious for an MVP. Fields',
          '  marked "millions/mo" below are ALREADY in millions — e.g. 0.01, never the raw request count.',
          `- PLAN IN CHUNKS: plan AT MOST ${CHUNK_SIZE} new services/containers this round (fewer is fine — most`,
          '  requests fit in one round). Set moreNeeded: true if the request still needs more after this round',
          '  — you will be called again with everything you just added already applied, so continue rather than',
          '  repeat it — or false if this round fully completes the request. Optionally set chunkLabel to a short',
          '  phrase summarizing this round\'s additions, e.g. "Adding compute and networking".',
          ...designModePrompt(input.designMode),
          activeTools.length === 1
            ? `- The user attached only ${getProvider(activeTools[0]).label}; use only that provider.`
            : `- Attached toolsets: ${activeTools.map((t) => getProvider(t).label).join(' and ')}; use them where appropriate.`,
          '',
          catalogPrompt(activeTools),
          '',
          containerTypePrompt(activeTools),
        ].join('\n'),
        user: [
          context,
          // 008 FR-001 — earlier turns, what the assistant already applied, and
          // any manual canvas edits. Without this the planner re-derives intent
          // from one sentence and routinely rewrites parts nobody asked about.
          input.conversationContext ? `Conversation so far:\n${input.conversationContext}` : '',
          // 008 FR-019 — accumulated house rules and lessons from past turns.
          input.knowledgeBlock ?? '',
          // 008 FR-009 — a resolved modification is scoped to specific nodes;
          // enforced code-side after the plan lands, stated here so the model
          // does not have to be corrected by rejection.
          input.editScopeNodeIds?.length
            ? `SCOPE CONSTRAINT: this request targets ONLY these existing nodeIds: ${input.editScopeNodeIds.join(', ')}. Modify or remove nothing else. You may still ADD what the request explicitly asks for.`
            : '',
          mcpGuidance.length ? mcpGuidance.join('\n') : '(No official MCP guidance available for this turn — say so in your reply and mark recommendations as indicative.)',
          failed.length ? `NOTE: the official ${failed.map((f) => getProvider(f).label).join(' and ')} MCP tool failed this turn. Mention this in your reply and offer to retry or continue with available providers.` : '',
          `User request: ${text}`,
          // Requirements checklist (understand phase) — every item must end up
          // represented in the diagram; the reviewer grades against this list.
          (input.requirements?.length ?? 0) > 0
            ? [
                'REQUIREMENTS CHECKLIST (extracted from the request — EVERY item must be represented',
                'in the final diagram by a concrete service and/or connection; the result is reviewed',
                'against this list item by item):',
                ...input.requirements!.map((r, i) => `${i + 1}. ${r}`),
              ].join('\n')
            : '',
          // 006 T012 — the clarified brief outranks inference: selections are
          // hard MUSTs, approved assumptions are restated so the plan and the
          // user's sign-off can't drift apart (FR-008).
          input.brief
            ? [
                'CLARIFIED REQUIREMENTS (from the user-answered clarification round — these override any inference):',
                input.brief.capabilities.length ? `- Confirmed capabilities (each MUST be fulfilled): ${input.brief.capabilities.join('; ')}` : '',
                input.brief.selectedServiceIds.length
                  ? `- User-selected services (MUST use exactly these serviceIds for their need — no substitutes): ${input.brief.selectedServiceIds.join(', ')}`
                  : '',
                input.brief.assumptions.length ? `- Agreed scale/assumptions: ${input.brief.assumptions.join('; ')}` : '',
              ].filter(Boolean).join('\n')
            : '',
          input.refinementInstructions
            ? `The previous draft was reviewed and found incomplete. Refine it to address:\n${input.refinementInstructions}`
            : '',
          roundState.round > 1
            ? `This is chunk-planning round ${roundState.round} continuing the SAME request — the current-state listing above already includes everything applied in earlier rounds; build on it, do not repeat it.`
            : '',
        ].filter(Boolean).join('\n\n'),
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
        role: 'plan',
        signal: input.signal,
    }));
  } else {
    plan = heuristicPlan(current.nodes, activeTools);
    indicative = true;
  }
  progress('plan', 'Designing the architecture plan', 'done');
  progress('apply', 'Applying edits (preserving your work)', 'running');

  // 3) Apply the plan in place (FR-014d — never a fresh start).
  plan.add ||= [];
  plan.remove ||= [];
  plan.update ||= [];
  plan.edges ||= [];
  plan.containers ||= { add: [], update: [], remove: [], assignMembers: [] };
  plan.containers.add ||= [];
  plan.containers.update ||= [];
  plan.containers.remove ||= [];
  plan.containers.assignMembers ||= [];
  plan.guidance ||= {};

  // 3a) Containers first (002 FR-007/R8 — full AI authority) so node adds/moves
  // below can reference them. Removal defaults to "keep contents" (re-parent up)
  // — the AI restructures containers, it doesn't destroy the user's services.
  const containerRemoveSet = new Set((plan.containers.remove || []).filter((id) => current.containers.some((c) => c.containerId === id)));
  const removedContainerParent = new Map<string, string | null>();
  for (const c of current.containers) if (containerRemoveSet.has(c.containerId)) removedContainerParent.set(c.containerId, c.parentContainerId ?? null);
  let keptContainers: ArchContainer[] = current.containers
    .filter((c) => !containerRemoveSet.has(c.containerId))
    .map((c) => (c.parentContainerId && containerRemoveSet.has(c.parentContainerId)
      ? { ...c, parentContainerId: removedContainerParent.get(c.parentContainerId) ?? null }
      : c));

  const newContainerIds: string[] = [];
  const resolveContainerRef = (ref: string | null | undefined): string | null => {
    if (ref == null) return null;
    if (ref.startsWith('newContainer:')) {
      const idx = Number(ref.slice('newContainer:'.length));
      return Number.isInteger(idx) && idx >= 0 && idx < newContainerIds.length ? newContainerIds[idx] : null;
    }
    return keptContainers.some((c) => c.containerId === ref) ? ref : null;
  };
  (plan.containers?.add ?? []).forEach((add, i) => {
    const containerId = newNodeId();
    newContainerIds.push(containerId);
    keptContainers = [
      ...keptContainers,
      {
        containerId,
        type: add.type || 'group',
        label: add.label ?? '',
        position: { x: 60 + i * 40, y: 60 + i * 40 },
        size: { width: 480, height: 360 },
        parentContainerId: resolveContainerRef(add.parentRef),
      },
    ];
  });
  for (const upd of plan.containers?.update ?? []) {
    keptContainers = keptContainers.map((c) => {
      if (c.containerId !== upd.containerId) return c;
      return {
        ...c,
        label: upd.label !== undefined ? upd.label : c.label,
        type: upd.type !== undefined ? upd.type : c.type,
        parentContainerId: upd.parentRef !== undefined ? resolveContainerRef(upd.parentRef) : c.parentContainerId,
      };
    });
  }
  // Defensive cycle guard — the AI plan is never trusted to keep the tree acyclic.
  function wouldCycle(id: string, parentId: string | null): boolean {
    let cursor = parentId;
    let hops = 0;
    while (cursor != null && hops <= keptContainers.length) {
      if (cursor === id) return true;
      cursor = keptContainers.find((c) => c.containerId === cursor)?.parentContainerId ?? null;
      hops++;
    }
    return false;
  }
  keptContainers = keptContainers.map((c) =>
    c.parentContainerId && wouldCycle(c.containerId, c.parentContainerId) ? { ...c, parentContainerId: null } : c
  );

  // 3b) Nodes/edges (001 FR-014d preserve-user-work; 002 FR-005 membership).
  const nodes = [...current.nodes];
  const edges = [...current.edges];

  const removeSet = new Set(plan.remove.filter((id) => nodes.some((n) => n.nodeId === id)));
  // Copy each kept node (and its config): in-place edits below (plan.update, the
  // attach-merge, membership changes) must never mutate current.nodes, or the
  // before/after diff — and with it `changed`/`editsApplied` — reads as a no-op
  // and a config-only turn silently fails to persist (003 US2 finding).
  let keptNodes = nodes
    .filter((n) => !removeSet.has(n.nodeId))
    .map((n) => ({ ...n, config: { ...n.config } }));
  const keptEdges = edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target));
  // Nodes whose container was removed re-parent to the enclosing container, same as
  // the removed container's own members (keep-contents default above).
  keptNodes = keptNodes.map((n) =>
    n.containerId && containerRemoveSet.has(n.containerId)
      ? { ...n, containerId: removedContainerParent.get(n.containerId) ?? null }
      : n
  );

  for (const upd of plan.update) {
    const node = keptNodes.find((n) => n.nodeId === upd.nodeId);
    if (node) node.config = clampToFieldBounds(resolveServiceDef(node.serviceId), { ...node.config, ...upd.config });
  }
  let membershipChanged = false;
  for (const asg of plan.containers?.assignMembers ?? []) {
    const node = keptNodes.find((n) => n.nodeId === asg.nodeId);
    if (!node) continue;
    const next = resolveContainerRef(asg.containerRef);
    if ((node.containerId ?? null) !== next) membershipChanged = true;
    node.containerId = next;
  }

  // Attach-duplicate merge (003 FR-005, research R3): a planned add whose service
  // already exists in the kept architecture — and isn't separately reconfigured or
  // removed this turn — merges into the existing node instead of duplicating it.
  // `addRefIds` is aligned with plan.add order so new:<index> edge refs resolve
  // to the merged-into node (fixes the old validAdds index skew too).
  // Dynamic adds carry their indicative price as a config field (monthlyCost) so
  // the same value flows through create, attach-merge, pricing, and the editable
  // inspector field — one source of truth for a service the catalog doesn't know.
  for (const a of plan.add) {
    if (!serviceById(a.serviceId) && a.monthlyCostUsd != null && Number.isFinite(a.monthlyCostUsd)) {
      a.config = { monthlyCost: String(a.monthlyCostUsd), ...(a.config ?? {}) };
    }
  }
  const updatedIds = new Set(plan.update.map((u) => u.nodeId));
  const decisions = decideAdds(plan.add, keptNodes, updatedIds, activeTools);
  decisions.forEach((d, i) => {
    if (d.kind !== 'merge') return;
    const node = keptNodes.find((n) => n.nodeId === d.nodeId);
    if (node) applyAddMerge(node, plan.add[i]);
  });
  const createCount = decisions.filter((d) => d.kind === 'create').length;
  const positions = placeNewNodes(keptNodes, createCount);
  const addRefIds: (string | null)[] = new Array(plan.add.length).fill(null);
  let createIndex = 0;

  const resolveRef = (ref: unknown): string | null => {
    if (ref == null) return null;
    let refStr = String(ref);
    if (typeof ref === 'number') {
      refStr = `new:${ref}`;
    }
    if (refStr.startsWith('new:')) {
      const idx = Number(refStr.slice(4));
      return Number.isInteger(idx) && idx >= 0 && idx < addRefIds.length ? addRefIds[idx] : null;
    }
    return keptNodes.some((n) => n.nodeId === refStr) ? refStr : null;
  };

  // 005 — group adds/edges into chunks (defensive backstop, research R2) and
  // apply + emit each group in order, instead of the whole plan at once, so
  // the canvas builds up progressively (FR-001/002/003, SC-001).
  const groups = sliceIntoChunks(plan, current);
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (const i of group.addIdx) {
      const d = decisions[i];
      if (d.kind === 'skip') continue;
      if (d.kind === 'merge') {
        const node = keptNodes.find((n) => n.nodeId === d.nodeId);
        if (node) applyAddMerge(node, plan.add[i]);
        addRefIds[i] = d.nodeId;
        continue;
      }
      const a = plan.add[i];
      const def = serviceById(a.serviceId);
      const nodeId = newNodeId();
      addRefIds[i] = nodeId;
      if (def) {
        keptNodes.push({
          nodeId,
          serviceId: def.id,
          provider: def.provider,
          category: def.category,
          position: positions[createIndex++],
          config: clampToFieldBounds(def, { ...defaultConfig(def), ...(a.config ?? {}) }),
          cost: 0,
          costBasis: 'indicative',
          containerId: resolveContainerRef(a.containerRef),
        });
      } else {
        // Dynamic service (no catalog entry) — identity comes from the plan,
        // provider from the slug (decideAdds guaranteed both), price from
        // config.monthlyCost (normalized above).
        const config: ServiceConfig = { monthlyCost: 0, ...(a.config ?? {}) };
        const monthly = parseFloat(String(config.monthlyCost)) || 0;
        keptNodes.push({
          nodeId,
          serviceId: a.serviceId,
          provider: providerFromSlug(a.serviceId)!,
          category: a.category?.trim() || 'Other',
          position: positions[createIndex++],
          config,
          cost: monthly,
          costBasis: 'indicative',
          displayName: a.name?.trim(),
          containerId: resolveContainerRef(a.containerRef),
        });
      }
    }

    for (const i of group.edgeIdx) {
      const e = plan.edges[i];
      const rawSource = e.source !== undefined ? e.source : (e as unknown as Record<string, unknown>).from;
      const rawTarget = e.target !== undefined ? e.target : (e as unknown as Record<string, unknown>).to;
      const source = resolveRef(rawSource);
      const target = resolveRef(rawTarget);
      if (!source || !target || source === target) continue;
      if (keptEdges.some((x) => x.source === source && x.target === target)) continue;
      keptEdges.push({ edgeId: newNodeId(), source, target, ...(e.label ? { label: e.label } : {}) });
    }

    if (onChunkApplied) await onChunkApplied(keptNodes, keptEdges, keptContainers);
    // Skipped entirely for the (overwhelmingly common) single-group case — a
    // compliant round adds no perceptible delay (FR-009/SC-003).
    if (groups.length > 1 && g < groups.length - 1) await sleep(CHUNK_RENDER_DELAY_MS);
  }

  progress('apply', 'Applying edits (preserving your work)', 'done');

  const structuralChange =
    createCount > 0 ||
    removeSet.size > 0 ||
    containerRemoveSet.size > 0 ||
    newContainerIds.length > 0 ||
    membershipChanged ||
    keptEdges.length !== current.edges.length;

  return {
    reply: plan.reply,
    nodes: keptNodes,
    edges: keptEdges,
    containers: keptContainers,
    annotations: current.annotations,
    guidance: { ...input.guidance, ...(plan.guidance ?? {}) },
    rawGuidance: plan.guidance ?? {},
    indicative,
    unsatisfiable: Boolean(plan.unsatisfiable),
    addRefIds,
    structuralChange,
    moreNeeded: plan.moreNeeded,
  };
}

/** Single-round convenience wrapper (orchestrateChatTurn's one-shot composition; legacy/test callers). */
export async function draftAndApply(
  input: DraftInput,
  progress: OnProgress,
  onChunkApplied?: OnChunkApplied
): Promise<DraftResult> {
  return planOneChunk(input, { iteration: 1, round: 1 }, progress, onChunkApplied);
}

/**
 * Auto-arrange (follow-up to 003: "aligned like a real architecture diagram").
 * Whenever the turn changed the diagram's STRUCTURE — services or containers
 * created/removed, connections or memberships changed — re-run the ELK layered
 * layout over the whole result so it reads left→right with containers wrapping
 * their members. Config-only turns skip this, so a pure cost/config tweak never
 * moves anything the user arranged by hand. Mutates `nodes` in place (positions);
 * returns the (possibly repositioned/resized) containers.
 */
export async function layoutIfStructural(
  structuralChange: boolean,
  nodes: ArchNode[],
  edges: ArchEdge[],
  containers: ArchContainer[],
  progress: OnProgress
): Promise<ArchContainer[]> {
  if (!(structuralChange && nodes.length > 0)) return containers;
  progress('layout', 'Arranging the diagram', 'running');
  try {
    const result = await autoLayout(nodes, edges, containers);
    progress('layout', 'Arranging the diagram', 'done');
    return result;
  } catch (e) {
    console.error('[orchestrator] auto-layout failed, keeping default placement:', e);
    progress('layout', 'Arranging the diagram', 'failed');
    return containers;
  }
}

/** Price via the official chain (FR-019/020); per-node region, USD. Mutates `nodes` in place. */
export async function priceArchitecture(
  nodes: ArchNode[],
  defaultRegion: string,
  indicative: boolean,
  progress: OnProgress
): Promise<void> {
  progress('price', 'Pricing via official sources', 'running');
  const estimate = await priceNodes(
    nodes.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider, config: n.config })),
    defaultRegion
  );
  for (const n of nodes) {
    const priced = estimate.perService.find((p) => p.nodeId === n.nodeId);
    if (priced) {
      n.cost = priced.cost;
      n.costBasis = indicative ? 'indicative' : priced.basis;
    }
  }
  progress('price', 'Pricing via official sources', 'done');
}

export async function orchestrateChatTurn(input: TurnInput): Promise<TurnResult> {
  // FR-014a: no tool attached → ask, never guess.
  if (input.activeTools.length === 0) {
    return {
      reply:
        'Please attach at least one provider tool (AWS and/or MongoDB Atlas) so I know which cloud to design for — I never guess. Use the attach chips next to the message box.',
      nodes: input.nodes, edges: input.edges, containers: input.containers, annotations: input.annotations,
      guidance: input.guidance,
      editsApplied: [], mcpCalls: [], indicative: false, changed: false, unsatisfiable: false,
      addRefIds: [],
    };
  }

  const progress: OnProgress = input.onProgress ?? (() => {});

  // 1) Ground in the official MCPs — only the attached providers (FR-014b/c, FR-015).
  // Cost-neutrality guard (002 FR-017): only plain node/edge/container text reaches
  // the MCP — containers/annotations never become MCP or pricing payload fields.
  const gathered = await gatherGuidance(
    input.text,
    input.activeTools,
    { nodes: input.nodes, edges: input.edges, containers: input.containers, annotations: input.annotations },
    progress
  );

  const draft = await draftAndApply(
    {
      text: input.text,
      activeTools: input.activeTools,
      current: { nodes: input.nodes, edges: input.edges, containers: input.containers, annotations: input.annotations },
      guidance: input.guidance,
      mcpGuidance: gathered.mcpGuidance,
      failed: gathered.failed,
      official: gathered.official,
    },
    progress
  );

  // Container hygiene: drop AI-created containers that ended the turn empty
  // (pre-existing/user containers are protected — see agent-loop for the same
  // rule in the iterative path).
  const prunedDraft = pruneEmptyContainers(
    draft.nodes,
    draft.containers,
    new Set(input.containers.map((c) => c.containerId))
  );
  const containers = await layoutIfStructural(draft.structuralChange, draft.nodes, draft.edges, prunedDraft.containers, progress);
  await priceArchitecture(draft.nodes, input.defaultRegion, draft.indicative, progress);

  const editsApplied = summarizeArchitectureEdit(
    { nodes: input.nodes, edges: input.edges, containers: input.containers, annotations: input.annotations },
    { nodes: draft.nodes, edges: draft.edges, containers, annotations: draft.annotations }
  );

  return {
    reply: draft.reply,
    nodes: draft.nodes,
    edges: draft.edges,
    containers,
    annotations: draft.annotations,
    guidance: draft.guidance,
    editsApplied,
    mcpCalls: gathered.mcpCalls,
    indicative: draft.indicative,
    changed: editsApplied.length > 0 || JSON.stringify(draft.rawGuidance ?? {}) !== '{}',
    unsatisfiable: draft.unsatisfiable,
    addRefIds: draft.addRefIds,
  };
}
