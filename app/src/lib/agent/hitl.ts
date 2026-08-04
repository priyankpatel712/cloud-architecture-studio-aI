/**
 * Human-in-the-loop checkpoints (agentic-concepts: "HITL") — the predefined
 * stages where the pipeline pauses and asks the human before proceeding.
 *
 * Two checkpoints exist, chosen because each guards a decision the AI must
 * never make alone:
 *
 *   destructive_change — the accepted draft would REMOVE a meaningful share of
 *     the user's existing diagram. The turn ends with the draft held in
 *     `flow.pendingApply` (nothing persisted) and an approval round open; the
 *     user's next message applies or discards it. Complements the guided
 *     clarify/cost rounds (006), which are HITL before and after the build —
 *     this one is HITL at the apply boundary itself.
 *
 *   low_coverage — the loop exhausted its budget below the coverage acceptance
 *     floor (coverage.ts). The best-effort draft IS delivered (visible work
 *     beats an empty canvas), but the reply must ask the human how to proceed
 *     rather than presenting the result as done.
 *
 * Decision logic is pure and deterministic so every trigger is unit-testable;
 * the conversational wiring (round persistence, apply/discard) lives in the
 * chat messages route.
 */

import type { ValidationQuestion } from '@/lib/generate/flow';

export type HitlKind = 'destructive_change' | 'low_coverage';

export interface HitlCheckpoint {
  kind: HitlKind;
  /** one-line machine-ish summary, used in trace details and session memory */
  reason: string;
  /** the question put to the human */
  prompt: string;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Absolute removal count that always requires approval. Default 3 — one or two
 * removals are routine refactors ("replace RDS with Aurora"); three or more is
 * a teardown the user should sign off on.
 */
export const DESTRUCTIVE_REMOVAL_THRESHOLD = intEnv('AGENT_HITL_REMOVAL_THRESHOLD', 3);

interface NodeRef {
  nodeId: string;
  serviceId?: string;
  displayName?: string;
}

function nodeName(n: NodeRef): string {
  return n.displayName?.trim() || n.serviceId || n.nodeId;
}

/**
 * Approval checkpoint for a draft that removes existing services: triggers at
 * ≥ DESTRUCTIVE_REMOVAL_THRESHOLD removals, or when 2+ removals take out a
 * STRICT majority of the canvas (so "delete both my services" on a 2-node
 * canvas is caught even though 2 < 3, while replacing 1 of 2 stays a routine
 * refactor). Additive and config-only changes never trigger — asking
 * permission to do exactly what was asked would make the checkpoint noise,
 * and noise gets skipped.
 */
export function destructiveChangeCheckpoint(
  before: readonly NodeRef[],
  after: readonly { nodeId: string }[]
): HitlCheckpoint | null {
  if (before.length === 0) return null;
  const surviving = new Set(after.map((n) => n.nodeId));
  const removed = before.filter((n) => !surviving.has(n.nodeId));
  const majority = removed.length >= 2 && removed.length * 2 > before.length;
  if (removed.length < DESTRUCTIVE_REMOVAL_THRESHOLD && !majority) return null;

  const names = removed.slice(0, 6).map(nodeName);
  const listed = names.join(', ') + (removed.length > names.length ? `, +${removed.length - names.length} more` : '');
  return {
    kind: 'destructive_change',
    reason: `would remove ${removed.length} of ${before.length} existing service(s): ${listed}`,
    prompt: `This change would remove ${removed.length} existing service${removed.length === 1 ? '' : 's'} from your diagram (${listed}). Should I apply it?`,
  };
}

/** Escalation for a best-effort result below the acceptance floor. */
export function lowCoverageCheckpoint(percent: number, targetPercent: number, unmet: readonly string[]): HitlCheckpoint | null {
  if (percent >= targetPercent) return null;
  const gaps = unmet.slice(0, 4).join('; ') || 'unspecified gaps';
  return {
    kind: 'low_coverage',
    reason: `coverage ${percent}% is below the ≥${targetPercent}% acceptance target (${gaps})`,
    prompt:
      `This design covers ${percent}% of your requirements — below my ${targetPercent}% acceptance target. ` +
      `Tell me how to proceed: answer the gaps above with more detail and I will refine, say "try again" for another pass, or say "keep it" to accept the design as-is.`,
  };
}

/**
 * The approval round put to the human for a destructive change, shaped as the
 * existing guided-flow question card (single_select) so the client renders it
 * with zero new UI. "Keep the current diagram" is the recommended default —
 * a skipped/ignored checkpoint must fail safe, never fail destructive.
 */
export function buildApprovalQuestion(checkpoint: HitlCheckpoint): ValidationQuestion {
  return {
    id: 'approval',
    prompt: checkpoint.prompt,
    why: 'Human approval checkpoint — I never apply a change that removes this much of your work without sign-off.',
    kind: 'single_select',
    options: [
      { id: 'approve', label: 'Yes — apply the change', detail: checkpoint.reason, recommended: false },
      { id: 'reject', label: 'No — keep the current diagram', detail: 'Nothing will be changed.', recommended: true },
    ],
    skippable: true,
  };
}

export type ApprovalDecision = 'approve' | 'reject' | 'unclear';

/** Structured answer → decision. Skip-all rejects: the safe default. */
export function decisionFromAnswers(
  answers: readonly { questionId: string; optionId?: string }[],
  skipAll: boolean
): ApprovalDecision {
  if (skipAll) return 'reject';
  const a = answers.find((x) => x.questionId === 'approval');
  if (a?.optionId === 'approve') return 'approve';
  if (a?.optionId === 'reject') return 'reject';
  return 'unclear';
}

/**
 * Free-text reply → decision. Deliberately conservative: anything that isn't a
 * clear yes/no reads as 'unclear', which the route treats as a new request
 * (superseding the checkpoint) rather than a guess either way.
 */
export function interpretApprovalReply(text: string): ApprovalDecision {
  const t = text.trim().toLowerCase();
  if (!t) return 'unclear';
  if (/^(no|nope|nah|cancel|reject|stop|don'?t|keep (it|the current|everything|my))\b/.test(t)) return 'reject';
  if (/\b(keep (the )?current|don'?t (apply|change|remove)|leave (it|the diagram))\b/.test(t)) return 'reject';
  if (/^(yes|yep|yeah|sure|ok(ay)?|apply|approve|go ahead|proceed|do it|confirm)\b/.test(t)) return 'approve';
  if (/\b(apply (it|the change)|go ahead|proceed)\b/.test(t)) return 'approve';
  return 'unclear';
}
