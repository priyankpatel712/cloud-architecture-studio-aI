import 'server-only';
import { llmJson } from '@/lib/llm';

/**
 * Self-review call + verdict sanitizer (feature 004 FR-002; research R2).
 *
 * The evaluator half of the evaluator-optimizer loop: the reviewer sees the
 * APPLIED, PRICED result (not the raw plan) so it catches losses introduced by
 * sanitization/merging too. Verdicts are untrusted LLM output (NIM's
 * guided_json is not reliably enforced) — `sanitizeVerdict()` coerces the same
 * way `sanitizePlan()` does: non-boolean pass -> false, non-string entries
 * dropped, instructions truncated.
 *
 * Requirements-coverage extension (Anthropic "Building effective agents",
 * evaluator-optimizer: give the evaluator an explicit rubric, grade item by
 * item, and require quoted evidence): when the loop supplies the extracted
 * requirement checklist, the reviewer must return one coverage entry PER
 * requirement — met/unmet, the exact nodes/connections that satisfy it, and
 * what is missing — instead of a single holistic pass/fail. Coverage is
 * cross-checked code-side (an unmet entry can never coexist with pass:true),
 * so the per-item rubric is a hard gate, not advisory.
 */

export interface RequirementCoverage {
  /** the checklist item, restated verbatim */
  requirement: string;
  met: boolean;
  /** exact nodeIds/serviceIds/connections in the applied draft that satisfy it ('' when unmet) */
  evidence: string;
  /** what is missing or wrong when met=false ('' when met) */
  gap: string;
}

export interface ReviewVerdict {
  pass: boolean;
  unmetCapabilities: string[];
  refinementInstructions: string;
  /** per-requirement verdicts; empty when no checklist was supplied */
  coverage: RequirementCoverage[];
}

/** data-model.md ReviewVerdict rule: "instructions truncated". */
export const MAX_REFINEMENT_INSTRUCTIONS_LENGTH = 2000;

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'unmetCapabilities', 'refinementInstructions', 'coverage'],
  properties: {
    pass: {
      type: 'boolean',
      description:
        'true ONLY when every requirement in the checklist is met (every coverage entry has met=true), every explicitly requested capability is present, correctly connected, and priced, AND preserve-user-work was honored (no untouched node was changed).',
    },
    unmetCapabilities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Plain-language names of requested capabilities the draft is still missing. Empty when pass is true.',
    },
    refinementInstructions: {
      type: 'string',
      description: 'Concrete instructions for the next draft pass to close the gaps above. Empty when pass is true.',
    },
    coverage: {
      type: 'array',
      description:
        'EXACTLY one entry per requirement in the checklist, in the same order. Grade each independently against the applied architecture.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'met', 'evidence', 'gap'],
        properties: {
          requirement: { type: 'string', description: 'the checklist item, restated verbatim' },
          met: { type: 'boolean', description: 'true only when the applied architecture demonstrably satisfies this requirement' },
          evidence: {
            type: 'string',
            description: 'the exact nodeIds/serviceIds and connections that satisfy it, quoted from the applied architecture; empty when met=false',
          },
          gap: { type: 'string', description: 'what is missing or mis-connected; empty when met=true' },
        },
      },
    },
  },
} as const;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Coerce untrusted LLM output into a safe ReviewVerdict (data-model.md rules). */
export function sanitizeVerdict(raw: unknown): ReviewVerdict {
  const p = asObj(raw);
  const pass = p.pass === true;
  const unmetCapabilities = Array.isArray(p.unmetCapabilities)
    ? p.unmetCapabilities.filter((x): x is string => typeof x === 'string')
    : [];
  const rawInstructions = typeof p.refinementInstructions === 'string' ? p.refinementInstructions : '';
  const refinementInstructions =
    rawInstructions.length > MAX_REFINEMENT_INSTRUCTIONS_LENGTH
      ? rawInstructions.slice(0, MAX_REFINEMENT_INSTRUCTIONS_LENGTH)
      : rawInstructions;
  const coverage = (Array.isArray(p.coverage) ? p.coverage : []).flatMap((item): RequirementCoverage[] => {
    const c = asObj(item);
    const requirement = typeof c.requirement === 'string' ? c.requirement.trim() : '';
    if (!requirement) return [];
    return [{
      requirement,
      met: c.met === true,
      evidence: typeof c.evidence === 'string' ? c.evidence : '',
      gap: typeof c.gap === 'string' ? c.gap : '',
    }];
  });
  return { pass, unmetCapabilities, refinementInstructions, coverage };
}

