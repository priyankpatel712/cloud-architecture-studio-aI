import 'server-only';
import { llmAvailable, llmJson } from '@/lib/llm';
import { clampToFieldBounds, resolveServiceDef } from '@/lib/catalog';
import { priceNodes } from '@/lib/pricing';
import { COST_QUESTION_LIMIT } from '@/lib/generate/loop-config';
import type { ArchNode } from '@/lib/generate/orchestrator';
import type { PricingOption, RequirementBrief, ValidationQuestion } from '@/lib/generate/flow';
import type { ServiceConfig } from '@/lib/providers/types';

/**
 * Cost dialogue engine (feature 006 FR-009–FR-011, research D5). Two halves:
 *
 * 1. `generateCostQuestions` — the applicable cost questions asked after the
 *    draft builds (usage, growth, budget sensitivity), ≤ COST_QUESTION_LIMIT,
 *    skippable like every guided round.
 * 2. `generatePricingOptions` — exactly two named variants of the built
 *    architecture (`cheapest` and `best_practice`) as PER-NODE CONFIG PATCHES:
 *    the LLM plans WHICH knobs to turn (semantic), `clampToFieldBounds` bounds
 *    every patch, and `priceNodes` computes WHAT it costs (deterministic —
 *    figures are never LLM-generated, honoring the ±5%/indicative policy).
 *    Patches never add/remove services, so both options preserve every
 *    confirmed capability by construction (FR-011). When the options call
 *    fails, a rule-based fallback produces honestly-labelled `degraded`
 *    options instead of failing the turn.
 *
 * Like cost-orchestrator.ts, this module writes nothing and imports no model —
 * the route applies the chosen option through the same persistence path every
 * other architecture write uses. `applyOptionToNodes` is the pure apply helper.
 */

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asConfigPatch = (v: unknown): Record<string, string> => {
  const src = asObj(v);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(src)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
};

// ---- Cost questions (FR-009) --------------------------------------------------

