import 'server-only';
import { llmAvailable, llmJson } from '@/lib/llm';
import type { ProviderId } from '@/lib/providers/types';
import { providerFromSlug, serviceById } from '@/lib/catalog';
import { QUESTION_LIMIT } from '@/lib/generate/loop-config';
import { architecturePrompt, catalogPrompt, type ArchNode, type ArchEdge, type ArchContainer, type ArchAnnotation } from '@/lib/generate/orchestrator';
import type { InteractionAnswer, QuestionOption, RequestClass, RequirementBrief, ValidationQuestion } from '@/lib/generate/flow';

/**
 * Analyze phase (feature 006 FR-001–FR-003, research D2–D4). One structured
 * LLM call extracts everything the guided flow needs up front: a user-facing
 * analysis summary, the request classification (new / major_revision /
 * small_edit — the FR-013 router), the detected capabilities/scale/constraints,
 * the request-specific validation questions (≤ QUESTION_LIMIT, never a generic
 * questionnaire), and per-need candidate service sets for selectable choices.
 *
 * Everything the model returns is untrusted (sanitizePlan/sanitizeVerdict
 * precedent): `sanitizeAnalysis` coerces shapes, validates candidate serviceIds
 * against the catalog + attached providers, enforces 2–4 candidates with
 * exactly one recommended (fewer than 2 collapses the question to a
 * confirmation note), caps the question count, and applies the classifier
 * backstops (empty canvas ⇒ 'new'; classifier failure ⇒ 'major_revision').
 */

export interface AnalyzeResult {
  /** user-facing playback of what was understood (FR-001) */
  summary: string;
  requestClass: RequestClass;
  capabilities: { text: string; source: 'stated' | 'inferred' }[];
  scaleSignals: { key: string; value: string }[];
  constraints: string[];
  /** existing nodeIds the request targets (understand-phase role, carried over) */
  changeScope: string[];
  /** validated, id-assigned questions ready to open as a clarify round */
  questions: ValidationQuestion[];
  /** confirmation notes for service choices that collapsed below 2 candidates */
  collapsedChoices: string[];
}

