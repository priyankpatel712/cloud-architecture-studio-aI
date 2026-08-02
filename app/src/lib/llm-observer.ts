import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-turn LLM call observer — the interpretability tap.
 *
 * llm.ts knows exactly which connection serves every completion (including
 * fallback hops and rate-limited attempts), but that knowledge previously went
 * only to the LlmUsage collection — invisible to the person watching a
 * generation. This observer closes the gap without threading a callback
 * through every call site: the chat route runs the whole turn inside
 * `runWithLlmObserver`, and every `llmJson` call anywhere below it — planner,
 * reviewer, router, knowledge, research — reports here automatically.
 *
 * AsyncLocalStorage keeps concurrent turns isolated: two users generating at
 * once each see only their own calls. Outside any observer context,
 * `notifyLlmCall` is a no-op — CLI scripts and background jobs pay nothing.
 *
 * An observer must never be able to fail a turn: notify swallows observer
 * exceptions.
 */

export interface LlmCallEvent {
  /** 'start' fires before the request is sent; 'end' after it resolves either way. */
  phase: 'start' | 'end';
  role: string;
  provider: string;
  model: string;
  tier: 'small' | 'mid' | 'large';
  /** end only */
  status?: 'ok' | 'rate_limited' | 'error';
  /** end only */
  latencyMs?: number;
}

const storage = new AsyncLocalStorage<(e: LlmCallEvent) => void>();

export function runWithLlmObserver<T>(observer: (e: LlmCallEvent) => void, fn: () => Promise<T>): Promise<T> {
  return storage.run(observer, fn);
}

export function notifyLlmCall(e: LlmCallEvent): void {
  try {
    storage.getStore()?.(e);
  } catch {
    /* an observer bug must never fail the call it observes */
  }
}