export interface ReviewInput {
  /** the original user request, verbatim */
  requestText: string;
  /** the applied, priced architecture, rendered as the same prompt shape the planner sees */
  architectureSummary: string;
  /** official MCP guidance gathered this turn, if any */
  mcpGuidance: string[];
  /**
   * 008 FR-019 — the same house rules the planner was given. Graded here too:
   * a rule that is applied but never checked quietly stops being followed, and
   * the store's confidence lifecycle depends on knowing whether a rule helped.
   */
  knowledgeBlock?: string;
  /** structural-validation gaps (research R6) — always fed in as auto-unmet capabilities */
  validationGaps: string[];
  /** nodeIds the request may touch (research R7); empty means unrestricted (e.g. empty canvas) */
  changeScope: string[];
  /**
   * Requirements checklist extracted by the understand phase (or the guided
   * brief) — the rubric the reviewer grades item by item. Empty = no checklist
   * available; the reviewer falls back to holistic capability checking.
   */
  requirementChecklist?: string[];
  /**
   * 006 FR-008 — serviceIds the user explicitly selected in the clarify round.
   * A hard gate like validationGaps: a missing selection forces pass:false
   * regardless of the model's verdict.
   */
  requiredServiceIds?: string[];
  /** serviceIds present in the applied draft — the required-services gate checks against these */
  presentServiceIds?: string[];
  /**
   * 008 FR-040 — a secondary external opinion on topology, e.g. from the
   * optional diagram MCP. ADVISORY: it informs the reviewer's own judgement and
   * can never by itself force a verdict, unlike validationGaps. Absent on
   * almost every turn (the rung is off by default).
   */
  advisoryNotes?: string[];
  signal?: AbortSignal;
}

/**
 * Evaluate the applied draft against (a) the extracted requirement checklist,
 * item by item, (b) the gathered official guidance, (c) preserve-user-work
 * (FR-002). The structural-validation gaps are ALWAYS appended to
 * unmetCapabilities and force `pass: false` regardless of what the model says —
 * validation is a hard gate, not advisory (research R6). Likewise, a coverage
 * entry the model itself marked unmet can never coexist with pass:true.
 */
