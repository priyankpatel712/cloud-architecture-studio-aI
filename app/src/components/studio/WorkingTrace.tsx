'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * WorkingTrace — the shared live/persisted step-trace renderer (feature 004
 * FR-005/FR-006/FR-012; contracts/agentic-generation.md §5). Mounted by
 * ChatPanel (live steps while `sending`, plus a collapsed toggle on persisted
 * assistant messages) and by the project-creation page (live steps for the
 * first generation, Clarification 2026-07-09) — the same live renderer on
 * every streaming surface, so no turn lacks a live trace (SC-002).
 *
 * Accessibility floor (FR-012/SC-007): reduced-motion disables the running
 * spinner's animation (state still changes instantly, just without motion);
 * the persisted toggle is a real <button> (native keyboard operability with
 * visible focus); a single polite aria-live region announces iteration
 * boundaries, step failures, and turn completion — never every step, to avoid
 * flooding assistive technology.
 */

export interface TraceStep {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  iteration: number;
  /** 005 — 1-based chunk-planning round within this iteration; absent for a non-chunked step. The
   * "(part N)" suffix is already baked into `label` server-side (trace-emitter.ts), so no client
   * formatting is needed here — this field is carried through for consumers that want it directly. */
  chunk?: number;
  status: 'running' | 'done' | 'failed';
}

/**
 * Interpretability (2026-08) — one model request attributed to a trace step:
 * which provider/model/tier actually served that part of the turn. 'calling'
 * exists only live (the request is in flight — this is the "currently using…"
 * indicator); persisted traces carry terminal statuses only.
 */
export interface TraceModelCall {
  id: string;
  stepId?: string;
  role?: string;
  provider: string;
  model: string;
  tier?: string;
  status: 'calling' | 'ok' | 'rate_limited' | 'error';
  latencyMs?: number;
}

function subscribeReducedMotion(callback: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}
function getReducedMotionSnapshot(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

/** Compact "provider · model" chip with tier + outcome — one per model request. */
function ModelChip({ call, reducedMotion }: Readonly<{ call: TraceModelCall; reducedMotion: boolean }>) {
  const style =
    call.status === 'calling'
      ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
      : call.status === 'ok'
        ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
        : call.status === 'rate_limited'
          ? 'bg-[#fef7e0] text-[#7a5900]'
          : 'bg-[#fcece9] text-[#8c1d18]';
  const outcome =
    call.status === 'calling' ? (
      <Loader2 size={9} className={cn('shrink-0', !reducedMotion && 'animate-spin')} />
    ) : call.status === 'ok' ? (
      <Check size={9} className="shrink-0" />
    ) : call.status === 'rate_limited' ? (
      <span className="shrink-0">rate-limited</span>
    ) : (
      <X size={9} className="shrink-0" />
    );
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-px font-mono text-[9px]', style)}
      title={`${call.role ? `${call.role} · ` : ''}${call.provider}/${call.model}${call.tier ? ` (${call.tier} tier)` : ''}${
        call.status === 'ok' && call.latencyMs ? ` — ${(call.latencyMs / 1000).toFixed(1)}s` : ''
      }${call.status === 'rate_limited' ? ' — rate-limited, trying the next connection' : ''}${
        call.status === 'error' ? ' — failed, trying the next connection' : ''
      }`}
    >
      <span className="truncate">
        {call.provider} · {call.model}
      </span>
      {call.tier && <span className="shrink-0 opacity-70">{call.tier}</span>}
      {outcome}
    </span>
  );
}

function StepRow({ step, reducedMotion }: Readonly<{ step: TraceStep; reducedMotion: boolean }>) {
  let icon: React.ReactNode;
  if (step.status === 'running') {
    icon = <Loader2 size={11} className={cn('mt-0.5 shrink-0 text-[var(--color-primary)]', !reducedMotion && 'animate-spin')} />;
  } else if (step.status === 'done') {
    icon = <Check size={11} className="mt-0.5 shrink-0 text-[#1e8e3e]" />;
  } else {
    icon = <X size={11} className="mt-0.5 shrink-0 text-[#8c1d18]" />;
  }
  return (
    <p className="flex items-start gap-2 pl-0.5 text-[11px] text-[var(--color-text-secondary)]">
      {icon}
      <span className={cn('min-w-0', step.status === 'done' && 'text-[var(--color-text-secondary)]/70')}>
        {step.label}
        {step.status === 'failed' && ' — failed (continuing where possible)'}
        {step.detail && <span className="block text-[10px] opacity-80">{step.detail}</span>}
      </span>
    </p>
  );
}

