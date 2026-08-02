/**
 * Shared v2 trace emitter (feature 004, contracts/agentic-generation.md §1;
 * research R4; data-model.md TraceStep). One instance per turn: every phase,
 * lookup, review verdict, and refinement funnels through `step()`, which both
 * streams the live NDJSON event and accumulates a `done`/`failed` record for
 * the one-shot `GenerationRun` write at turn end (single source of truth — the
 * live stream and the persisted run come from the same emitter).
 *
 * Guarded emit: a step marked `running` is guaranteed a terminal record even if
 * the code path that would have closed it throws or returns early — `finalize()`
 * closes any still-open steps as `failed` so the trace is never missing a
 * terminal status (contract §1 "guaranteed even on client disconnect").
 *
 * No imports — pure and unit-testable in isolation (diff.ts/validate.ts style).
 */

/**
 * Every step kind the trace can emit, as a runtime list so the persisted enum in
 * models/GenerationRun.ts can be asserted against it (a kind present here but
 * missing there makes the whole run fail to persist, silently losing the turn's
 * trace — see trace-emitter-agents.test.ts).
 */
export const STEP_KINDS = [
  'understand',
  'lookup',
  'draft',
  'review',
  'refine',
  'layout',
  'price',
  'validate',
  'persist',
  'cost',
  // 006 — guided generation flow (analyze phase, pricing-option generation, final alignment pass)
  'analyze',
  'options',
  'finalize',
  // 008 — multi-agent steps. Each is a distinct agent whose work the user is
  // entitled to see (FR-034), so they are first-class step kinds rather than
  // detail strings hung off an existing phase:
  //   intent      — reference resolution on a follow-up ("which node is 'that lambda'?")
  //   direct-edit — deterministic fast-path edit applied without a design loop
  //   knowledge   — stored house rules / patterns / lessons retrieved and injected
  //   research    — web lookup against official docs when store and MCP both miss
  //   distill     — post-turn extraction of a reusable lesson
  'intent',
  'direct-edit',
  'knowledge',
  'research',
  'distill',
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

export type LiveStepStatus = 'running' | 'done' | 'failed';
export type TerminalStepStatus = 'done' | 'failed';

export interface TraceStepRecord {
  id: string;
  kind: StepKind;
  label: string;
  detail?: string;
  iteration: number;
  /** 1-based chunk index within this step's iteration (feature 005) — absent for a non-chunked step. */
  chunk?: number;
  status: TerminalStepStatus;
  startedAt: Date;
  endedAt: Date;
}

export type EmitFn = (event: Record<string, unknown>) => void;

/**
 * One model request observed during the turn (interpretability, 2026-08).
 * Mirrors lib/llm-observer.ts LlmCallEvent structurally — this module stays
 * import-free, so the shape is restated here rather than imported.
 */
export interface ModelCallEvent {
  phase: 'start' | 'end';
  role: string;
  provider: string;
  model: string;
  tier: string;
  status?: 'ok' | 'rate_limited' | 'error';
  latencyMs?: number;
}

/** A completed model call as persisted on GenerationRun.modelCalls. */
export interface TraceModelCallRecord {
  id: string;
  /** the trace step that was running when the call fired — '' when none was open */
  stepId: string;
  role: string;
  provider: string;
  model: string;
  tier: string;
  status: 'ok' | 'rate_limited' | 'error';
  latencyMs: number;
  at: Date;
}

/** Legacy 3/4-arg progress callback shape used by orchestrator.ts's phase functions. */
export type LegacyProgress = (id: string, label: string, status: LiveStepStatus, detail?: string) => void;

const MAX_DETAIL_LENGTH = 300;

function truncateDetail(detail: string | undefined): string | undefined {
  if (detail == null) return undefined;
  return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}

export interface TraceEmitter {
  /** Emit a step transition and, on a terminal status, record it for persistence. */
  step(id: string, kind: StepKind, iteration: number, label: string, status: LiveStepStatus, detail?: string, chunk?: number): void;
  /**
   * Adapter for orchestrator.ts's existing (id, label, status) progress calls.
   * A `chunk` (feature 005 — a chunk-planning round beyond the first within one
   * iteration's draft phase) tags the id/label so it renders as its own distinct
   * step ("part N") instead of upserting the bare id; omitted entirely for the
   * first/only round, so a single-chunk turn is byte-for-byte identical to 004.
   */
  legacyProgress(kind: StepKind, iteration: number, chunk?: number): LegacyProgress;
  /** Live diagram snapshot after a chunk/slice-group is applied (feature 005, contracts §1). */
  diagram(nodes: unknown[], edges: unknown[], containers: unknown[], iteration: number, chunk: number): void;
  /**
   * One LLM request lifecycle event (from lib/llm-observer.ts via the route).
   * 'start' streams a `model` event with status 'calling' — the live "currently
   * using provider/model" indicator — attributed to the step that is running
   * right now. 'end' streams the outcome and records the call for persistence,
   * so every fallback hop and rate-limit is visible live AND in the saved trace.
   */
  modelCall(e: ModelCallEvent): void;
  /** Close any steps left `running` as `failed` — guarantees a terminal status for every step. */
  finalize(): void;
  /** Accumulated terminal steps, in emission order — the GenerationRun.steps payload. */
  readonly steps: TraceStepRecord[];
  /** Accumulated completed model calls, in emission order — the GenerationRun.modelCalls payload. */
  readonly modelCalls: TraceModelCallRecord[];
}

export function createTraceEmitter(emit: EmitFn): TraceEmitter {
  const steps: TraceStepRecord[] = [];
  const open = new Map<string, { kind: StepKind; iteration: number; label: string; chunk?: number; startedAt: Date }>();
  const modelCalls: TraceModelCallRecord[] = [];
  // Calls announced ('start') but not yet resolved ('end'). Turns await each
  // completion before the next, so "most recent pending" pairing is exact.
  const pendingCalls: { id: string; stepId: string; role: string; provider: string; model: string; tier: string; startedAt: Date }[] = [];
  let callSeq = 0;

  /** The step that is running right now — where a model call gets attributed. */
  function currentStepId(): string {
    let last = '';
    for (const id of open.keys()) last = id;
    return last;
  }

  function step(id: string, kind: StepKind, iteration: number, label: string, status: LiveStepStatus, detail?: string, chunk?: number): void {
    const d = truncateDetail(detail);
    emit({
      type: 'step', id, kind, iteration, label, status,
      ...(chunk !== undefined ? { chunk } : {}),
      ...(d !== undefined ? { detail: d } : {}),
    });
    if (status === 'running') {
      open.set(id, { kind, iteration, label, chunk, startedAt: new Date() });
      return;
    }
    const openEntry = open.get(id);
    open.delete(id);
    steps.push({
      id,
      kind,
      label,
      iteration,
      status,
      startedAt: openEntry?.startedAt ?? new Date(),
      endedAt: new Date(),
      ...(chunk !== undefined ? { chunk } : {}),
      ...(d !== undefined ? { detail: d } : {}),
    });
  }

  function legacyProgress(kind: StepKind, iteration: number, chunk?: number): LegacyProgress {
    return (id, label, status, detail) =>
      step(
        chunk !== undefined ? `${id}:${iteration}.${chunk}` : id,
        kind,
        iteration,
        chunk !== undefined ? `${label} (part ${chunk})` : label,
        status,
        detail,
        chunk
      );
  }

  function diagram(nodes: unknown[], edges: unknown[], containers: unknown[], iteration: number, chunk: number): void {
    emit({ type: 'diagram', nodes, edges, containers, iteration, chunk });
  }

  function modelCall(e: ModelCallEvent): void {
    if (e.phase === 'start') {
      const entry = {
        id: `m${++callSeq}`,
        stepId: currentStepId(),
        role: e.role,
        provider: e.provider,
        model: e.model,
        tier: e.tier,
        startedAt: new Date(),
      };
      pendingCalls.push(entry);
      emit({
        type: 'model', id: entry.id, stepId: entry.stepId,
        role: e.role, provider: e.provider, model: e.model, tier: e.tier, status: 'calling',
      });
      return;
    }
    // 'end' — resolve the most recent matching pending call (calls are awaited
    // sequentially; the provider/model match guards against a stray mismatch).
    let idx = pendingCalls.length - 1;
    while (idx >= 0 && !(pendingCalls[idx].provider === e.provider && pendingCalls[idx].model === e.model)) idx--;
    const pending = idx >= 0 ? pendingCalls.splice(idx, 1)[0] : null;
    const record: TraceModelCallRecord = {
      id: pending?.id ?? `m${++callSeq}`,
      stepId: pending?.stepId ?? currentStepId(),
      role: e.role,
      provider: e.provider,
      model: e.model,
      tier: e.tier,
      status: e.status ?? 'error',
      latencyMs: e.latencyMs ?? 0,
      at: new Date(),
    };
    modelCalls.push(record);
    emit({
      type: 'model', id: record.id, stepId: record.stepId,
      role: record.role, provider: record.provider, model: record.model, tier: record.tier,
      status: record.status, latencyMs: record.latencyMs,
    });
  }

  function finalize(): void {
    // A call that never resolved means the turn died mid-flight (abort/crash)
    // — record it as an error rather than losing it from the persisted trace.
    for (const p of pendingCalls) {
      modelCalls.push({
        id: p.id, stepId: p.stepId, role: p.role, provider: p.provider, model: p.model, tier: p.tier,
        status: 'error', latencyMs: Date.now() - p.startedAt.getTime(), at: new Date(),
      });
    }
    pendingCalls.length = 0;
    for (const [id, entry] of open) {
      steps.push({
        id,
        kind: entry.kind,
        label: entry.label,
        iteration: entry.iteration,
        status: 'failed',
        startedAt: entry.startedAt,
        endedAt: new Date(),
        ...(entry.chunk !== undefined ? { chunk: entry.chunk } : {}),
      });
    }
    open.clear();
  }

  return { step, legacyProgress, diagram, modelCall, finalize, steps, modelCalls };
}
