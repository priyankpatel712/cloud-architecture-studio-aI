/**
 * Guided-flow domain module (feature 006 — data-model.md §1–2/§4, contracts
 * guided-flow-protocol.md). Pure and dependency-free (validate.ts style): the
 * types below are the canonical vocabulary for the flow state machine, and the
 * helpers implement answer resolution, brief merging, and round lifecycle —
 * all deterministically, so every transition is unit-testable without mocks.
 *
 * Server-only concerns live elsewhere by design: the analyze/interpret LLM
 * calls in analyze.ts, pricing-option generation in cost-options.ts, and the
 * turn routing in the messages route. This module never talks to a model or
 * the database.
 */

export type RequestClass = 'new' | 'major_revision' | 'small_edit';
export type AwaitingKind = 'clarify' | 'cost_questions' | 'cost_options';
export type InteractionKind = AwaitingKind;
export type InteractionStatus = 'open' | 'answered' | 'skipped' | 'superseded';
export type QuestionKind = 'text' | 'single_select' | 'service_choice';

export interface QuestionOption {
  id: string;
  label: string;
  /** one-line trade-off (FR-003) */
  detail: string;
  /** service_choice only — catalog-validated */
  serviceId?: string;
  recommended: boolean;
}

export interface QuestionResolution {
  kind: 'answered' | 'skipped';
  optionId?: string;
  text?: string;
}

export interface ValidationQuestion {
  id: string;
  prompt: string;
  /** which gap it closes (FR-002) */
  why: string;
  kind: QuestionKind;
  /** service_choice only — the need the choice resolves */
  need?: string;
  options: QuestionOption[];
  skippable: true;
  resolution?: QuestionResolution;
}

export interface PricedLine {
  nodeId: string;
  serviceId: string;
  cost: number;
  basis: 'exact' | 'indicative';
}

export interface PricingOption {
  id: string;
  label: string;
  summary: string;
  /** engine-priced (priceNodes), never LLM-generated */
  monthly: number;
  indicative: boolean;
  perService: PricedLine[];
  /** full replacement config per touched node (clamped pre-pricing); never structural */
  patches: { nodeId: string; config: Record<string, string | number> }[];
  degraded: boolean;
}

export interface Interaction {
  id: string;
  kind: InteractionKind;
  status: InteractionStatus;
  questions: ValidationQuestion[];
  options: PricingOption[];
}

/**
 * 008 (FR-002) — a requirement's standing across the whole conversation.
 * 'pending' is stated but not yet verified as built; 'met' was graded as
 * covered; 'withdrawn' means the USER dropped it. Only an explicit withdrawal
 * removes a requirement from grading — a requirement simply not restated in a
 * later turn stays live.
 */
export type CapabilityStatus = 'met' | 'pending' | 'withdrawn';

export interface BriefCapability {
  id?: string;
  text: string;
  source?: 'stated' | 'inferred';
  /** 008 — carried across turns so earlier requirements keep being graded. */
  status?: CapabilityStatus;
  /** 008 — turn index where this requirement first appeared. */
  firstSeenTurn?: number;
}

export interface RequirementBrief {
  requestText: string;
  requestClass: RequestClass;
  capabilities: BriefCapability[];
  scaleAssumptions: { key: string; value: string; source: 'stated' | 'answered' | 'defaulted' }[];
  constraints: string[];
  /** existing nodeIds the request targets (preserve-user-work scope) */
  changeScope: string[];
  /** explicit service choices — build MUSTs (FR-008) */
  selections: { questionId: string; need: string; serviceId: string }[];
  /** disclosed in the assistant reply on skip (FR-004) */
  defaultsApplied: string[];
}

/**
 * The shape mergeBrief operates on. `scaleAssumptions` is optional so callers
 * and tests can merge a partial brief without restating fields the merge does
 * not touch.
 */
export type MergeableBrief = Omit<RequirementBrief, 'scaleAssumptions'> &
  Partial<Pick<RequirementBrief, 'scaleAssumptions'>>;

/** Requirements are matched across turns on normalized text, not on generated ids. */
function requirementKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 008 (FR-002) — merge a newly-analyzed brief into the conversation's running
 * ledger.
 *
 * ROOT CAUSE THIS FIXES (R3): `runAnalyzeTurn` previously replaced `flow.brief`
 * wholesale on every turn. A requirement stated in turn 1 ("multi-region DR")
 * vanished from the reviewer's rubric as soon as turn 2 was analyzed, so a later
 * draft could silently drop it and still pass review. Retention is therefore the
 * default and removal requires an explicit act.
 *
 * - capabilities: unioned by normalized text; `firstSeenTurn` and a 'met' status
 *   survive; entries absent from `next` are RETAINED
 * - withdrawn: only ids/texts named in `opts.withdrawn` are marked withdrawn,
 *   and asking for one again revives it
 * - selections: carried forward, superseded per `questionId` by newer choices
 * - constraints: unioned; requestText/requestClass/changeScope: newest wins,
 *   because scope is a property of the current turn, not of the conversation
 */
