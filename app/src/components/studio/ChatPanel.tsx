'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, DraftingCompass, Leaf, Lightbulb, Loader2, Send, Sparkles, TriangleAlert, RotateCcw, PencilRuler, Square, Check, SkipForward, BadgeCheck, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatUSD } from '@/lib/catalog';
import { EXAMPLE_PROMPTS } from '@/lib/example-prompts';
import { WorkingTrace, PersistedTrace, type TraceStep, type TraceModelCall } from './WorkingTrace';

/**
 * ChatPanel — the persistent per-project generation thread (US2, FR-014a–d).
 * Mounted on the creation page and beside the studio canvas; both surfaces talk
 * to the same AIConversation. Tool attachment is sticky per conversation
 * (Clarification 2026-07-06): chips reflect the server's activeTools and stay
 * attached across messages until toggled off. Shared users get a read-only view.
 *
 * 006 (contracts/guided-flow-protocol.md §5): assistant messages may carry a
 * structured `interaction` — a clarify/cost question round (QuestionRoundCard)
 * or the priced options (PricingOptionsCard). Cards are active only while
 * `flow.openInteractionId` matches; submitting posts an `interactionResponse`
 * alongside (optionally empty) text. The composer stays enabled while a round
 * is open — free text is a first-class answer path. Accessibility floor: all
 * card controls are native buttons/inputs (keyboard + visible focus), nothing
 * animates on arrival, and ONE polite live region announces each arriving
 * round (boundary-only policy from 004 — never per-option).
 */

export type ChatProviderId = 'aws' | 'mongodb' | 'system';

export interface ChatMcpCall {
  provider: ChatProviderId;
  tool: string;
  status: 'ok' | 'failed';
}

export interface ChatQuestionOption {
  id: string;
  label: string;
  detail?: string;
  serviceId?: string;
  recommended?: boolean;
}
export interface ChatQuestion {
  id: string;
  prompt: string;
  why?: string;
  kind: 'text' | 'single_select' | 'service_choice';
  need?: string;
  options?: ChatQuestionOption[];
  skippable?: boolean;
  resolution?: { kind: 'answered' | 'skipped'; optionId?: string; text?: string };
}
export interface ChatPricedLine {
  nodeId: string;
  serviceId: string;
  cost: number;
  basis: 'exact' | 'indicative';
}
export interface ChatPricingOption {
  id: string;
  label: string;
  summary?: string;
  monthly: number;
  indicative?: boolean;
  perService?: ChatPricedLine[];
  degraded?: boolean;
}
export interface ChatInteraction {
  id: string;
  kind: 'clarify' | 'cost_questions' | 'cost_options';
  status: 'open' | 'answered' | 'skipped' | 'superseded';
  questions?: ChatQuestion[];
  options?: ChatPricingOption[];
}
export interface ChatFlow {
  awaiting: 'clarify' | 'cost_questions' | 'cost_options' | 'approval' | null;
  /** Required: the active-round gate compares this against each message's
   * interaction id — every flow payload (GET and stream) must carry it. */
  openInteractionId: string | null;
  selectedOptionId?: string | null;
}
export interface ChatInteractionResponse {
  interactionId: string;
  answers: { questionId: string; optionId?: string; text?: string; skipped?: boolean }[];
  skipAll?: boolean;
  selectedOptionId?: string;
}

/** One requirement graded against the generated diagram (reviewer.ts RequirementCoverage). */
export interface ChatCoverageItem {
  requirement: string;
  met: boolean;
  evidence?: string;
  gap?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  attachedTools?: ChatProviderId[];
  mcpCalls?: ChatMcpCall[];
  editsApplied?: string[];
  indicative?: boolean;
  createdAt?: string;
  /** 004 — run summary (assistant messages only); absent on pre-004 messages */
  runId?: string;
  iterations?: number;
  converged?: boolean;
  stopped?: boolean;
  stepCount?: number;
  /** 006 — structured guided-flow round attached to this assistant message */
  interaction?: ChatInteraction;
  /** interpretability (2026-08) — per-requirement evaluation of the generated diagram */
  coverage?: ChatCoverageItem[];
}
export interface ChatArchitecture {
  nodes: unknown[];
  edges: unknown[];
  /** typed boundary containers (002 FR-005/007) — AI has full authority over these */
  containers?: unknown[];
  /** user notes/stickies (002 FR-014) — never touched by the AI */
  annotations?: unknown[];
  guidance: Record<string, string>;
  version: number;
}

