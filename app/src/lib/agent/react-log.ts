/**
 * ReAct log (agentic-concepts: "ReAct — Reason + Act") — a structured record
 * of the loop's Thought → Action → Observation cycle.
 *
 * The agent loop has always alternated between acting (draft/layout/price) and
 * observing (validate/review), but its *reasoning* was invisible: nothing said
 * why an iteration was drafted the way it was, or what the loop concluded from
 * a review before refining. This log makes each of those moments explicit:
 *
 *   thought      — why the next action was chosen (the "Reason" half)
 *   action       — what is being done, naming the action group used
 *   observation  — what the result showed (review verdict, coverage %)
 *
 * Entries stream through the supplied sink as they are appended — agent-loop
 * hooks the sink into the trace emitter as 'reason' steps, so the transcript
 * is live in the working trace AND persisted on the GenerationRun with no
 * second bookkeeping path. The full entry list also rides on the loop result
 * for tests and interpretability.
 *
 * Pure — no imports, unit-testable in isolation.
 */

export type ReActPhase = 'thought' | 'action' | 'observation';

export interface ReActEntry {
  phase: ReActPhase;
  /** which agent (roster.ts label) produced the entry */
  agent: string;
  text: string;
  iteration: number;
}

export interface ReActLog {
  thought(agent: string, text: string, iteration: number): void;
  action(agent: string, text: string, iteration: number): void;
  observation(agent: string, text: string, iteration: number): void;
  readonly entries: readonly ReActEntry[];
  /** Compact multi-line render (docs/tests): "Thought[1] Architect: …" */
  render(maxChars?: number): string;
}

const MAX_ENTRY_TEXT = 280;

const PHASE_LABEL: Record<ReActPhase, string> = {
  thought: 'Thought',
  action: 'Action',
  observation: 'Observation',
};

export function createReActLog(sink?: (entry: ReActEntry, index: number) => void): ReActLog {
  const entries: ReActEntry[] = [];

  const append = (phase: ReActPhase) => (agent: string, text: string, iteration: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: ReActEntry = {
      phase,
      agent,
      text: trimmed.length > MAX_ENTRY_TEXT ? `${trimmed.slice(0, MAX_ENTRY_TEXT)}…` : trimmed,
      iteration: Math.max(1, Math.floor(iteration)),
    };
    entries.push(entry);
    sink?.(entry, entries.length - 1);
  };

  return {
    thought: append('thought'),
    action: append('action'),
    observation: append('observation'),
    entries,
    render(maxChars = 2000): string {
      const lines = entries.map((e) => `${PHASE_LABEL[e.phase]}[${e.iteration}] ${e.agent}: ${e.text}`);
      const out: string[] = [];
      let used = 0;
      for (const line of lines) {
        const cost = line.length + (out.length > 0 ? 1 : 0);
        if (used + cost > maxChars) break;
        out.push(line);
        used += cost;
      }
      return out.join('\n');
    },
  };
}