export function mergeBrief(
  prev: MergeableBrief | null | undefined,
  next: MergeableBrief,
  turn: number,
  opts: { withdrawn?: string[] } = {}
): MergeableBrief {
  const withdrawn = new Set((opts.withdrawn ?? []).map(requirementKey));

  const merged = new Map<string, BriefCapability>();
  for (const cap of prev?.capabilities ?? []) {
    merged.set(requirementKey(cap.text), {
      ...cap,
      status: cap.status ?? 'pending',
      firstSeenTurn: cap.firstSeenTurn ?? turn,
    });
  }
  for (const cap of next.capabilities ?? []) {
    const key = requirementKey(cap.text);
    const existing = merged.get(key);
    if (existing) {
      // Restating a requirement revives it if it had been withdrawn, but must
      // not downgrade one already graded as met.
      merged.set(key, {
        ...existing,
        ...cap,
        status: existing.status === 'met' ? 'met' : 'pending',
        firstSeenTurn: existing.firstSeenTurn,
      });
    } else {
      merged.set(key, { ...cap, status: cap.status ?? 'pending', firstSeenTurn: turn });
    }
  }
  for (const key of withdrawn) {
    const existing = merged.get(key);
    if (existing) merged.set(key, { ...existing, status: 'withdrawn' });
  }

  const selections = new Map<string, RequirementBrief['selections'][number]>();
  for (const sel of prev?.selections ?? []) selections.set(sel.questionId, sel);
  for (const sel of next.selections ?? []) selections.set(sel.questionId, sel);

  return {
    ...next,
    requestText: next.requestText,
    requestClass: next.requestClass,
    capabilities: [...merged.values()],
    constraints: [...new Set([...(prev?.constraints ?? []), ...(next.constraints ?? [])])],
    changeScope: next.changeScope ?? [],
    selections: [...selections.values()],
    defaultsApplied: [...new Set([...(prev?.defaultsApplied ?? []), ...(next.defaultsApplied ?? [])])],
    ...(next.scaleAssumptions || prev?.scaleAssumptions
      ? { scaleAssumptions: next.scaleAssumptions ?? prev?.scaleAssumptions ?? [] }
      : {}),
  };
}

/**
 * The grading rubric for a turn: every requirement the user has not withdrawn,
 * including ones stated several turns ago (FR-002).
 */
export function activeRequirements(brief: MergeableBrief | null | undefined): string[] {
  return (brief?.capabilities ?? [])
    .filter((c) => c.status !== 'withdrawn')
    .map((c) => c.text)
    .filter((t) => t && t.trim());
}

/** Condensed brief context handed to the agent loop / planner prompt (T011/T012). */
export interface GuidedBriefContext {
  capabilities: string[];
  /** serviceIds the user explicitly selected — the draft MUST use these (FR-008) */
  selectedServiceIds: string[];
  /** user-approved defaults + answered scale assumptions, restated to the planner */
  assumptions: string[];
  changeScope: string[];
}

/** One per-question resolution submitted by the client (contracts §1). */
export interface InteractionAnswer {
  questionId: string;
  optionId?: string;
  text?: string;
  skipped?: boolean;
}

let interactionSeq = 0;
export function newInteractionId(): string {
  interactionSeq = (interactionSeq + 1) % 1000;
  return `ix${Date.now().toString(36)}${interactionSeq}`;
}

export function openInteraction(kind: InteractionKind, questions: ValidationQuestion[], options: PricingOption[] = []): Interaction {
  return { id: newInteractionId(), kind, status: 'open', questions, options };
}

/**
 * Validate a submitted response against the stored open round (contracts §1):
 * unknown questionId/optionId → the offending id, for a 422. `null` = valid.
 */
export function findInvalidAnswer(interaction: Interaction, answers: InteractionAnswer[]): string | null {
  const byId = new Map(interaction.questions.map((q) => [q.id, q]));
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) return `unknown questionId "${a.questionId}"`;
    if (a.optionId !== undefined && !q.options.some((o) => o.id === a.optionId)) {
      return `unknown optionId "${a.optionId}" for question "${a.questionId}"`;
    }
  }
  return null;
}

/**
 * Resolve a round in one shot (FR-004/FR-006): every question ends `answered`
 * or `skipped` — an unanswered question resolves as skipped (skip-all is just
 * the zero-answers case). Returns a NEW questions array; never mutates.
 */