const TOOL_META: Record<ChatProviderId, { label: string; accent: string; icon: React.ReactNode }> = {
  aws: { label: 'AWS', accent: '#FF9900', icon: <Cloud size={13} /> },
  mongodb: { label: 'Atlas', accent: '#00b34a', icon: <Leaf size={13} /> },
  system: { label: 'System', accent: '#6366F1', icon: <DraftingCompass size={13} /> },
};

export function ChatPanel({
  projectId,
  onArchitecture,
  onDiagram,
  refreshKey = 0,
  className,
}: {
  projectId: string;
  /** called whenever a turn changed the persisted architecture */
  onArchitecture?: (arch: ChatArchitecture, estimate: { monthly: number } | null) => void;
  /**
   * 005 — called after each chunk is applied mid-turn, with a FULL but not-yet-
   * persisted snapshot (no version/estimate — those only exist once the whole
   * turn completes). Lets the canvas build up progressively (FR-001/002).
   */
  onDiagram?: (nodes: unknown[], edges: unknown[], containers: unknown[]) => void;
  /** bump to refetch the thread — e.g. after a direct canvas save (FR-016a) */
  refreshKey?: number;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTools, setActiveTools] = useState<ChatProviderId[]>([]);
  const [canPost, setCanPost] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // 006 — guided-flow state: which round is open drives which card is active.
  const [flow, setFlow] = useState<ChatFlow | null>(null);
  // Example-brief picker in the composer — reachable even in non-empty threads.
  const [showExamples, setShowExamples] = useState(false);
  // 006 a11y — ONE polite live region announces each arriving round (boundary-only).
  const [roundAnnouncement, setRoundAnnouncement] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/chat`);
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load the conversation.');
        const data = await res.json();
        if (cancelled) return;
        setMessages(data.conversation.messages);
        setActiveTools(data.conversation.activeTools);
        setCanPost(data.canPost);
        setFlow(data.flow ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the conversation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [modelCalls, setModelCalls] = useState<TraceModelCall[]>([]);
  const [stopping, setStopping] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  const stopGeneration = useCallback(async () => {
    if (!sending || stopping) return;
    setStopping(true);
    try {
      await fetch(`/api/projects/${projectId}/chat/stop`, { method: 'POST' });
    } catch {
      /* best-effort — the stream's own terminal event still resolves the UI */
    }
  }, [projectId, sending, stopping]);

  const announceRound = (interaction: ChatInteraction) => {
    if (interaction.kind === 'cost_options') {
      setRoundAnnouncement('Pricing options are ready — choose one in the conversation.');
    } else {
      const n = interaction.questions?.length ?? 0;
      setRoundAnnouncement(`The assistant has ${n} question${n === 1 ? '' : 's'} for you.`);
    }
  };

  const send = useCallback(
    async (text: string, interactionResponse?: ChatInteractionResponse, displayText?: string) => {
      if ((!text.trim() && !interactionResponse) || sending) return;
      setError(null);
      setRetryText(null);
      setSending(true);
      setStopping(false);
      setJustFinished(false);
      setSteps([]);
      setModelCalls([]);
      setRoundAnnouncement('');
      setMessages((m) => [...m, { role: 'user', text: text.trim() || displayText || 'Sent answers.', attachedTools: activeTools }]);
      setInput('');
      // Optimistic: submitting a response closes the round locally; the server
      // result (or a reload) is the source of truth for the resolved card.
      if (interactionResponse) {
        setFlow((f) => (f ? { ...f, awaiting: null, openInteractionId: null } : f));
        setMessages((m) =>
          m.map((msg) =>
            msg.interaction?.id === interactionResponse.interactionId && msg.interaction.status === 'open'
              ? { ...msg, interaction: { ...msg.interaction, status: interactionResponse.skipAll ? 'skipped' : 'answered' } }
              : msg
          )
        );
      }

      // Step-aware failure display (003 contracts/generation-reliability.md):
      // configuration-cause failures (retryable: false) get the actionable
      // reason and NO retry button — retrying would repeat them.
      const showFailure = (data: { error?: string; retryable?: boolean; step?: string }) => {
        const stepLabel = data.step === 'cost' ? 'Cost estimation' : 'Generation';
        const base = data.error ?? `${stepLabel} failed. Please retry.`;
        if (data.retryable === false) {
          setError(`${base} This is a configuration issue — retrying won't help until it's fixed.`);
        } else {
          setError(base);
          setRetryText(text || null);
        }
      };
      const applyPayload = (payload: {
        message: ChatMessage;
        /**
         * 008 — explicitly nullable. `null` means "this turn changed nothing on
         * the canvas" (a question answered, a restore offered), NOT "clear the
         * canvas" (contracts/chat-stream-events.md).
         */
        architecture?: ChatArchitecture | null;
        estimate: { monthly: number } | null;
        /** Absent on turns that never touched conversation state. */
        conversation?: { activeTools: ChatProviderId[] };
        interaction?: ChatInteraction;
        flow?: ChatFlow | null;
        /** 008 — the reply is informational; never apply it to the canvas. */
        answeredOnly?: boolean;
      }) => {
        setMessages((m) => [...m, payload.message]);
        // Optional since 008: an answer-only turn carries no conversation block.
        if (payload.conversation) setActiveTools(payload.conversation.activeTools);
        if (payload.flow !== undefined) setFlow(payload.flow ?? null);
        if (payload.interaction) announceRound(payload.interaction);
        // 008 — an informational turn never reaches the canvas, even if a future
        // payload were to carry an architecture alongside the flag.
        if (payload.answeredOnly) return;
        if (payload.architecture && payload.estimate !== null && onArchitecture) {
          onArchitecture(payload.architecture, payload.estimate);
        }
      };

      try {
        const res = await fetch(`/api/projects/${projectId}/chat/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, attachedTools: activeTools, ...(interactionResponse ? { interactionResponse } : {}) }),
        });

        // Pre-stream failures (auth, validation, 409) are plain JSON.
        if (!(res.headers.get('content-type') ?? '').includes('ndjson')) {
          const data = await res.json();
          showFailure(data);
          return;
        }

        // Live NDJSON stream: step events render the AI-IDE-style progress list
        // grouped by iteration (WorkingTrace, 004 FR-005), then a single
        // terminal result/error/unsatisfiable/stopped event.
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handle = (event: Record<string, unknown>) => {
          if (event.type === 'step') {
            const s = event as unknown as TraceStep;
            setSteps((prev) => {
              const i = prev.findIndex((x) => x.id === s.id);
              if (i === -1) return [...prev, s];
              const next = [...prev];
              next[i] = { ...next[i], ...s };
              return next;
            });
            return;
          }
          if (event.type === 'model') {
            // Interpretability: one model request lifecycle — 'calling' first,
            // then the same id resolves to ok/rate_limited/error. Upsert by id.
            const c = event as unknown as TraceModelCall;
            setModelCalls((prev) => {
              const i = prev.findIndex((x) => x.id === c.id);
              if (i === -1) return [...prev, c];
              const next = [...prev];
              next[i] = { ...next[i], ...c };
              return next;
            });
            return;
          }
          if (event.type === 'diagram') {
            onDiagram?.(event.nodes as unknown[], event.edges as unknown[], event.containers as unknown[]);
            return;
          }
          if (event.type === 'result') {
            applyPayload(event.payload as Parameters<typeof applyPayload>[0]);
            return;
          }
          if (event.type === 'unsatisfiable') {
            const partial = event.partial as Parameters<typeof applyPayload>[0] | undefined;
            setMessages((m) => [...m, partial?.message ?? { role: 'assistant', text: String(event.error ?? '') }]);
            if (partial?.architecture && onArchitecture) onArchitecture(partial.architecture, partial.estimate ?? null);
            return;
          }
          if (event.type === 'stopped') {
            // 004 FR-009/SC-006 — append the "stopped" message; re-enable input immediately.
            const partial = event.partial as { message: ChatMessage } | undefined;
            if (partial?.message) setMessages((m) => [...m, partial.message]);
            return;
          }
          if (event.type === 'error') {
            // step:'cost' errors carry the successful architecture — apply it first.
            const partial = event.partial as Parameters<typeof applyPayload>[0] | undefined;
            if (partial) applyPayload(partial);
            showFailure(event as { error?: string; retryable?: boolean; step?: string });
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) handle(JSON.parse(line));
          }
        }
      } catch {
        setError('Could not reach the server. Please retry.');
        setRetryText(text || null);
      } finally {
        setSending(false);
        setStopping(false);
        // FR-012/SC-007 — keep the live trace mounted one extra tick with
        // complete=true so its polite aria-live region announces turn
        // completion, then hand off to the persisted message bubble's toggle.
        setJustFinished(true);
        setTimeout(() => {
          setJustFinished(false);
          setSteps([]);
          setModelCalls([]);
        }, 150);
      }
    },
    [projectId, activeTools, sending, onArchitecture, onDiagram]
  );

  const respond = useCallback(
    (interaction: ChatInteraction, response: Omit<ChatInteractionResponse, 'interactionId'>, displayText: string) => {
      send('', { interactionId: interaction.id, ...response }, displayText);
    },
    [send]
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* Thread */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <Loader2 size={13} className="animate-spin" /> Loading conversation…
          </p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
                <Sparkles size={18} />
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Describe your system in as much detail as you like — provider tools attach
                automatically, and follow-up messages refine the same architecture without
                starting over.
              </p>
            </div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Try a detailed example
            </p>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => setInput(ex.prompt)}
                title="Click to load this brief into the composer — edit it, then send"
                className="rounded-2xl border border-[var(--color-surface-variant)] p-3 text-left transition-all hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-container-low)]"
              >
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">{ex.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-secondary)]">{ex.tagline}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {ex.services.map((s) => (
                    <span
                      key={s}
                      className="rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              projectId={projectId}
              flow={flow}
              busy={sending || !canPost}
              onRespond={respond}
              onSendText={(t) => send(t)}
            />
          ))
        )}
        {(sending || justFinished) && (
          <div className="space-y-1.5 rounded-2xl bg-[var(--color-surface-container-low)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <WorkingTrace steps={steps} modelCalls={modelCalls} heading={sending ? 'Working on it…' : undefined} complete={justFinished} className="flex-1" />
              {sending && (
                <button
                  onClick={stopGeneration}
                  disabled={stopping}
                  aria-label="Stop generation"
                  className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-outline-variant)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-secondary)] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
                >
                  <Square size={10} />
                  {stopping ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </div>
            {steps.length === 0 && sending && (
              <p className="pl-0.5 text-[11px] text-[var(--color-text-secondary)]">
                Preparing {activeTools.map((t) => TOOL_META[t].label).join(' + ') || 'attached'} tools…
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-3 py-2 text-xs text-[#8c1d18]">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              {error}
              {retryText && (
                <button
                  onClick={() => send(retryText)}
                  className="mt-1 flex items-center gap-1 font-medium underline"
                >
                  <RotateCcw size={12} /> Retry
                </button>
              )}
            </div>
          </div>
        )}
        {/* 006 — round-arrival announcement (single polite region, boundary-only) */}
        <span className="sr-only" role="status" aria-live="polite">
          {roundAnnouncement}
        </span>
      </div>

      {/* Composer — stays enabled while a round is open (free text answers it) */}
      {canPost ? (
        <div className="border-t border-[var(--color-surface-variant)] p-3">
          {showExamples && (
            <div className="custom-scrollbar mb-2 max-h-56 overflow-y-auto rounded-2xl border border-[var(--color-surface-variant)]">
              <div className="flex items-center justify-between border-b border-[var(--color-surface-variant)] px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                  Detailed example briefs — click to load into the composer
                </span>
                <button
                  aria-label="Close examples"
                  onClick={() => setShowExamples(false)}
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
                >
                  <X size={12} />
                </button>
              </div>
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => {
                    setInput(ex.prompt);
                    setShowExamples(false);
                  }}
                  className="block w-full border-b border-[var(--color-surface-variant)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--color-surface-container-low)]"
                >
                  <p className="text-xs font-semibold text-[var(--color-text-primary)]">{ex.title}</p>
                  <p className="text-[11px] leading-snug text-[var(--color-text-secondary)]">{ex.tagline}</p>
                </button>
              ))}
            </div>
          )}
          <div className="mb-2 flex items-center gap-1.5">
            {(Object.keys(TOOL_META) as ChatProviderId[]).map((id) => {
              const active = activeTools.includes(id);
              return (
                <button
                  key={id}
                  onClick={() =>
                    setActiveTools((t) => (active ? t.filter((x) => x !== id) : [...t, id]))
                  }
                  aria-pressed={active}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-all',
                    active
                      ? 'border-transparent text-white'
                      : 'border-[var(--color-outline-variant)] text-[var(--color-text-secondary)]'
                  )}
                  style={active ? { background: TOOL_META[id].accent } : undefined}
                >
                  {TOOL_META[id].icon}
                  {TOOL_META[id].label}
                </button>
              );
            })}
            <span className="ml-1 text-[10px] text-[var(--color-text-secondary)]">
              {activeTools.length === 0 ? 'Auto-attached on send — or pin here' : 'Stays attached for follow-ups'}
            </span>
            <button
              type="button"
              onClick={() => setShowExamples((s) => !s)}
              aria-pressed={showExamples}
              title="Load a detailed example brief"
              className={cn(
                'ml-auto flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-all',
                showExamples
                  ? 'border-transparent bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                  : 'border-[var(--color-outline-variant)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]'
              )}
            >
              <Lightbulb size={12} />
              Examples
            </button>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={flow?.awaiting ? 'Answer above, or reply here…' : 'Describe or refine your architecture — or paste Terraform/SQL/code to import it…'}
              className="min-h-[3rem] flex-1 resize-none rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || sending}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white transition-opacity disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-[var(--color-surface-variant)] p-3 text-[11px] text-[var(--color-text-secondary)]">
          Shared with you — view only. Duplicate the project to continue in your own thread.
        </p>
      )}
    </div>
  );
}