export async function reviewDraft(input: ReviewInput): Promise<ReviewVerdict> {
  const checklist = (input.requirementChecklist ?? []).filter((r) => r.trim().length > 0);
  const advisory = (input.advisoryNotes ?? []).filter((n) => n.trim().length > 0);
  const raw = await llmJson<unknown>({
    system: [
      'You are the quality reviewer for a cloud architecture design. You do not edit the',
      'architecture — you evaluate the just-applied draft and report a verdict.',
      'Check, in order:',
      checklist.length > 0
        ? '1. REQUIREMENTS COVERAGE: grade EVERY item of the requirements checklist below, one'
        : '1. Every capability the user explicitly asked for is present, using a real service,',
      checklist.length > 0
        ? '   coverage entry per item in the same order. An item is met ONLY when the applied'
        : '   correctly connected to what it needs to talk to.',
      ...(checklist.length > 0
        ? [
            '   architecture demonstrably provides it: cite the exact nodeIds/serviceIds and the',
            '   connections that satisfy it as evidence. Do NOT give the draft the benefit of the',
            '   doubt — a requirement with no concrete evidence in the diagram is unmet; name the',
            '   missing service or connection in gap.',
          ]
        : []),
      '2. The design follows the official provider guidance supplied below where it applies.',
      '3. PRESERVE-USER-WORK: nothing outside the change scope listed below was altered. If the',
      "   scope is empty, the canvas started empty and this check doesn't apply.",
      '4. READABLE FLOW: every service participates in the flow — no isolated node the request',
      '   implies should be connected (e.g. a database no compute talks to, a queue nothing',
      '   consumes). Flag disconnected or wrongly-directed data flows as unmet.',
      'Set pass=true ONLY when all checks hold. Otherwise list the specific unmet capabilities in',
      'plain language and give concrete refinementInstructions for the next draft pass — reference',
      'exact services/connections to add or fix, not vague guidance.',
      // 008 FR-040 — say plainly what advisory means, in the same breath as the
      // hard gates, so the model does not silently promote a hint to a finding.
      advisory.length > 0
        ? 'An external tool has offered notes on the topology. They are ADVISORY: weigh them against\n   the architecture yourself, and never fail the draft on a note alone — only on a problem you\n   can see in the applied architecture and can name.'
        : '',
      input.changeScope.length > 0 ? `Change scope (only these existing nodeIds may be touched): ${input.changeScope.join(', ')}` : '',
      (input.requiredServiceIds?.length ?? 0) > 0
        ? `The user EXPLICITLY selected these services in the clarification round — each MUST be present: ${input.requiredServiceIds!.join(', ')}`
        : '',
    ].filter(Boolean).join('\n'),
    user: [
      `User request: ${input.requestText}`,
      checklist.length > 0
        ? `Requirements checklist (grade every item):\n${checklist.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '',
      input.mcpGuidance.length ? input.mcpGuidance.join('\n') : '(No official MCP guidance was available this turn.)',
      // 008 FR-019 — grade the stored house rules, not just the request.
      input.knowledgeBlock ?? '',
      `Applied architecture:\n${input.architectureSummary}`,
      input.validationGaps.length ? `Known structural problems (must be reflected as unmet): ${input.validationGaps.join('; ')}` : '',
      advisory.join('\n\n'),
    ].filter(Boolean).join('\n\n'),
    schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2048,
    role: 'review',
    signal: input.signal,
  });
  const verdict = sanitizeVerdict(raw);

  // Coverage consistency gate: an unmet coverage entry (by the model's own
  // grading) can never coexist with pass:true. When the model engaged with the
  // rubric but skipped items, the skipped ones surface as unverified rather
  // than assumed covered. A model that returned NO coverage at all (guided
  // decoding is not reliably enforced) falls back to the holistic verdict —
  // treating every item as unmet there would loop a non-compliant model to
  // budget exhaustion every turn.
  if (verdict.coverage.length > 0) {
    const gradedRequirements = new Set(verdict.coverage.map((c) => c.requirement.trim().toLowerCase()));
    const skipped = checklist.filter((r) => !gradedRequirements.has(r.trim().toLowerCase()));
    for (const r of skipped) {
      verdict.coverage.push({ requirement: r, met: false, evidence: '', gap: 'not verified by the reviewer this pass' });
    }
  }
  const unmetCoverage = verdict.coverage.filter((c) => !c.met);
  const coverageGaps = unmetCoverage
    .filter((c) => !verdict.unmetCapabilities.some((u) => u.trim().toLowerCase() === c.requirement.trim().toLowerCase()))
    .map((c) => (c.gap ? `${c.requirement} (${c.gap})` : c.requirement));

  // 006 FR-008 — selected-services gate: like validationGaps, a hard code-side
  // gate the model cannot overrule. A user-selected service missing from the
  // applied draft forces pass:false with a concrete refinement instruction.
  const present = new Set(input.presentServiceIds ?? []);
  const missingSelections = (input.requiredServiceIds ?? []).filter((id) => !present.has(id));

  const hardGaps = [
    ...coverageGaps,
    ...input.validationGaps,
    ...missingSelections.map((id) => `user-selected service ${id} is missing from the design`),
  ];
  if (hardGaps.length === 0) return verdict;
  return {
    pass: false,
    unmetCapabilities: [...verdict.unmetCapabilities, ...hardGaps],
    refinementInstructions:
      [
        verdict.refinementInstructions,
        unmetCoverage.length > 0 && !verdict.refinementInstructions
          ? `Cover the unmet requirements: ${unmetCoverage.map((c) => c.requirement).join('; ')}.`
          : '',
        missingSelections.length > 0 ? `Add the user-selected service(s) the design must use: ${missingSelections.join(', ')}.` : '',
        input.validationGaps.length > 0 && !verdict.refinementInstructions ? `Fix these structural problems: ${input.validationGaps.join('; ')}` : '',
      ].filter(Boolean).join(' ') || `Fix: ${hardGaps.join('; ')}`,
    coverage: verdict.coverage,
  };
}