export function WorkingTrace({
  steps,
  modelCalls,
  heading,
  complete = false,
  completeMessage = 'Generation complete.',
  className,
}: Readonly<{
  steps: TraceStep[];
  /** model requests attributed to steps (interpretability) — chips under each step */
  modelCalls?: TraceModelCall[];
  /** e.g. "Working on it…" — omit for the persisted (already-labelled) view */
  heading?: string;
  /** true once the parent's stream has reached its terminal event — fires the completion announcement */
  complete?: boolean;
  completeMessage?: string;
  className?: string;
}>) {
  const reducedMotion = usePrefersReducedMotion();
  const [announcement, setAnnouncement] = useState('');
  const seenIterations = useRef(new Set<number>());
  const seenFailures = useRef(new Set<string>());
  const announcedComplete = useRef(false);

  useEffect(() => {
    // 005 FR-011/SC-004 — chunked draft steps share their iteration's `iteration`
    // number (only `chunk` differs), so `seenIterations` still keys on iteration
    // only: a multi-chunk iteration announces exactly once, same as a
    // single-chunk one — never a chunk-per-chunk announcement.
    for (const s of steps) {
      if (!seenIterations.current.has(s.iteration)) {
        seenIterations.current.add(s.iteration);
        setAnnouncement(s.iteration > 1 ? `Iteration ${s.iteration}` : 'Working on it');
      }
      if (s.status === 'failed' && !seenFailures.current.has(s.id)) {
        seenFailures.current.add(s.id);
        setAnnouncement(`${s.label} failed`);
      }
    }
  }, [steps]);

  useEffect(() => {
    if (complete && !announcedComplete.current) {
      announcedComplete.current = true;
      setAnnouncement(completeMessage);
    }
  }, [complete, completeMessage]);

  const groups = useMemo(() => {
    const map = new Map<number, TraceStep[]>();
    for (const s of steps) {
      if (!map.has(s.iteration)) map.set(s.iteration, []);
      map.get(s.iteration)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [steps]);

  // Interpretability: model requests grouped under the step they served.
  // Calls whose step never rendered (e.g. fired between steps) surface in a
  // trailing group rather than disappearing.
  const callsByStep = useMemo(() => {
    const map = new Map<string, TraceModelCall[]>();
    for (const c of modelCalls ?? []) {
      const key = c.stepId ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [modelCalls]);
  const renderedStepIds = useMemo(() => new Set(steps.map((s) => s.id)), [steps]);
  const orphanCalls = useMemo(
    () => [...callsByStep.entries()].filter(([stepId]) => !renderedStepIds.has(stepId)).flatMap(([, calls]) => calls),
    [callsByStep, renderedStepIds]
  );
  // The live "currently using …" indicator: the most recent in-flight request.
  const inFlight = [...(modelCalls ?? [])].reverse().find((c) => c.status === 'calling');

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      {heading && (
        <p className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-primary)]">
          <Loader2 size={13} className={cn('text-[var(--color-primary)]', !reducedMotion && 'animate-spin')} />
          {heading}
        </p>
      )}
      {inFlight && (
        <p className="flex items-center gap-1.5 pl-0.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
          Using {inFlight.provider} · {inFlight.model}
          {inFlight.tier && <span className="opacity-70">({inFlight.tier})</span>}
        </p>
      )}
      {groups.map(([iteration, groupSteps]) => (
        <div key={iteration}>
          {iteration >= 2 && (
            <p className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Iteration {iteration}
            </p>
          )}
          <div className="space-y-1">
            {groupSteps.map((s) => {
              const calls = callsByStep.get(s.id) ?? [];
              return (
                <div key={s.id}>
                  <StepRow step={s} reducedMotion={reducedMotion} />
                  {calls.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1 pl-5">
                      {calls.map((c) => (
                        <ModelChip key={c.id} call={c} reducedMotion={reducedMotion} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {orphanCalls.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-5">
          {orphanCalls.map((c) => (
            <ModelChip key={c.id} call={c} reducedMotion={reducedMotion} />
          ))}
        </div>
      )}
      {/* FR-012 — boundaries/failures/completion only, deliberately not every step */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

export function PersistedTrace({
  projectId,
  runId,
  iterations,
  stepCount,
}: Readonly<{
  projectId: string;
  runId: string;
  iterations: number;
  stepCount: number;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<TraceStep[] | null>(null);
  const [modelCalls, setModelCalls] = useState<TraceModelCall[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (steps || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat/runs/${runId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not load the working trace.');
      setSteps((data.steps ?? []) as TraceStep[]);
      setModelCalls((data.modelCalls ?? []) as TraceModelCall[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the working trace.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 rounded-full px-1 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] underline decoration-dotted underline-offset-2 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Show working ({stepCount} step{stepCount === 1 ? '' : 's'}, {iterations} iteration{iterations === 1 ? '' : 's'})
      </button>
      {expanded && (
        <div className="mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-[var(--color-surface-container-low)] p-2">
          <PersistedTraceBody loading={loading} error={error} steps={steps} modelCalls={modelCalls} />
        </div>
      )}
    </div>
  );
}

function PersistedTraceBody({
  loading,
  error,
  steps,
  modelCalls,
}: Readonly<{ loading: boolean; error: string | null; steps: TraceStep[] | null; modelCalls: TraceModelCall[] }>) {
  const reducedMotion = usePrefersReducedMotion();
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
        <Loader2 size={11} className={cn(!reducedMotion && 'animate-spin')} /> Loading…
      </p>
    );
  }
  if (error) {
    return <p className="text-[11px] text-[#8c1d18]">{error}</p>;
  }
  return <WorkingTrace steps={steps ?? []} modelCalls={modelCalls} />;
}