function MessageBubble({
  message: m,
  projectId,
  flow,
  busy,
  onRespond,
  onSendText,
}: {
  message: ChatMessage;
  projectId: string;
  flow: ChatFlow | null;
  busy: boolean;
  onRespond: (interaction: ChatInteraction, response: Omit<ChatInteractionResponse, 'interactionId'>, displayText: string) => void;
  onSendText: (text: string) => void;
}) {
  if (m.role === 'system') {
    return (
      <p className="flex items-center gap-1.5 px-1 text-[11px] italic text-[var(--color-text-secondary)]">
        <PencilRuler size={11} className="shrink-0" /> {m.text}
      </p>
    );
  }
  const isUser = m.role === 'user';
  const interactionActive =
    !isUser && !!m.interaction && m.interaction.status === 'open' && flow?.openInteractionId === m.interaction.id;
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'bg-[var(--color-primary)] text-white'
            : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]'
        )}
      >
        <p className="whitespace-pre-wrap">{m.text}</p>

        {!isUser && (m.mcpCalls?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {m.mcpCalls!.map((c, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[10px]',
                  c.status === 'ok'
                    ? 'bg-[#e6f4ea] text-[#1e8e3e]'
                    : 'bg-[#fcece9] text-[#8c1d18]'
                )}
                title={c.status === 'ok' ? 'Official MCP tool invoked' : 'MCP tool failed this turn'}
              >
                {TOOL_META[c.provider].label}:{c.tool} {c.status === 'failed' && '✕'}
              </span>
            ))}
          </div>
        )}
        {!isUser && (m.editsApplied?.length ?? 0) > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-text-secondary)]">
            {m.editsApplied!.map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
          </ul>
        )}
        {/* Interpretability (2026-08) — per-requirement evaluation of the generated diagram */}
        {!isUser && (m.coverage?.length ?? 0) > 0 && <CoverageCard items={m.coverage!} />}
        {!isUser && m.indicative && (
          <p className="mt-1.5 rounded-lg bg-[#fef7e0] px-2 py-1 text-[10px] font-medium text-[#7a5900]">
            Indicative — produced without the official provider tools
          </p>
        )}
        {/* 006 — guided-flow interaction cards */}
        {!isUser && m.interaction && m.interaction.kind !== 'cost_options' && (
          <QuestionRoundCard interaction={m.interaction} active={interactionActive && !busy} onRespond={onRespond} />
        )}
        {!isUser && m.interaction && m.interaction.kind === 'cost_options' && (
          <PricingOptionsCard
            interaction={m.interaction}
            active={interactionActive && !busy}
            selectedOptionId={flow?.selectedOptionId ?? null}
            onRespond={onRespond}
            onSendText={onSendText}
          />
        )}
        {/* 004 FR-006/SC-003 — persisted trace, collapsed by default, fetched on expand */}
        {!isUser && m.runId && (
          <PersistedTrace projectId={projectId} runId={m.runId} iterations={m.iterations ?? 1} stepCount={m.stepCount ?? 0} />
        )}
      </div>
    </div>
  );
}