const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'requestClass', 'capabilities', 'questions'],
  properties: {
    summary: {
      type: 'string',
      description:
        'A 2-4 sentence plain-language playback of what you understood: the capabilities requested, any scale signals, constraints, and what is still ambiguous. Shown to the user verbatim.',
    },
    requestClass: {
      type: 'string',
      enum: ['new', 'major_revision', 'small_edit'],
      description:
        'small_edit ONLY for a narrow change to an existing architecture (rename, config tweak, add/modify at most 2 services). major_revision for redesigns, multi-service additions, or changed non-functional requirements on an existing architecture. new when the canvas is empty.',
    },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'One distinct capability/service the user needs, in plain language.' },
          source: { type: 'string', enum: ['stated', 'inferred'], description: 'stated = explicitly asked; inferred = clearly implied.' },
        },
      },
    },
    scaleSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value'],
        properties: { key: { type: 'string' }, value: { type: 'string' } },
      },
      description: 'Explicit traffic/data/user-count signals stated in the request. Empty when none were stated.',
    },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Stated constraints (region, compliance, latency, budget...).' },
    changeScope: {
      type: 'array',
      items: { type: 'string' },
      description: 'Existing nodeIds (from the listing given) this request targets. Empty for open-ended/full redesigns or an empty canvas.',
    },
    questions: {
      type: 'array',
      description:
        'ONLY the validation questions that genuinely apply to THIS request — questions whose answer changes what gets built. Never a generic questionnaire. Empty when the request is fully specified.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'why', 'kind'],
        properties: {
          prompt: { type: 'string', description: 'The question, phrased for a non-expert.' },
          why: { type: 'string', description: 'Which gap in the request this closes — one short sentence.' },
          kind: { type: 'string', enum: ['text', 'single_select', 'service_choice'] },
          need: { type: 'string', description: 'service_choice only: the capability this choice resolves, e.g. "primary datastore".' },
          options: {
            type: 'array',
            description:
              'single_select: 2-4 answer options. service_choice: 2-4 candidate services that could fill the need, EXACTLY ONE with recommended true.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                label: { type: 'string' },
                detail: { type: 'string', description: 'One-line trade-off for this option.' },
                serviceId: { type: 'string', description: 'service_choice only: exact catalog serviceId, or a real provider slug like "aws-route53".' },
                recommended: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
} as const;

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A candidate serviceId is valid when it resolves to an ATTACHED provider (catalog entry or dynamic slug). */
function validServiceId(serviceId: string, activeTools: ProviderId[]): boolean {
  const provider = serviceById(serviceId)?.provider ?? providerFromSlug(serviceId);
  return provider !== null && activeTools.includes(provider);
}

export interface SanitizeAnalysisOpts {
  existingNodeIds: Set<string>;
  hasCanvas: boolean;
  activeTools: ProviderId[];
}

/** Coerce untrusted analyze output into a safe AnalyzeResult (research D3/D4 rules). */
export function sanitizeAnalysis(raw: unknown, opts: SanitizeAnalysisOpts): AnalyzeResult {
  const p = asObj(raw);

  let requestClass: RequestClass;
  const rawClass = asStr(p.requestClass);
  if (rawClass === 'new' || rawClass === 'major_revision' || rawClass === 'small_edit') {
    requestClass = rawClass;
  } else {
    // Classifier backstop (D4): failure degrades to the safe ask-before-acting class.
    requestClass = opts.hasCanvas ? 'major_revision' : 'new';
  }
  // Code backstop (D4): an empty canvas is ALWAYS a new architecture — a
  // 'small_edit' verdict with nothing to edit is a classifier mistake.
  if (!opts.hasCanvas) requestClass = 'new';

  const capabilities = asArray(p.capabilities).flatMap((item) => {
    const c = asObj(item);
    const text = asStr(c.text);
    if (!text) return [];
    return [{ text, source: (c.source === 'inferred' ? 'inferred' : 'stated') as 'stated' | 'inferred' }];
  });

  const scaleSignals = asArray(p.scaleSignals).flatMap((item) => {
    const s = asObj(item);
    const key = asStr(s.key);
    const value = asStr(s.value);
    return key && value ? [{ key, value }] : [];
  });

  const constraints = asArray(p.constraints).flatMap((c) => asStr(c) ?? []);
  const changeScope = asArray(p.changeScope).flatMap((c) => {
    const id = asStr(c);
    return id && opts.existingNodeIds.has(id) ? [id] : [];
  });

  const collapsedChoices: string[] = [];
  const questions: ValidationQuestion[] = [];
  for (const item of asArray(p.questions)) {
    if (questions.length >= QUESTION_LIMIT) break; // FR-002 bound
    const q = asObj(item);
    const prompt = asStr(q.prompt);
    const kind = asStr(q.kind);
    if (!prompt || (kind !== 'text' && kind !== 'single_select' && kind !== 'service_choice')) continue;
    const qid = `q${questions.length + 1}`;

    let options: QuestionOption[] = asArray(q.options).flatMap((o, i) => {
      const opt = asObj(o);
      const label = asStr(opt.label);
      if (!label) return [];
      return [{
        id: `${qid}o${i + 1}`,
        label,
        detail: asStr(opt.detail) ?? '',
        serviceId: asStr(opt.serviceId),
        recommended: opt.recommended === true,
      }];
    });

    if (kind === 'service_choice') {
      // D3: catalog-grounded candidates only — drop invalid/unattached, dedupe by serviceId, cap at 4.
      const seen = new Set<string>();
      options = options.filter((o) => {
        if (!o.serviceId || !validServiceId(o.serviceId, opts.activeTools) || seen.has(o.serviceId)) return false;
        seen.add(o.serviceId);
        return true;
      }).slice(0, 4);
      if (options.length < 2) {
        // Collapse to a confirmation instead of a forced menu (spec edge case).
        if (options.length === 1) {
          const only = options[0];
          collapsedChoices.push(`For "${asStr(q.need) ?? prompt}", ${only.label} is the one sensible fit — I'll use it.`);
        }
        continue;
      }
      // Exactly one recommended (D3): none or many → the first flagged one wins, else the first option.
      const recommendedIdx = Math.max(0, options.findIndex((o) => o.recommended));
      options = options.map((o, i) => ({ ...o, recommended: i === recommendedIdx }));
    } else if (kind === 'single_select') {
      options = options.map((o) => ({ ...o, serviceId: undefined })).slice(0, 4);
      if (options.length < 2) continue; // a select needs choices; a broken one is dropped, not shown
    } else {
      options = [];
    }

    questions.push({
      id: qid,
      prompt,
      why: asStr(q.why) ?? '',
      kind,
      need: kind === 'service_choice' ? (asStr(q.need) ?? prompt) : undefined,
      options,
      skippable: true,
    });
  }

  return {
    summary: asStr(p.summary) ?? 'I analyzed your request.',
    requestClass,
    capabilities,
    scaleSignals,
    constraints,
    changeScope,
    questions,
    collapsedChoices,
  };
}

export interface AnalyzeInput {
  text: string;
  activeTools: ProviderId[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  /**
   * 008 (FR-001) — rendered recent conversation (conversation-context.ts).
   * Before this, analysis saw only the newest message plus a canvas render, so a
   * follow-up like "add the cache we discussed" had nothing to resolve against.
   */
  conversationContext?: string;
  signal?: AbortSignal;
}

/**
 * Run the analyze phase (FR-001). Returns null in degraded mode (no LLM) — the
 * route falls back to the legacy turn so the no-LLM behavior is unchanged.
 */
export async function analyzeRequest(input: AnalyzeInput): Promise<AnalyzeResult | null> {
  if (!llmAvailable()) return null;
  const hasCanvas = input.nodes.length > 0;
  const raw = await llmJson<unknown>({
    system: [
      'You are the requirements analyst for a cloud architecture assistant. BEFORE anything is',
      'designed or drawn, you analyze the user request and decide what must be clarified.',
      'Return:',
      '- summary: a short plain-language playback of what you understood (shown to the user).',
      '- requestClass: small_edit ONLY for a narrow change to the existing architecture shown',
      '  below (rename, config tweak, add/modify at most 2 services); major_revision for',
      '  redesigns/multi-service additions/changed non-functional requirements; new when the',
      '  canvas is empty.',
      '- capabilities/scaleSignals/constraints/changeScope extracted from the request.',
      '- questions: ONLY validation questions whose answer changes what gets built — never a',
      `  generic questionnaire. At most ${QUESTION_LIMIT}. A fully-specified request gets ZERO questions.`,
      '  Whenever a stated need could reasonably be met by MORE THAN ONE service from the',
      '  catalog below, ask a service_choice question listing 2-4 candidate serviceIds with a',
      '  one-line trade-off each and EXACTLY ONE recommended: true. Never silently pick.',
      '  Use single_select for non-service decisions with discrete options, text for open ones.',
      '  For a small_edit, ask at most ONE question, and only if the edit itself is ambiguous.',
      '',
      catalogPrompt(input.activeTools),
    ].join('\n'),
    user: [
      architecturePrompt(input.nodes, input.edges, input.containers, input.annotations),
      // 008 FR-001 — earlier turns and manual canvas edits, so a follow-up is
      // read in context instead of being re-derived from one sentence.
      input.conversationContext ? `Conversation so far:\n${input.conversationContext}` : '',
      `User request: ${input.text}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: ANALYZE_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2048,
    role: 'analyze',
    signal: input.signal,
  });
  return sanitizeAnalysis(raw, {
    existingNodeIds: new Set(input.nodes.map((n) => n.nodeId)),
    hasCanvas,
    activeTools: input.activeTools,
  });
}

/** Build the initial RequirementBrief from an analysis (data-model.md §1). */
export function briefFromAnalysis(analysis: AnalyzeResult, requestText: string): RequirementBrief {
  return {
    requestText,
    requestClass: analysis.requestClass,
    capabilities: analysis.capabilities.map((c, i) => ({ id: `c${i + 1}`, text: c.text, source: c.source })),
    scaleAssumptions: analysis.scaleSignals.map((s) => ({ key: s.key, value: s.value, source: 'stated' as const })),
    constraints: analysis.constraints,
    changeScope: analysis.changeScope,
    selections: [],
    defaultsApplied: [],
  };
}

// ---- Free-text interpretation while a round is open (research D8, spec edge cases) ----

export type InterpretOutcome =
  | { kind: 'answers'; answers: InteractionAnswer[]; skipAll: boolean }
  | { kind: 'request_change' }
  | { kind: 'followup'; question: string };

const INTERPRET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: {
      type: 'string',
      enum: ['answers', 'skip_all', 'request_change', 'conflict'],
      description:
        'answers: the message answers one or more open questions. skip_all: the user wants to proceed with defaults ("just build it"). request_change: the message materially changes/replaces the original request. conflict: the message contradicts an earlier answer or selection.',
    },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionId'],
        properties: {
          questionId: { type: 'string' },
          optionId: { type: 'string', description: 'the matching option id, when the question has options' },
          text: { type: 'string', description: 'the answer text, for text questions' },
        },
      },
    },
    followUpQuestion: {
      type: 'string',
      description: 'conflict mode only: ONE targeted question that resolves the contradiction.',
    },
  },
} as const;

/**
 * Map free text typed while a round is open onto the round (D8): structured
 * answers are the fast path; this is the tolerant fallback. A material request
 * change supersedes the round; a detected contradiction yields ONE targeted
 * follow-up question instead of a silent pick (spec edge case). Interpretation
 * failure degrades to 'request_change' (re-analyze — the safe default).
 */
export async function interpretResponse(input: {
  text: string;
  questions: ValidationQuestion[];
  originalRequest: string;
  /** 008 (FR-001) — rendered recent conversation, so "the one we discussed" resolves. */
  conversationContext?: string;
  signal?: AbortSignal;
}): Promise<InterpretOutcome> {
  if (!llmAvailable()) return { kind: 'request_change' };
  const questionList = input.questions
    .map((q) => {
      const opts = q.options.map((o) => `      - ${o.id}: ${o.label}`).join('\n');
      return `  - ${q.id} (${q.kind}): ${q.prompt}${opts ? `\n${opts}` : ''}`;
    })
    .join('\n');
  try {
    const raw = await llmJson<unknown>({
      system: [
        'The assistant asked the user a set of clarification questions about their architecture',
        'request, and the user replied in free text instead of using the answer controls.',
        'Classify the reply and, when it answers questions, map it onto them using the exact',
        'question and option ids listed. Rules:',
        '- "just build it" / "use defaults" / "skip" → skip_all.',
        '- A reply that materially changes or replaces the ORIGINAL REQUEST → request_change.',
        '- A reply that contradicts one of its own answers or an earlier selection → conflict,',
        '  with ONE targeted followUpQuestion that resolves the contradiction.',
        '- Otherwise → answers, mapping only what the reply actually addresses.',
      ].join('\n'),
      user: [
        `Original request: ${input.originalRequest}`,
        input.conversationContext ? `Conversation so far:\n${input.conversationContext}` : '',
        `Open questions:\n${questionList}`,
        `User reply: ${input.text}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: INTERPRET_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 1024,
      role: 'interpret',
      signal: input.signal,
    });
    const p = asObj(raw);
    const mode = asStr(p.mode);
    if (mode === 'skip_all') return { kind: 'answers', answers: [], skipAll: true };
    if (mode === 'conflict') {
      const question = asStr(p.followUpQuestion);
      if (question) return { kind: 'followup', question };
      return { kind: 'request_change' };
    }
    if (mode === 'answers') {
      const valid = new Map(input.questions.map((q) => [q.id, q]));
      const answers: InteractionAnswer[] = asArray(p.answers).flatMap((item) => {
        const a = asObj(item);
        const questionId = asStr(a.questionId);
        const q = questionId ? valid.get(questionId) : undefined;
        if (!q) return [];
        const optionId = asStr(a.optionId);
        const text = asStr(a.text);
        if (optionId && !q.options.some((o) => o.id === optionId)) return [];
        if (!optionId && !text) return [];
        return [{ questionId: q.id, ...(optionId ? { optionId } : {}), ...(text ? { text } : {}) }];
      });
      // Nothing mapped → the reply wasn't really answers; re-analyze instead of guessing.
      if (answers.length === 0) return { kind: 'request_change' };
      return { kind: 'answers', answers, skipAll: false };
    }
    return { kind: 'request_change' };
  } catch (e) {
    console.error('[analyze] free-text interpretation failed, treating as a request change:', e);
    return { kind: 'request_change' };
  }
}
