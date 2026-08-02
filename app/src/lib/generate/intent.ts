import 'server-only';
import { llmAvailable, llmJson, LlmAbortError } from '@/lib/llm';

/**
 * Intent & reference resolver (feature 008 US1, FR-003/FR-004/FR-006;
 * contracts/agent-interfaces.md §1).
 *
 * WHY THIS EXISTS
 * Before 008 there was no stage that decided *what kind of change* a follow-up
 * was, or *which node* it referred to. The planner received the whole diagram
 * plus "PRESERVE USER WORK: edit only what the request requires" and had to
 * infer scope — which is root cause R4 of unrelated parts of the diagram being
 * rewritten when the user asked for one small change.
 *
 * DESIGN: THE MODEL PROPOSES, CODE DISPOSES
 * This runs on a SMALL model (role 'intent') because classification is cheap
 * work that should not consume the constrained large-model budget. Small models
 * are also worse at structured output, and NVIDIA's schema enforcement is
 * documented-unreliable for reasoning models — so nothing the model returns is
 * trusted. `sanitizeEditScope` verifies every node id against the real canvas
 * before it can become actionable.
 *
 * The degradation is deliberately asymmetric:
 *   - a wrong CLASSIFICATION costs one cheap call and falls back to the normal
 *     analyze/build path — exactly today's behavior, so nothing is lost;
 *   - a wrong REFERENCE would silently delete the user's work, so ambiguity
 *     resolves to asking (FR-006), never to guessing.
 *
 * Never retried on malformed output (FR-036): one attempt, then degrade.
 */

export type EditKind =
  | 'new'
  | 'add'
  | 'remove'
  | 'reconfigure'
  | 'rename'
  | 'restyle'
  | 'undo'
  | 'question'
  | 'ambiguous';

export interface EditTarget {
  nodeId: string;
  /** 0..1 — how confident the resolver is that this is the referenced node. */
  confidence: number;
}

export interface EditAddition {
  serviceHint: string;
  nearNodeId?: string;
}

export interface EditScope {
  kind: EditKind;
  targets: EditTarget[];
  additions: EditAddition[];
  /** Residual instruction for the planner, or the new name on a rename. */
  freeform: string;
  /** Single-field config change for the fast path (reconfigure only). */
  configPatch?: Record<string, string | number>;
}

export interface IntentCanvasNode {
  nodeId: string;
  serviceId: string;
  displayName?: string;
}

export interface IntentCanvas {
  nodes: IntentCanvasNode[];
}

export interface IntentInput {
  text: string;
  /** Rendered conversation context (conversation-context.ts). */
  context: string;
  canvas: IntentCanvas;
  signal?: AbortSignal;
}

/** Kinds that are meaningless without a resolved node reference. */
const TARGET_REQUIRED: ReadonlySet<EditKind> = new Set(['remove', 'rename', 'reconfigure', 'restyle']);

/** Kinds that act on exactly one node — two plausible candidates means ask. */
const SINGLE_TARGET: ReadonlySet<EditKind> = new Set(['remove', 'rename', 'reconfigure']);

const ALL_KINDS: ReadonlySet<string> = new Set<EditKind>([
  'new', 'add', 'remove', 'reconfigure', 'rename', 'restyle', 'undo', 'question', 'ambiguous',
]);

/**
 * Two candidates this close in confidence are not distinguishable, so acting on
 * either is a coin flip on the user's work. Ask instead (FR-006).
 */
const AMBIGUITY_MARGIN = 0.15;

const MAX_FREEFORM = 1000;

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'targets', 'additions', 'freeform'],
  properties: {
    kind: {
      type: 'string',
      enum: ['new', 'add', 'remove', 'reconfigure', 'rename', 'restyle', 'undo', 'question', 'ambiguous'],
      description:
        'new: design something from scratch or a major redesign. add: add service(s). remove: delete existing element(s). reconfigure: change a setting on an existing element. rename: change a display name. restyle: cosmetic only. undo: revert/go back to a previous version. question: asking about the design, wants an answer not a change. ambiguous: the reference could mean two or more different elements.',
    },
    targets: {
      type: 'array',
      description: 'Existing nodeIds the request refers to, with confidence 0..1. Only ids from the provided canvas list.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'confidence'],
        properties: {
          nodeId: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    additions: {
      type: 'array',
      description: 'Services the user asked to add, described in their words.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceHint'],
        properties: {
          serviceHint: { type: 'string' },
          nearNodeId: { type: 'string' },
        },
      },
    },
    freeform: {
      type: 'string',
      description: 'Residual instruction for the planner. For a rename, THE NEW NAME ONLY.',
    },
  },
} as const;

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function emptyScope(kind: EditKind, freeform = ''): EditScope {
  return { kind, targets: [], additions: [], freeform };
}

/**
 * Coerce an untrusted resolver verdict against the real canvas.
 *
 * Every rule here exists because the alternative silently damages the diagram:
 * unknown ids are dropped (the model may hallucinate one), a target-requiring
 * kind with nothing left becomes `ambiguous` (so "remove the cache" with no
 * cache asks instead of removing something adjacent), and near-tied candidates
 * become `ambiguous` (so two Lambdas and "remove the lambda" asks).
 */