/**
 * Requirements evaluation card (interpretability, 2026-08): the reviewer's
 * final verdict — every requirement extracted from the user's request, graded
 * met/unmet against the APPLIED diagram, with quoted evidence and the gap when
 * unmet. Green header when everything is covered; amber with the open items
 * first when not, so a best-effort turn tells the user exactly what is missing
 * instead of hiding it in prose.
 */
function CoverageCard({ items }: Readonly<{ items: ChatCoverageItem[] }>) {
  const [expanded, setExpanded] = useState(false);
  const met = items.filter((i) => i.met).length;
  const allMet = met === items.length;
  // Unmet first — those are the actionable rows.
  const ordered = [...items].sort((a, b) => Number(a.met) - Number(b.met));
  return (
    <div className="mt-2 rounded-xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold"
      >
        {allMet ? (
          <BadgeCheck size={13} className="shrink-0 text-[#1e8e3e]" />
        ) : (
          <TriangleAlert size={13} className="shrink-0 text-[#7a5900]" />
        )}
        <span className={allMet ? 'text-[#1e8e3e]' : 'text-[#7a5900]'}>
          Requirements evaluation: {met}/{items.length} covered in the diagram
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--color-text-secondary)] underline decoration-dotted">
          {expanded ? 'hide details' : 'details'}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1.5 space-y-1.5">
          {ordered.map((item) => (
            <li key={item.requirement} className="flex items-start gap-1.5 text-[11px]">
              {item.met ? (
                <Check size={11} className="mt-0.5 shrink-0 text-[#1e8e3e]" />
              ) : (
                <X size={11} className="mt-0.5 shrink-0 text-[#8c1d18]" />
              )}
              <span className="min-w-0">
                <span className="text-[var(--color-text-primary)]">{item.requirement}</span>
                {item.met && item.evidence && (
                  <span className="block font-mono text-[10px] text-[var(--color-text-secondary)]">{item.evidence}</span>
                )}
                {!item.met && item.gap && (
                  <span className="block text-[10px] text-[#8c1d18]">{item.gap}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 006 T014 — clarify / cost-question round. Options are native buttons
 * (keyboard-operable, visible focus); per-question Skip; round-level
 * "Use defaults & build" (skipAll, FR-004). Once resolved the card is
 * read-only and shows the recorded resolutions (FR-006). No arrival animation
 * (reduced-motion safe by construction).
 */
function QuestionRoundCard({
  interaction,
  active,
  onRespond,
}: {
  interaction: ChatInteraction;
  active: boolean;
  onRespond: (interaction: ChatInteraction, response: Omit<ChatInteractionResponse, 'interactionId'>, displayText: string) => void;
}) {
  const questions = interaction.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, { optionId?: string; text?: string; skipped?: boolean }>>({});

  const setAnswer = (qid: string, a: { optionId?: string; text?: string; skipped?: boolean }) =>
    setAnswers((prev) => ({ ...prev, [qid]: a }));

  const submit = (skipAll: boolean) => {
    const list = skipAll
      ? []
      : questions.map((q) => {
          const a = answers[q.id];
          if (!a || a.skipped || (a.optionId === undefined && !(a.text ?? '').trim())) return { questionId: q.id, skipped: true };
          return { questionId: q.id, ...(a.optionId !== undefined ? { optionId: a.optionId } : {}), ...(a.text?.trim() ? { text: a.text.trim() } : {}) };
        });
    const display = skipAll
      ? 'Skipped the questions — use defaults and continue.'
      : questions
          .map((q) => {
            const a = list.find((x) => x.questionId === q.id);
            if (!a || a.skipped) return `${q.prompt} → (skipped)`;
            const label = ('text' in a && a.text) || q.options?.find((o) => o.id === ('optionId' in a ? a.optionId : undefined))?.label || '(answered)';
            return `${q.prompt} → ${label}`;
          })
          .join('\n');
    onRespond(interaction, { answers: list, skipAll }, display);
  };

  return (
    <div className="mt-2 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] p-2.5">
      {interaction.status === 'superseded' && (
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
          Superseded — the request changed before this round was answered
        </p>
      )}
      <div className="space-y-3">
        {questions.map((q) => (
          <fieldset key={q.id} className="min-w-0 border-0 p-0">
            <legend className="text-[12px] font-medium text-[var(--color-text-primary)]">{q.prompt}</legend>
            {q.why && <p className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">{q.why}</p>}

            {q.resolution ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                {q.resolution.kind === 'skipped' ? (
                  <>
                    <SkipForward size={11} className="shrink-0" /> Skipped — MVP-scale default applied
                  </>
                ) : (
                  <>
                    <Check size={11} className="shrink-0 text-[#1e8e3e]" />
                    {q.resolution.text ?? q.options?.find((o) => o.id === q.resolution?.optionId)?.label ?? 'Answered'}
                  </>
                )}
              </p>
            ) : (
              <>
                {(q.kind === 'single_select' || q.kind === 'service_choice') && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {(q.options ?? []).map((o) => {
                      const chosen = answers[q.id]?.optionId === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={!active}
                          aria-pressed={chosen}
                          onClick={() => setAnswer(q.id, { optionId: o.id })}
                          className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-left text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-60',
                            chosen
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                              : 'border-[var(--color-outline-variant)] text-[var(--color-text-primary)] hover:border-[var(--color-primary-fixed-dim)]'
                          )}
                        >
                          <span className="flex items-center gap-1.5 font-medium">
                            {o.label}
                            {o.recommended && (
                              <span className="flex items-center gap-0.5 rounded-full bg-[#e6f4ea] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#1e8e3e]">
                                <BadgeCheck size={10} /> Recommended
                              </span>
                            )}
                          </span>
                          {o.detail && <span className="mt-0.5 block text-[11px] text-[var(--color-text-secondary)]">{o.detail}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {q.kind === 'text' && (
                  <input
                    type="text"
                    disabled={!active}
                    value={answers[q.id]?.text ?? ''}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                    placeholder="Type your answer…"
                    aria-label={q.prompt}
                    className="mt-1.5 w-full rounded-lg border border-[var(--color-outline-variant)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                  />
                )}
                {active && (
                  <button
                    type="button"
                    onClick={() => setAnswer(q.id, { skipped: !answers[q.id]?.skipped })}
                    aria-pressed={answers[q.id]?.skipped ?? false}
                    className={cn(
                      'mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                      answers[q.id]?.skipped ? 'font-medium text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)] underline decoration-dotted'
                    )}
                  >
                    <SkipForward size={10} /> {answers[q.id]?.skipped ? 'Will skip — use the default' : 'Skip this one'}
                  </button>
                )}
              </>
            )}
          </fieldset>
        ))}
      </div>
      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => submit(false)}
            className="rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-medium text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
          >
            Send answers
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            className="rounded-full border border-[var(--color-outline-variant)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {interaction.kind === 'clarify' ? 'Use defaults & build' : 'Skip — use defaults'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 006 T023 — priced options, side by side: monthly total, indicative badge,
 * itemized per-service breakdown, trade-off summary, Select per option +
 * round-level Skip. After resolution the active option is highlighted and a
 * Switch affordance posts a plain-text switch turn (FR-011).
 */
function PricingOptionsCard({
  interaction,
  active,
  selectedOptionId,
  onRespond,
  onSendText,
}: {
  interaction: ChatInteraction;
  active: boolean;
  selectedOptionId: string | null;
  onRespond: (interaction: ChatInteraction, response: Omit<ChatInteractionResponse, 'interactionId'>, displayText: string) => void;
  onSendText: (text: string) => void;
}) {
  const options = interaction.options ?? [];
  const resolved = interaction.status !== 'open';
  return (
    <div className="mt-2 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isSelected = resolved && selectedOptionId === o.id;
          return (
            <div
              key={o.id}
              className={cn(
                'flex min-w-0 flex-col rounded-lg border p-2.5',
                isSelected ? 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)]/40' : 'border-[var(--color-outline-variant)]'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-semibold text-[var(--color-text-primary)]">{o.label}</p>
                {isSelected && (
                  <span className="flex items-center gap-0.5 rounded-full bg-[#e6f4ea] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#1e8e3e]">
                    <Check size={10} /> Active
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[15px] font-bold text-[var(--color-text-primary)]">
                {formatUSD(o.monthly)}
                <span className="text-[10px] font-normal text-[var(--color-text-secondary)]">/mo</span>
              </p>
              {o.indicative && (
                <p className="mt-1 rounded bg-[#fef7e0] px-1.5 py-0.5 text-[9px] font-medium text-[#7a5900]">Indicative pricing</p>
              )}
              {o.degraded && (
                <p className="mt-1 text-[9px] text-[var(--color-text-secondary)]">Derived from catalog defaults (optimizer unavailable)</p>
              )}
              {o.summary && <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{o.summary}</p>}
              {(o.perService?.length ?? 0) > 0 && (
                <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-[10px] text-[var(--color-text-secondary)]">
                  {o.perService!.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{l.serviceId}</span>
                      <span className="shrink-0">{formatUSD(l.cost)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {active && (
                <button
                  type="button"
                  onClick={() =>
                    onRespond(interaction, { answers: [], selectedOptionId: o.id }, `Selected the ${o.label} option.`)
                  }
                  className="mt-2 rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-medium text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
                >
                  Select {o.label}
                </button>
              )}
              {resolved && !isSelected && selectedOptionId && (
                <button
                  type="button"
                  onClick={() => onSendText(`Switch to the ${o.label} option.`)}
                  className="mt-2 rounded-full border border-[var(--color-outline-variant)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  Switch to {o.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {active && (
        <button
          type="button"
          onClick={() => onRespond(interaction, { answers: [], skipAll: true }, 'Skipped the pricing options — keeping the current configuration.')}
          className="mt-2 rounded-full border border-[var(--color-outline-variant)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Skip — keep current configuration
        </button>
      )}
    </div>
  );
}