export function resolveQuestions(questions: ValidationQuestion[], answers: InteractionAnswer[], skipAll: boolean): ValidationQuestion[] {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  return questions.map((q) => {
    const a = skipAll ? undefined : byQuestion.get(q.id);
    if (!a || a.skipped || (a.optionId === undefined && !(a.text ?? '').trim())) {
      return { ...q, resolution: { kind: 'skipped' } };
    }
    return {
      ...q,
      resolution: {
        kind: 'answered',
        ...(a.optionId !== undefined ? { optionId: a.optionId } : {}),
        ...(a.text?.trim() ? { text: a.text.trim() } : {}),
      },
    };
  });
}

/**
 * Fold a resolved clarify round into the brief (data-model.md §1):
 * - answered service_choice → an explicit selection (FR-008 MUST);
 * - skipped service_choice → the recommended candidate, disclosed as a default;
 * - answered text/single_select → an 'answered' scale assumption;
 * - skipped text/single_select → an MVP-scale default, disclosed (FR-004).
 * Returns a NEW brief; never mutates.
 */
export function mergeResolvedRound(brief: RequirementBrief, resolved: ValidationQuestion[]): RequirementBrief {
  const next: RequirementBrief = {
    ...brief,
    scaleAssumptions: [...brief.scaleAssumptions],
    selections: [...brief.selections],
    defaultsApplied: [...brief.defaultsApplied],
  };
  for (const q of resolved) {
    const r = q.resolution;
    if (!r) continue;
    if (q.kind === 'service_choice') {
      const chosen =
        r.kind === 'answered' && r.optionId
          ? q.options.find((o) => o.id === r.optionId)
          : (q.options.find((o) => o.recommended) ?? q.options[0]);
      if (chosen?.serviceId) {
        next.selections.push({ questionId: q.id, need: q.need ?? q.prompt, serviceId: chosen.serviceId });
        if (r.kind === 'skipped') {
          next.defaultsApplied.push(`Used the recommended ${chosen.label} for "${q.need ?? q.prompt}".`);
        }
      }
      continue;
    }
    if (r.kind === 'answered') {
      const answered = r.text ?? q.options.find((o) => o.id === r.optionId)?.label ?? '';
      next.scaleAssumptions.push({ key: q.prompt, value: answered, source: 'answered' });
    } else {
      next.scaleAssumptions.push({ key: q.prompt, value: 'MVP-scale default', source: 'defaulted' });
      next.defaultsApplied.push(`"${q.prompt}" — used a small MVP-scale default.`);
    }
  }
  return next;
}

/** Condense a brief into the planner/reviewer context (T011/T012). */
export function briefContext(brief: RequirementBrief): GuidedBriefContext {
  return {
    // 008 FR-002 — the CUMULATIVE ledger minus explicit withdrawals, so a
    // requirement stated several turns ago is still planned for and still
    // graded. Previously this was whatever the newest analysis happened to
    // re-extract, which is how turn-1 requirements silently stopped mattering.
    capabilities: activeRequirements(brief),
    selectedServiceIds: brief.selections.map((s) => s.serviceId),
    assumptions: [
      ...brief.scaleAssumptions.map((s) => `${s.key}: ${s.value}${s.source === 'defaulted' ? ' (defaulted)' : ''}`),
      ...brief.constraints,
    ],
    changeScope: [...brief.changeScope],
  };
}

/**
 * Human-readable one-liner for a pure interaction-response user message so the
 * thread reads sensibly (FR-006) when the user clicked options instead of typing.
 */
export function describeResponse(interaction: Interaction, answers: InteractionAnswer[], skipAll: boolean, selectedOptionId?: string): string {
  if (interaction.kind === 'cost_options') {
    if (selectedOptionId) {
      const opt = interaction.options.find((o) => o.id === selectedOptionId);
      return `Selected the ${opt?.label ?? selectedOptionId} option.`;
    }
    return 'Skipped the pricing options — keeping the current configuration.';
  }
  if (skipAll || answers.length === 0) return 'Skipped the questions — use defaults and continue.';
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const parts = interaction.questions.map((q) => {
    const a = byQuestion.get(q.id);
    if (!a || a.skipped) return `${q.prompt} → (skipped)`;
    const label = a.text?.trim() || q.options.find((o) => o.id === a.optionId)?.label || '(answered)';
    return `${q.prompt} → ${label}`;
  });
  return parts.join('\n');
}

/** Disclosure block for the reply when defaults were applied (FR-004). */
export function defaultsDisclosure(brief: RequirementBrief): string {
  if (brief.defaultsApplied.length === 0) return '';
  return `Defaults applied:\n${brief.defaultsApplied.map((d) => `- ${d}`).join('\n')}`;
}