export function sanitizeEditScope(raw: unknown, canvas: IntentCanvas): EditScope {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const freeform = typeof p.freeform === 'string' ? p.freeform.slice(0, MAX_FREEFORM) : '';
  let kind: EditKind = ALL_KINDS.has(p.kind as string) ? (p.kind as EditKind) : 'ambiguous';

  // Nothing on the canvas can be referenced, so every edit is really a new design.
  const known = new Map(canvas.nodes.map((n) => [n.nodeId, n]));
  if (known.size === 0) {
    if (kind === 'question' || kind === 'undo') return emptyScope(kind, freeform);
    return emptyScope('new', freeform);
  }

  // Verify references, de-duplicate keeping the strongest, and rank.
  const byId = new Map<string, EditTarget>();
  for (const entry of Array.isArray(p.targets) ? p.targets : []) {
    if (!entry || typeof entry !== 'object') continue;
    const nodeId = (entry as Record<string, unknown>).nodeId;
    if (typeof nodeId !== 'string' || !known.has(nodeId)) continue;
    const confidence = clampConfidence((entry as Record<string, unknown>).confidence);
    const prev = byId.get(nodeId);
    if (!prev || confidence > prev.confidence) byId.set(nodeId, { nodeId, confidence });
  }
  const targets = [...byId.values()].sort((a, b) => b.confidence - a.confidence);

  const additions: EditAddition[] = [];
  for (const entry of Array.isArray(p.additions) ? p.additions : []) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const serviceHint = typeof rec.serviceHint === 'string' ? rec.serviceHint.trim() : '';
    if (!serviceHint) continue;
    const nearNodeId = typeof rec.nearNodeId === 'string' && known.has(rec.nearNodeId) ? rec.nearNodeId : undefined;
    additions.push(nearNodeId ? { serviceHint, nearNodeId } : { serviceHint });
  }

  if (TARGET_REQUIRED.has(kind) && targets.length === 0) kind = 'ambiguous';

  // Two comparably-confident candidates for a single-node action: ask, do not pick.
  if (
    SINGLE_TARGET.has(kind) &&
    targets.length > 1 &&
    targets[0].confidence - targets[1].confidence < AMBIGUITY_MARGIN
  ) {
    return { kind: 'ambiguous', targets, additions, freeform };
  }

  // A resolved single-node action carries only its winner, so downstream scope
  // enforcement cannot be widened by also-rans.
  const finalTargets = SINGLE_TARGET.has(kind) && targets.length > 0 ? [targets[0]] : targets;
  return { kind, targets: finalTargets, additions, freeform };
}

function canvasSummary(canvas: IntentCanvas): string {
  return canvas.nodes
    .map((n) => `${n.nodeId}: ${n.serviceId}${n.displayName ? ` ("${n.displayName}")` : ''}`)
    .join('\n');
}

/**
 * Classify a follow-up and resolve its references. Never throws to the caller
 * except on user-initiated stop: any other failure degrades to `new`, which
 * routes to the existing analyze/build path (contracts §1).
 */
export async function resolveIntent(input: IntentInput): Promise<EditScope> {
  if (!llmAvailable() || input.canvas.nodes.length === 0) {
    return emptyScope('new', input.text);
  }
  try {
    const raw = await llmJson<unknown>({
      role: 'intent',
      system: [
        'You classify follow-up requests for an existing architecture diagram and resolve',
        'which existing elements the user is referring to. You NEVER design anything.',
        '',
        'Pick exactly one kind:',
        '- "question": the user is asking about the design and wants an ANSWER, not a change',
        '  ("why is there a NAT gateway?", "what does this cost?", "how does traffic flow?").',
        '- "undo": revert / go back / restore a previous version.',
        '- "remove", "rename", "reconfigure", "restyle": act on element(s) already on the canvas.',
        '- "add": add new service(s) to the existing design.',
        '- "new": design from scratch, or a redesign large enough that the whole diagram changes.',
        '- "ambiguous": the reference could equally mean two or more different elements.',
        '',
        'Resolving references:',
        '- Use the conversation and the canvas list to map phrases like "that lambda",',
        '  "the queue", "it" to nodeIds. Use ONLY nodeIds from the canvas list.',
        '- confidence 0..1 — how sure you are THIS is the element meant.',
        '- If two elements match a phrase equally well ("the lambda" with two lambdas),',
        '  return BOTH with similar confidence and kind "ambiguous". Do NOT pick one.',
        '- If nothing on the canvas matches, return no targets.',
        '',
        'freeform: for "rename" put ONLY the new name. Otherwise the residual instruction.',
      ].join('\n'),
      user: [
        input.context ? `Conversation so far:\n${input.context}` : '',
        `Elements currently on the canvas:\n${canvasSummary(input.canvas)}`,
        `NEW user message: ${input.text}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: INTENT_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 400,
      signal: input.signal,
    });
    return sanitizeEditScope(raw, input.canvas);
  } catch (e) {
    if (e instanceof LlmAbortError) throw e;
    // Degrade to today's behavior rather than retrying: a second attempt on a
    // small model rarely fixes malformed output and burns the turn's budget.
    console.error('[intent] resolution failed, falling back to full analysis:', e);
    return emptyScope('new', input.text);
  }
}
