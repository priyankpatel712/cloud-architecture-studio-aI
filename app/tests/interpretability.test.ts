import { describe, expect, it } from 'vitest';
import { runWithLlmObserver, notifyLlmCall, type LlmCallEvent } from '@/lib/llm-observer';
import { createTraceEmitter, type ModelCallEvent } from '@/lib/generate/trace-emitter';
import { GenerationRun } from '@/lib/models/GenerationRun';

/**
 * Interpretability plumbing (2026-08): the observer that taps every llmJson
 * call, and the emitter that attributes each call to the trace step running at
 * the time. The contract that matters: what the user sees live ('model'
 * events) and what persists (GenerationRun.modelCalls) come from the same
 * records — a fallback hop or rate-limit can never be visible in one place
 * and missing from the other.
 */

const startEvent = (over: Partial<LlmCallEvent> = {}): LlmCallEvent => ({
  phase: 'start',
  role: 'plan',
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  tier: 'mid',
  ...over,
});

const endEvent = (over: Partial<LlmCallEvent> = {}): LlmCallEvent =>
  startEvent({ phase: 'end', status: 'ok', latencyMs: 1200, ...over });

describe('llm-observer', () => {
  it('delivers calls to the active observer and is a no-op outside one', async () => {
    const seen: LlmCallEvent[] = [];
    notifyLlmCall(startEvent()); // outside any context — must not throw, must not record
    await runWithLlmObserver(
      (e) => seen.push(e),
      async () => {
        notifyLlmCall(startEvent());
        await Promise.resolve(); // survives async hops (AsyncLocalStorage)
        notifyLlmCall(endEvent());
      }
    );
    notifyLlmCall(endEvent()); // after the context ends — dropped again
    expect(seen).toHaveLength(2);
    expect(seen[0].phase).toBe('start');
    expect(seen[1].status).toBe('ok');
  });

  it('keeps concurrent turns isolated — each observer sees only its own calls', async () => {
    const a: string[] = [];
    const b: string[] = [];
    await Promise.all([
      runWithLlmObserver(
        (e) => a.push(e.model),
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          notifyLlmCall(startEvent({ model: 'model-a' }));
        }
      ),
      runWithLlmObserver(
        (e) => b.push(e.model),
        async () => {
          notifyLlmCall(startEvent({ model: 'model-b' }));
        }
      ),
    ]);
    expect(a).toEqual(['model-a']);
    expect(b).toEqual(['model-b']);
  });

  it('an observer that throws never breaks the notifying call', () => {
    return runWithLlmObserver(
      () => {
        throw new Error('observer bug');
      },
      async () => {
        expect(() => notifyLlmCall(startEvent())).not.toThrow();
      }
    );
  });
});

describe('trace-emitter model calls', () => {
  const mc = (over: Partial<ModelCallEvent> = {}): ModelCallEvent => ({
    phase: 'start',
    role: 'plan',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    tier: 'mid',
    ...over,
  });

  it("attributes a call to the step running when it fired, and streams 'calling' then the outcome", () => {
    const events: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => events.push(e));
    emitter.step('draft:1', 'draft', 1, 'Drafting the architecture', 'running');
    emitter.modelCall(mc());
    emitter.modelCall(mc({ phase: 'end', status: 'ok', latencyMs: 900 }));
    emitter.step('draft:1', 'draft', 1, 'Drafting the architecture', 'done');

    const modelEvents = events.filter((e) => e.type === 'model');
    expect(modelEvents).toHaveLength(2);
    expect(modelEvents[0]).toMatchObject({ stepId: 'draft:1', status: 'calling', provider: 'groq' });
    expect(modelEvents[1]).toMatchObject({ stepId: 'draft:1', status: 'ok', latencyMs: 900 });
    // live event ids pair up — the UI upserts by id
    expect(modelEvents[0].id).toBe(modelEvents[1].id);

    expect(emitter.modelCalls).toHaveLength(1);
    expect(emitter.modelCalls[0]).toMatchObject({ stepId: 'draft:1', status: 'ok', role: 'plan', tier: 'mid' });
  });

  it('a rate-limited attempt and its fallback are two distinct visible calls', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('review:1', 'review', 1, 'Checking requirements coverage', 'running');
    emitter.modelCall(mc({ provider: 'groq' }));
    emitter.modelCall(mc({ phase: 'end', provider: 'groq', status: 'rate_limited', latencyMs: 300 }));
    emitter.modelCall(mc({ provider: 'huggingface', model: 'Llama-3.3-70B-Instruct' }));
    emitter.modelCall(mc({ phase: 'end', provider: 'huggingface', model: 'Llama-3.3-70B-Instruct', status: 'ok', latencyMs: 2000 }));

    expect(emitter.modelCalls).toHaveLength(2);
    expect(emitter.modelCalls[0]).toMatchObject({ provider: 'groq', status: 'rate_limited' });
    expect(emitter.modelCalls[1]).toMatchObject({ provider: 'huggingface', status: 'ok' });
  });

  it('a call with no open step still records (stepId empty) instead of being lost', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.modelCall(mc());
    emitter.modelCall(mc({ phase: 'end', status: 'ok', latencyMs: 100 }));
    expect(emitter.modelCalls[0].stepId).toBe('');
  });

  it('finalize records a never-resolved call as an error — the persisted trace is complete', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('draft:1', 'draft', 1, 'Drafting', 'running');
    emitter.modelCall(mc());
    emitter.finalize(); // turn died mid-call (abort/crash)
    expect(emitter.modelCalls).toHaveLength(1);
    expect(emitter.modelCalls[0].status).toBe('error');
  });

  it('persists only what the GenerationRun schema accepts (enum sync guard)', () => {
    // Same guard style as trace-emitter-agents.test.ts for step kinds: a
    // status the schema rejects would silently lose the whole run's trace.
    const modelCallsPath = GenerationRun.schema.path('modelCalls') as unknown as {
      schema: { path: (p: string) => { enumValues?: string[] } };
    };
    const statusEnum = modelCallsPath.schema.path('status').enumValues ?? [];
    for (const status of ['ok', 'rate_limited', 'error']) {
      expect(statusEnum, `GenerationRun.modelCalls.status must accept '${status}'`).toContain(status);
    }
    const tierEnum = modelCallsPath.schema.path('tier').enumValues ?? [];
    for (const tier of ['small', 'mid', 'large']) {
      expect(tierEnum, `GenerationRun.modelCalls.tier must accept '${tier}'`).toContain(tier);
    }
  });
});