const COST_QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      description:
        'ONLY cost questions that genuinely apply to THIS architecture and would change its pricing configuration. Empty when the brief already answers them.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'why', 'kind'],
        properties: {
          prompt: { type: 'string' },
          why: { type: 'string', description: 'Which pricing decision this informs — one short sentence.' },
          kind: { type: 'string', enum: ['text', 'single_select'] },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: { label: { type: 'string' }, detail: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const;

/** Coerce untrusted cost-question output (analyze.ts sanitizer discipline). Exported for tests. */
export function sanitizeCostQuestions(raw: unknown): ValidationQuestion[] {
  const questions: ValidationQuestion[] = [];
  for (const item of asArray(asObj(raw).questions)) {
    if (questions.length >= COST_QUESTION_LIMIT) break;
    const q = asObj(item);
    const prompt = asStr(q.prompt);
    const kind = asStr(q.kind);
    if (!prompt || (kind !== 'text' && kind !== 'single_select')) continue;
    const qid = `cq${questions.length + 1}`;
    let options = asArray(q.options).flatMap((o, i) => {
      const opt = asObj(o);
      const label = asStr(opt.label);
      if (!label) return [];
      return [{ id: `${qid}o${i + 1}`, label, detail: asStr(opt.detail) ?? '', recommended: false }];
    }).slice(0, 4);
    if (kind === 'single_select' && options.length < 2) continue;
    if (kind === 'text') options = [];
    questions.push({ id: qid, prompt, why: asStr(q.why) ?? '', kind, options, skippable: true });
  }
  return questions;
}

/** Ask the cost questions applicable to the built draft (FR-009). Degraded mode → none. */
export async function generateCostQuestions(input: {
  nodes: ArchNode[];
  brief: RequirementBrief | null;
  signal?: AbortSignal;
}): Promise<ValidationQuestion[]> {
  if (!llmAvailable() || input.nodes.length === 0) return [];
  const lines = input.nodes.map((n) => `  - ${n.nodeId}: ${n.serviceId} config=${JSON.stringify(n.config)} ~$${n.cost}/mo`).join('\n');
  const known = [
    ...(input.brief?.scaleAssumptions ?? []).map((s) => `${s.key}: ${s.value}`),
    ...(input.brief?.constraints ?? []),
  ];
  try {
    const raw = await llmJson<unknown>({
      system: [
        'The architecture below has just been designed with the user. Before presenting priced',
        'configuration options (a cheapest option and a best-practice option), ask ONLY the',
        `cost-relevant questions that would change how it should be configured — at most ${COST_QUESTION_LIMIT},`,
        'typically about expected usage, growth expectations, or budget sensitivity. Never ask',
        'what the brief below already answers. A fully-determined case gets ZERO questions.',
      ].join('\n'),
      user: [
        `Architecture:\n${lines}`,
        known.length ? `Already known from the clarified brief:\n${known.map((k) => `  - ${k}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'),
      schema: COST_QUESTIONS_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 1024,
      role: 'cost',
      signal: input.signal,
    });
    return sanitizeCostQuestions(raw);
  } catch (e) {
    // Questions are an optimization, not a gate — a failure skips straight to options.
    console.error('[cost-options] cost-question generation failed, proceeding to options:', e);
    return [];
  }
}

// ---- Pricing options (FR-010/FR-011) ------------------------------------------

export const CHEAPEST_ID = 'cheapest';
export const BEST_PRACTICE_ID = 'best_practice';
const OPTION_LABELS: Record<string, string> = {
  [CHEAPEST_ID]: 'Cheapest (budget)',
  [BEST_PRACTICE_ID]: 'Best practice',
};

const OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['options'],
  properties: {
    options: {
      type: 'array',
      description: 'Exactly two configuration variants of the architecture: cheapest and best_practice.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary', 'patches'],
        properties: {
          id: { type: 'string', enum: [CHEAPEST_ID, BEST_PRACTICE_ID] },
          summary: {
            type: 'string',
            description: 'Plain-language trade-offs: what the user gives up or gains by choosing this variant.',
          },
          patches: {
            type: 'array',
            description:
              'Config changes per node, ONLY for nodes whose config should differ from the current build. NEVER add or remove services — configuration knobs only (tiers, instance types, quantities, storage).',
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
        },
      },
    },
  },
} as const;

function fieldSpec(serviceId: string, displayName?: string): string {
  const def = resolveServiceDef(serviceId, { displayName });
  return def.fields
    .map((f) => {
      const bounds = [
        f.type === 'select' && f.options ? `options: ${f.options.join('|')}` : '',
        f.min !== undefined ? `min ${f.min}` : '',
        f.max !== undefined ? `max ${f.max}` : '',
        f.unit ? `unit ${f.unit}` : '',
      ].filter(Boolean).join(', ');
      return `${f.key} (${f.type}${bounds ? `; ${bounds}` : ''}; default ${f.default})`;
    })
    .join(', ');
}

interface RawOption { id: string; summary: string; patches: { nodeId: string; config: Record<string, string> }[] }

function sanitizeOptions(raw: unknown, nodesById: Map<string, ArchNode>): RawOption[] {
  const out: RawOption[] = [];
  for (const item of asArray(asObj(raw).options)) {
    const o = asObj(item);
    const id = asStr(o.id);
    if ((id !== CHEAPEST_ID && id !== BEST_PRACTICE_ID) || out.some((x) => x.id === id)) continue;
    const patches = asArray(o.patches).flatMap((p) => {
      const patch = asObj(p);
      const nodeId = asStr(patch.nodeId);
      if (!nodeId || !nodesById.has(nodeId)) return [];
      const config = asConfigPatch(patch.config);
      return Object.keys(config).length > 0 ? [{ nodeId, config }] : [];
    });
    out.push({ id, summary: asStr(o.summary) ?? '', patches });
  }
  return out;
}

/** Rule-based fallback when the options call fails (research D5) — honestly labelled `degraded`. */
function fallbackRawOption(id: string, nodes: ArchNode[]): RawOption {
  if (id === BEST_PRACTICE_ID) {
    return { id, summary: 'The architecture exactly as designed, following the provider guidance gathered for it.', patches: [] };
  }
  // Cheapest: every declared-minimum numeric knob to its floor. Dynamic
  // services (identified by their synthesized monthlyCost field) keep their
  // indicative price — zeroing them would misstate the estimate, not save money.
  const patches = nodes.flatMap((n) => {
    const def = resolveServiceDef(n.serviceId, { displayName: n.displayName });
    if (def.fields.some((f) => f.key === 'monthlyCost')) return [];
    const config: Record<string, string> = {};
    for (const f of def.fields) {
      if (f.type === 'number' && f.min !== undefined) config[f.key] = String(f.min);
    }
    return Object.keys(config).length > 0 ? [{ nodeId: n.nodeId, config }] : [];
  });
  return { id, summary: 'Every sizing knob at its declared minimum — the lowest configurable cost for this design.', patches };
}

/** Pure apply helper: merge an option's patches onto the nodes (clamped), returning NEW nodes. Exported for the route + tests. */
export function applyOptionToNodes(nodes: ArchNode[], option: Pick<PricingOption, 'patches'>): ArchNode[] {
  const byNode = new Map(option.patches.map((p) => [p.nodeId, p.config]));
  return nodes.map((n) => {
    const patch = byNode.get(n.nodeId);
    if (!patch) return n;
    const def = resolveServiceDef(n.serviceId, { displayName: n.displayName });
    return { ...n, config: clampToFieldBounds(def, { ...n.config, ...patch } as ServiceConfig) };
  });
}

/**
 * Generate + price both options (FR-010). The LLM plans patches; every patch is
 * clamped; each variant is priced deterministically with priceNodes. Both
 * mandatory options are always present — a missing/failed one falls back to the
 * rule-based variant with `degraded: true`.
 */
export async function generatePricingOptions(input: {
  nodes: ArchNode[];
  defaultRegion: string;
  brief: RequirementBrief | null;
  /** resolved cost-question round, folded in as pricing context */
  costAnswers: ValidationQuestion[];
  signal?: AbortSignal;
}): Promise<PricingOption[]> {
  const nodesById = new Map(input.nodes.map((n) => [n.nodeId, n]));
  let rawOptions: RawOption[] = [];
  let degradedIds = new Set<string>();

  if (llmAvailable() && input.nodes.length > 0) {
    const lines = input.nodes
      .map((n) => `  - ${n.nodeId}: ${n.serviceId} current=${JSON.stringify(n.config)}\n    fields: ${fieldSpec(n.serviceId, n.displayName)}`)
      .join('\n');
    const answers = input.costAnswers
      .filter((q) => q.resolution)
      .map((q) => {
        const r = q.resolution!;
        const value = r.kind === 'skipped' ? '(skipped — assume small MVP scale)' : (r.text ?? q.options.find((o) => o.id === r.optionId)?.label ?? '');
        return `  - ${q.prompt}: ${value}`;
      });
    try {
      const raw = await llmJson<unknown>({
        system: [
          'You produce PRICED CONFIGURATION VARIANTS of a finished cloud architecture. Return',
          `exactly two options: "${CHEAPEST_ID}" and "${BEST_PRACTICE_ID}".`,
          `- ${CHEAPEST_ID}: the lowest sensible monthly cost that still works — smallest adequate`,
          '  tiers/instance types, minimum quantities, serverless/on-demand where the fields allow.',
          `- ${BEST_PRACTICE_ID}: what the provider\'s Well-Architected guidance recommends at the`,
          '  stated scale — right-sized (NOT maximal) instances, HA where it matters. Do not gold-plate.',
          'Rules:',
          '- Configuration knobs ONLY (the exact field keys listed per node). NEVER add or remove',
          '  services; NEVER touch fields that are not listed.',
          '- Patch only nodes whose config should differ from the current build; an empty patches',
          '  array means "as currently configured".',
          '- Respect each field\'s options/min/max exactly. Fields with unit M are ALREADY in',
          '  millions/mo — small decimals, never raw counts.',
          '- COST REALISM: unless the answers below state real production scale, assume a small',
          '  MVP workload for both options.',
          '- summary: one or two sentences of plain-language trade-offs for a non-expert.',
        ].join('\n'),
        user: [
          `Architecture and configurable fields:\n${lines}`,
          answers.length ? `Cost-dialogue answers:\n${answers.join('\n')}` : 'Cost questions were skipped — assume a small MVP workload.',
        ].join('\n\n'),
        schema: OPTIONS_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 2048,
        role: 'cost',
        signal: input.signal,
      });
      rawOptions = sanitizeOptions(raw, nodesById);
    } catch (e) {
      console.error('[cost-options] options generation failed, using rule-based fallback:', e);
    }
  }

  // Both mandatory options, always (FR-010) — fill gaps from the fallback.
  for (const id of [CHEAPEST_ID, BEST_PRACTICE_ID]) {
    if (!rawOptions.some((o) => o.id === id)) {
      rawOptions.push(fallbackRawOption(id, input.nodes));
      degradedIds = new Set([...degradedIds, id]);
    }
  }
  rawOptions.sort((a, b) => (a.id === CHEAPEST_ID ? -1 : 1) - (b.id === CHEAPEST_ID ? -1 : 1));

  // Price each variant deterministically (never LLM figures).
  const priced: PricingOption[] = [];
  for (const o of rawOptions) {
    const patched = applyOptionToNodes(input.nodes, { patches: o.patches });
    const estimate = await priceNodes(
      patched.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider, config: n.config })),
      input.defaultRegion
    );
    priced.push({
      id: o.id,
      label: OPTION_LABELS[o.id] ?? o.id,
      summary: o.summary,
      monthly: estimate.monthly,
      indicative: estimate.basis !== 'exact',
      perService: estimate.perService.map((l) => ({ nodeId: l.nodeId ?? '', serviceId: l.serviceId, cost: l.cost, basis: l.basis })),
      // Store the FULL post-clamp replacement config per touched node so a later
      // switch re-applies deterministically without re-deriving (data-model §2).
      patches: patched
        .filter((n) => o.patches.some((p) => p.nodeId === n.nodeId))
        .map((n) => ({ nodeId: n.nodeId, config: n.config as Record<string, string | number> })),
      degraded: degradedIds.has(o.id),
    });
  }
  return priced;
}

// ---- Switch intent (FR-011) ----------------------------------------------------

/**
 * Deterministic post-completion switch detection ("switch to the best practice
 * option") — code-side, no LLM, so switching is instant and testable. Returns
 * the target option id, or null when the message isn't a switch instruction.
 */
export function detectSwitchIntent(text: string, options: Pick<PricingOption, 'id'>[]): string | null {
  if (options.length === 0) return null;
  const t = text.toLowerCase();
  let target: string | null = null;
  if (/\bbest[\s-]?practice\b/.test(t)) target = BEST_PRACTICE_ID;
  else if (/\b(cheapest|budget)\b/.test(t)) target = CHEAPEST_ID;
  if (!target || !options.some((o) => o.id === target)) return null;
  const verb = /\b(switch|use|apply|go with|take|choose|select|change to|move to|prefer|pick)\b/.test(t);
  const optionish = /\boption\b|\bconfig(uration)?\b|\bpricing\b|\bplan\b/.test(t);
  return verb || optionish ? target : null;
}
