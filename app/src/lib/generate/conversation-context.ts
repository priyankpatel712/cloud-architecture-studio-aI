/**
 * Conversation context (feature 008 US1, FR-001; contracts/agent-interfaces.md).
 *
 * WHY THIS EXISTS
 * Before 008 the only stage that saw any conversation history was the router,
 * and it saw a 4-message, 300-char-each slice of `role === 'user'` text that it
 * threw away after routing. Analyze, plan, and review each received exactly one
 * message — the newest — plus a text render of the canvas. So the assistant
 * re-derived intent from scratch on every follow-up, with no idea what it had
 * just built or what the user had changed by hand. That is root cause R1/R2/R5
 * of "the LLM doesn't understand my modification requests".
 *
 * WHAT IT RENDERS
 * Three line kinds, oldest-first, inside a character budget:
 *   USER: <text>                        — what was asked
 *   ASSISTANT: applied <edits>          — what actually changed (not the prose)
 *   CANVAS EDIT (manual): <summary>     — what the user changed by hand
 *
 * The middle line is the interesting one: `editsApplied` is the factual record
 * of a turn, produced by diff.ts. Feeding that back instead of the assistant's
 * chatty reply keeps the block small and grounds the next turn in what is
 * actually on the canvas. The third line revives a channel that existed but was
 * never read — architecture/route.ts has always written "Direct canvas edit"
 * system messages *expressly* so follow-ups build on hand-edited diagrams, and
 * nothing consumed them.
 *
 * NOT injected into the reviewer: self-review grades the cumulative requirement
 * ledger (FR-002), not the transcript. Mixing conversational phrasing into an
 * objective rubric invites rewarding apparent responsiveness over real coverage.
 *
 * Pure and import-free — unit-testable in isolation, like diff.ts.
 */

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  text?: string;
  /** diff.ts summary of what this assistant turn changed. */
  editsApplied?: string[];
}

export interface ContextOptions {
  /** Hard ceiling on the rendered block. */
  maxChars?: number;
  /** Ceiling on how many messages are considered, newest-first. */
  maxTurns?: number;
}

/**
 * ~1.5k characters is roughly 20 turns of real conversation — enough for a
 * follow-up to resolve "that lambda" and recall earlier decisions, small enough
 * that it never competes with the catalog and guidance blocks for prompt space.
 */
export const CONTEXT_CHAR_BUDGET = 1500;

/** Cap on any single rendered line, so one pasted wall of text can't eat the budget. */
const MAX_LINE_LENGTH = 300;

/** Marker written by the direct-canvas-save path (architecture/route.ts). */
const CANVAS_EDIT_PREFIX = 'Direct canvas edit:';

const DEFAULT_MAX_TURNS = 40;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One transcript line, or null when the message carries nothing useful. */
function renderLine(message: ContextMessage): string | null {
  const text = (message.text ?? '').trim();

  if (message.role === 'user') {
    return text ? `USER: ${truncate(text, MAX_LINE_LENGTH)}` : null;
  }

  if (message.role === 'assistant') {
    // What changed beats what was said — see the module comment.
    const edits = (message.editsApplied ?? []).filter((e) => e && e.trim());
    if (edits.length > 0) return `ASSISTANT: applied ${truncate(edits.join(', '), MAX_LINE_LENGTH)}`;
    return text ? `ASSISTANT: ${truncate(text, MAX_LINE_LENGTH)}` : null;
  }

  // Only the canvas-edit system messages are conversation; everything else on
  // the system channel is bookkeeping the model must not read as instruction.
  if (text.startsWith(CANVAS_EDIT_PREFIX)) {
    const summary = text.slice(CANVAS_EDIT_PREFIX.length).trim();
    return summary ? `CANVAS EDIT (manual): ${truncate(summary, MAX_LINE_LENGTH)}` : null;
  }
  return null;
}

/**
 * Render recent conversation as a bounded, oldest-first block.
 *
 * Retention is newest-first — a modification request needs what just happened,
 * not how the thread opened — but output order is chronological so the model
 * reads the conversation forwards. Returns '' when nothing is renderable, and
 * callers should omit the whole prompt section in that case.
 */
export function buildConversationContext(
  messages: readonly ContextMessage[],
  opts: ContextOptions = {}
): string {
  const maxChars = opts.maxChars ?? CONTEXT_CHAR_BUDGET;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  if (maxChars <= 0) return '';

  const kept: string[] = [];
  let used = 0;

  // Walk backwards, accepting lines until the budget is spent, so the newest
  // turns are the ones that survive.
  const considered = messages.slice(-maxTurns);
  for (let i = considered.length - 1; i >= 0; i--) {
    const line = renderLine(considered[i]);
    if (!line) continue;
    // +1 for the newline joining it to what is already kept.
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > maxChars) {
      // The newest line alone may exceed the budget; keep a truncated form
      // rather than returning an empty block.
      if (kept.length === 0) kept.push(line.slice(0, maxChars));
      break;
    }
    kept.push(line);
    used += cost;
  }

  return kept.reverse().join('\n');
}
