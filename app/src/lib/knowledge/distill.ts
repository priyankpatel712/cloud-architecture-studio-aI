import 'server-only';
import { llmAvailable, llmJson, LlmAbortError } from '@/lib/llm';
import { isProjectSpecific, type KnowledgeEntryInput } from '@/lib/knowledge/types';
import type { ProviderId } from '@/lib/providers/types';
import type { DesignMode } from '@/lib/generate/router';

/**
 * Lesson distiller (feature 008 US3, FR-020/FR-021;
 * contracts/agent-interfaces.md §6).
 *
 * WHY THIS MOMENT
 * When the self-review rejects a draft and a refinement then fixes it, the
 * system has already established both that something was wrong AND what
 * corrected it. No additional judgement is needed — which is exactly why this
 * pair, and not every turn, is the signal worth learning from. Distilling from
 * every turn would fill the store with noise and crowd the six injection slots.
 *
 * WHY POST-TURN
 * The lesson benefits FUTURE turns only, so it must never sit on the current
 * turn's latency budget. It runs after the result is persisted and streamed.
 *
 * PRIVACY (FR-021)
 * The prompt asks for a general lesson, but a prompt is a request, not a
 * guarantee. `isProjectSpecific` rejects anything carrying node ids, quoted user
 * text, URLs, emails, or ObjectIds BEFORE storage — a lesson that never contains
 * project data cannot leak it later.
 */

const DISTILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['generalizable', 'title', 'lesson', 'keywords'],
  properties: {
    generalizable: {
      type: 'boolean',
      description: 'False when this correction was specific to one request and teaches nothing reusable.',
    },
    title: { type: 'string', description: 'Short rule name, under 12 words.' },
    lesson: {
      type: 'string',
      description:
        'One or two sentences stating the general rule, phrased so a reviewer can check a future diagram against it. No project names, no quoted user text, no ids.',
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description: 'Request words that should trigger this rule in future (lowercase).',
    },
  },
} as const;

export interface DistillInput {
  /** What the reviewer flagged as missing or wrong. */
  reviewGap: string;
  /** What the refinement changed to fix it. */
  refinementFix: string;
  provider: ProviderId | 'any';
  designMode: DesignMode | 'any';
  signal?: AbortSignal;
}

/**
 * Turn one (gap → fix) pair into a reusable rule, or null when it teaches
 * nothing general. Never throws to the caller except on user stop.
 */
export async function distillLesson(input: DistillInput): Promise<KnowledgeEntryInput | null> {
  if (!llmAvailable()) return null;
  try {
    const raw = await llmJson<{
      generalizable?: unknown;
      title?: unknown;
      lesson?: unknown;
      keywords?: unknown;
    }>({
      role: 'distill',
      system: [
        'A cloud-architecture assistant reviewed its own draft, found a problem, and fixed it.',
        'Extract the GENERAL lesson so the same mistake is avoided first time in future.',
        '',
        'Rules:',
        '- The lesson must apply to ANY future request of this kind, not just this one.',
        '- NEVER include project names, user-specific wording, quoted text, ids, URLs, or numbers',
        '  taken from the request.',
        '- If the correction was a one-off with nothing reusable, set generalizable=false.',
        '- keywords: the words in a future request that should bring this rule to mind.',
        '',
        'Good: "When a request mentions real-time notifications, include a push or streaming path."',
        'Bad:  "The Acme billing project was missing SNS between n4 and n7."',
      ].join('\n'),
      user: [
        `The review found: ${input.reviewGap}`,
        `The fix was: ${input.refinementFix}`,
      ].join('\n\n'),
      schema: DISTILL_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 400,
      signal: input.signal,
    });

    if (raw?.generalizable === false) return null;
    const lesson = typeof raw?.lesson === 'string' ? raw.lesson.trim() : '';
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!lesson || !title) return null;

    // Enforced, not merely requested (FR-021).
    if (isProjectSpecific(lesson) || isProjectSpecific(title)) {
      console.warn('[knowledge] distilled lesson rejected: project-specific content');
      return null;
    }

    const keywords = Array.isArray(raw?.keywords)
      ? raw.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.toLowerCase().trim())
      : [];
    if (keywords.length === 0) return null;

    return {
      kind: 'lesson',
      provider: input.provider,
      designMode: input.designMode,
      title: title.slice(0, 120),
      content: lesson.slice(0, 600),
      keywords,
      source: 'learned',
      // Starts unproven: it must be injected into passing turns to earn its
      // place, and decays out of retrieval if it never does.
      confidence: 0.6,
    };
  } catch (e) {
    if (e instanceof LlmAbortError) return null;
    console.error('[knowledge] distillation failed:', e);
    return null;
  }
}
