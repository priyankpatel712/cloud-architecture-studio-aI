import 'server-only';
import { llmAvailable, llmJson } from '@/lib/llm';
import { quantityFieldOf } from '@/lib/generate/overrides';
import { serviceById } from '@/lib/catalog';
import type { ServiceConfig } from '@/lib/providers/types';

/**
 * Chat cost-orchestrator (003 research R8, FR-008a, contracts/cost-overrides.md).
 *
 * The COST phase of a chat turn: runs after the architecture phase against the
 * resulting priced node list, and decides whether the user's message contains a
 * cost-override instruction ("assume 3 instances", "set the EC2 cost to
 * $200/month"). It returns VALIDATED override intents — it writes nothing and
 * imports no model, so it is structurally incapable of touching the diagram or
 * the database (FR-015 / research R6); the route applies its intents through
 * the same path the inline PATCH uses.
 *
 * Ambiguity (which service? quantity or total cost?) comes back as a
 * clarification question and NO intents — the assistant asks, never guesses
 * (spec edge case). Degraded mode (no LLM configured): no chat-driven
 * overrides; the inline path is unaffected.
 */

export interface CostTurnNode {
  nodeId: string;
  serviceId: string;
  displayName?: string;
  config: ServiceConfig;
  /** computed monthly for this line, for the model's context */
  cost: number;
}

export interface CostOverrideIntent {
  nodeId: string;
  field: 'quantity' | 'totalCost';
  value: number;
}

export interface CostTurnResult {
  intents: CostOverrideIntent[];
  clarificationQuestion: string | null;
}

interface CostPlan {
  overrides: { nodeRef: string; field: 'quantity' | 'totalCost'; value: number }[];
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
}

const COST_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overrides', 'clarificationNeeded'],
  properties: {
    overrides: {
      type: 'array',
      description: 'Cost-estimate overrides the user explicitly asked for. Empty when the message contains no cost-change instruction.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeRef', 'field', 'value'],
        properties: {
          nodeRef: { type: 'string', description: 'nodeId from the line-item list, or new:<index> for a service added this turn' },
          field: { type: 'string', enum: ['quantity', 'totalCost'] },
          value: { type: 'number' },
        },
      },
    },
    clarificationNeeded: {
      type: 'boolean',
      description: 'true ONLY when the message clearly asks for a cost change but the target service or field (quantity vs fixed total) cannot be determined.',
    },
    clarificationQuestion: {
      type: 'string',
      description: 'The question to ask the user when clarificationNeeded is true.',
    },
  },
} as const;

export async function orchestrateCostTurn(input: {
  text: string;
  nodes: CostTurnNode[];
  /** nodeId per this turn's plan.add entry — resolves new:<index> refs */
  addRefIds: (string | null)[];
}): Promise<CostTurnResult> {
  if (!llmAvailable() || input.nodes.length === 0) {
    return { intents: [], clarificationQuestion: null };
  }

  const lines = input.nodes
    .map((n) => {
      const def = serviceById(n.serviceId);
      const qf = def?.quantityField;
      const name = n.displayName || def?.name || n.serviceId;
      const qty = qf ? ` quantity(${qf})=${n.config[qf] ?? 1} (quantity-capable)` : ' (no quantity — fixed total only)';
      return `  - ${n.nodeId}: ${name} [${n.serviceId}] ~$${n.cost}/mo${qty}`;
    })
    .join('\n');

  const plan = await llmJson<CostPlan>({
    system: [
      'You manage ONLY the cost estimate of a cloud architecture. You cannot change the',
      'diagram, services, or configuration — only per-line cost overrides:',
      "- field 'quantity': the planned quantity/usage for a quantity-capable line (value > 0).",
      "- field 'totalCost': a fixed monthly USD figure for a line (value >= 0), e.g. a negotiated rate.",
      'Rules:',
      '- Return overrides ONLY for explicit cost/quantity instructions in the user message.',
      '- A message with no cost-change instruction returns an empty overrides array. Adding,',
      '  removing, or reconfiguring services is NOT a cost instruction — new services are priced',
      '  automatically; never ask the user for their cost.',
      '- Set clarificationNeeded ONLY when the message explicitly asks for a cost change AND you',
      '  cannot tell WHICH service or WHICH field is meant; then ask a specific question instead',
      '  of guessing. Never ask otherwise.',
      "- Never invent nodeRefs — use the nodeIds listed, or new:<index> for services added this turn.",
    ].join('\n'),
    user: `Cost line items:\n${lines}\n\nUser message: ${input.text}`,
    schema: COST_PLAN_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
    role: 'cost',
  });

  if (plan.clarificationNeeded) {
    return {
      intents: [],
      clarificationQuestion:
        plan.clarificationQuestion?.trim() ||
        'Which service should the cost change apply to, and is it a quantity change or a fixed monthly cost?',
    };
  }

  const byId = new Map(input.nodes.map((n) => [n.nodeId, n]));
  const intents: CostOverrideIntent[] = [];
  for (const o of plan.overrides ?? []) {
    let nodeId: string | null = String(o.nodeRef ?? '');
    if (nodeId.startsWith('new:')) {
      const idx = Number(nodeId.slice(4));
      nodeId = Number.isInteger(idx) && idx >= 0 && idx < input.addRefIds.length ? input.addRefIds[idx] : null;
    }
    const node = nodeId ? byId.get(nodeId) : undefined;
    if (!node || !nodeId) continue;
    // Untrusted LLM output (guided_json is not reliably enforced): a junk field
    // value must be dropped, not silently treated as a totalCost override.
    if (o.field !== 'quantity' && o.field !== 'totalCost') continue;
    if (!Number.isFinite(o.value)) continue;
    if (o.field === 'quantity') {
      if (!quantityFieldOf(node.serviceId) || o.value <= 0) continue;
    } else if (o.value < 0) {
      continue;
    }
    intents.push({ nodeId, field: o.field, value: o.value });
  }
  return { intents, clarificationQuestion: null };
}
