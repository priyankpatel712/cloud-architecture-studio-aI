import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { chatMessageSchema } from '@/lib/schemas';
import { getProjectForWrite } from '@/lib/projects';
import { Architecture, type ArchitectureDoc } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';
import { GenerationRun } from '@/lib/models/GenerationRun';
import { CostEstimateOverride } from '@/lib/models/CostEstimateOverride';
import type { ArchNode, ArchEdge, ArchContainer, ArchAnnotation, GuidanceCachePort } from '@/lib/generate/orchestrator';
import { runAgentLoop, type AgentLoopResult } from '@/lib/generate/agent-loop';
import type { RequirementCoverage } from '@/lib/generate/reviewer';
import { createTraceEmitter, type TraceEmitter, type TraceStepRecord, type TraceModelCallRecord } from '@/lib/generate/trace-emitter';
import { runWithLlmObserver } from '@/lib/llm-observer';
import { mongoGuidanceCache } from '@/lib/generate/guidance-cache';
import { orchestrateCostTurn } from '@/lib/generate/cost-orchestrator';
import { recomputeProjectEstimate } from '@/lib/cost-estimate';
import { LlmAbortError, LlmError, llmAvailable } from '@/lib/llm';
import { loadLlmSettings } from '@/lib/llm-settings';
import type { ProviderId } from '@/lib/providers/types';
import { getProvider } from '@/lib/providers/registry';
import { routeToolsAndMode, fallbackRoute, type DesignMode } from '@/lib/generate/router';
import { checkAwsRegionalAvailability } from '@/lib/providers/aws/mcp';
import { analyzeRequest, briefFromAnalysis, interpretResponse, type AnalyzeResult } from '@/lib/generate/analyze';
import { buildConversationContext } from '@/lib/generate/conversation-context';
import { resolveIntent, type EditScope } from '@/lib/generate/intent';
import { applyDirectEdit, type DirectEditArch } from '@/lib/generate/direct-edit';
import { distillLesson } from '@/lib/knowledge/distill';
import { upsertKnowledge } from '@/lib/knowledge/store';
import { architecturePrompt } from '@/lib/generate/orchestrator';
import { llmJson } from '@/lib/llm';
import {
  briefContext,
  defaultsDisclosure,
  describeResponse,
  findInvalidAnswer,
  mergeBrief,
  mergeResolvedRound,
  openInteraction,
  resolveQuestions,
  type Interaction,
  type InteractionAnswer,
  type PricingOption,
  type RequirementBrief,
  type ValidationQuestion,
} from '@/lib/generate/flow';
import { detectSwitchIntent, generateCostQuestions, generatePricingOptions, applyOptionToNodes } from '@/lib/generate/cost-options';
import {
  buildApprovalQuestion,
  decisionFromAnswers,
  destructiveChangeCheckpoint,
  interpretApprovalReply,
  type HitlCheckpoint,
} from '@/lib/agent/hitl';
import { coveragePercent, coverageSummary } from '@/lib/agent/coverage';
import { deriveBriefMemory, mergeSessionMemory, renderSessionMemory, type SessionMemoryEntry } from '@/lib/agent/session-memory';
import { finalizeArchitecture, type PreservedNode } from '@/lib/generate/finalize';
import { assignEdgeSides } from '@/lib/generate/edge-sides';
import { priceNodes } from '@/lib/pricing';
import { fixedWindowLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';
import { recordArchitectureVersion } from '@/lib/versions';

export const runtime = 'nodejs';
export const maxDuration = 120; // constitution agentic envelope: 90s p90 / 120s hard cap — applies PER TURN (006 FR-015)

/**
 * POST /api/projects/[id]/chat/messages — append a user message and run ONE
 * guided-flow turn (features 004/005; re-sequenced by 006 into the phase
 * router below — contracts/guided-flow-protocol.md §2). Owner-only.
 *
 * 006: turns never block on the user. A turn that needs input ends normally —
 * its assistant message carries a structured `interaction` (question round or
 * pricing options) and `conversation.flow.awaiting` names the open round; the
 * user's next POST (structured `interactionResponse` and/or free text) runs the
 * next phase. Routing table:
 *
 *   awaiting=null   + new/major request  → analyze turn (→ build in-stream when no questions)
 *   awaiting=null   + small_edit         → legacy turn (zero interaction, FR-013)
 *   awaiting=null   + switch intent      → switch turn (re-apply stored option, FR-011)
 *   awaiting=clarify        + response   → build turn (brief-fed loop → cost questions/options)
 *   awaiting=clarify        + new request→ supersede round → analyze turn
 *   awaiting=cost_questions + response   → cost turn (generate + price both options)
 *   awaiting=cost_options   + selection  → apply + finalize turn
 *
 * Response stays an NDJSON stream (contracts/agentic-generation.md §1, extended
 * additively by 006 §3: result payload gains `interaction` and `flow`).
 * Pre-stream failures — auth, validation, 409 already-generating, and the new
 * interaction-response checks (409 closed round / 422 unknown ids) — remain
 * plain JSON with real status codes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, chatMessageSchema);

    // Per-user cap on generation turns (checklist #1). Each turn can drive paid
    // LLM calls, so this is the main cost-abuse guard for a paid/Anthropic key.
    // Pre-stream, so a plain-JSON 429 is correct here (see routing note above).
    const rl = await fixedWindowLimit('llm:user', session.sub, RATE_LIMITS.llmMax, RATE_LIMITS.llmWindowMs);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec, 'You are sending requests too quickly. Please wait a moment and try again.');
    // Prime the LLM settings cache so the sync llmAvailable() checks inside the
    // generate modules see the in-app provider config, not just env.
    await loadLlmSettings();

    let convo = await AIConversation.findOne({ projectId: project._id });
    convo ??= await AIConversation.create({
      ownerId: project.ownerId,
      projectId: project._id,
      status: 'idle',
      activeTools: [],
      messages: [],
    });
    if (convo.status === 'generating') {
      // Stale-lock guard: a turn that died without resetting status (server
      // restart, killed stream) must not 409 this project forever. maxDuration
      // caps a real turn at 120s (constitution hard cap) — anything older is a
      // corpse, not a turn.
      const ageMs = Date.now() - new Date(convo.updatedAt).getTime();
      if (ageMs < 125_000) {
        return NextResponse.json(
          { error: 'A generation is already in progress for this project.' },
          { status: 409 }
        );
      }
      console.warn(`[chat/messages] clearing stale 'generating' lock (${Math.round(ageMs / 1000)}s old) for project ${id}`);
    }

    // ---- 006 pre-stream interaction-response validation (contracts §1) ----
    const flowAwaiting = convo.flow?.awaiting ?? null;
    const ir = body.interactionResponse;
    let openRound: Interaction | null = null;
    if (ir) {
      if (!flowAwaiting || !convo.flow?.openInteractionId) {
        return NextResponse.json({ error: 'There is no open question round to respond to.' }, { status: 409 });
      }
      if (ir.interactionId !== convo.flow.openInteractionId) {
        return NextResponse.json(
          { error: 'This question round is closed or was superseded — reload the conversation.' },
          { status: 409 }
        );
      }
      openRound = findInteraction(convo, ir.interactionId);
      if (!openRound || openRound.status !== 'open') {
        return NextResponse.json(
          { error: 'This question round is closed or was superseded — reload the conversation.' },
          { status: 409 }
        );
      }
      if (flowAwaiting === 'cost_options') {
        const options = (convo.flow?.pricingOptions ?? []) as unknown as PricingOption[];
        if (!ir.skipAll && !ir.selectedOptionId) {
          return NextResponse.json({ error: 'Select a pricing option or skip the round.' }, { status: 422 });
        }
        if (ir.selectedOptionId && !options.some((o) => o.id === ir.selectedOptionId)) {
          return NextResponse.json({ error: `Unknown pricing option "${ir.selectedOptionId}".` }, { status: 422 });
        }
      } else {
        const invalid = findInvalidAnswer(openRound, ir.answers as InteractionAnswer[]);
        if (invalid) return NextResponse.json({ error: `Invalid answer: ${invalid}.` }, { status: 422 });
      }
    } else if (flowAwaiting) {
      // Free text while a round is open is a first-class answer path (research
      // D8) — routed through interpretation inside the turn. Look the round up
      // now so the turn body doesn't need to re-derive it.
      openRound = convo.flow?.openInteractionId ? findInteraction(convo, convo.flow.openInteractionId) : null;
    }

    // .lean(): the orchestrator copies and edits nodes as plain objects; Mongoose
    // subdocuments would lose schema fields (position, config) under object spread.
    // Loaded BEFORE tool routing so the router can see what is already drawn.
    const arch = await Architecture.findOne({ projectId: project._id }).lean();

    // ---- Dynamic tool/mode routing (Anthropic routing pattern) ----
    // One cheap LLM call classifies the NEW message + recent conversation into
    // a diagram mode (cloud | hld | lld) and the provider toolsets to attach —
    // replacing the old "auto-attach the full registry" default. The client
    // echoes the sticky chips on every send, so an EXPLICIT pin is detected as
    // "the chips differ from the conversation's sticky set" (a real user
    // toggle), and an explicit pin is never overridden. Pure interaction
    // responses (empty text) never re-route.
    const stickyTools = (convo.activeTools ?? []) as ProviderId[];
    const bodyTools = body.attachedTools as ProviderId[];
    const explicitPin =
      bodyTools.length > 0 &&
      (bodyTools.length !== stickyTools.length || bodyTools.some((t) => !stickyTools.includes(t)));
    const routeContext = {
      currentMode: convo.messages.length > 0 ? ((convo.designMode ?? 'cloud') as DesignMode) : null,
      currentProviders: stickyTools,
      canvasProviders: [...new Set((arch?.nodes ?? []).map((n) => n.provider as ProviderId))],
    };
    const decision =
      body.text.trim().length === 0
        ? fallbackRoute(routeContext)
        : await routeToolsAndMode({
            text: body.text.trim(),
            history: convo.messages.filter((m) => m.role === 'user' && m.text?.trim()).map((m) => m.text as string),
            ...routeContext,
          });
    let activeTools: ProviderId[];
    let designMode: DesignMode;
    if (explicitPin) {
      // Never drop an explicit user choice — providers are exactly the pinned
      // set; the mode follows it (generic pin still lets the router pick
      // hld vs lld, a cloud-only pin is by definition cloud mode).
      activeTools = bodyTools;
      designMode = bodyTools.includes('system') ? (decision.mode === 'lld' ? 'lld' : 'hld') : 'cloud';
    } else {
      activeTools = decision.providers;
      designMode = decision.mode;
    }
    const autoAttached = !explicitPin;
    const routeReason = autoAttached ? decision.reason : '';

    const userText =
      body.text.trim() ||
      (ir && openRound ? describeResponse(openRound, ir.answers as InteractionAnswer[], ir.skipAll, ir.selectedOptionId) : '');

    // 008 FR-001 — render the recent conversation ONCE per turn, before the new
    // user message is appended (it is passed separately as `userText`).
    // Deliberately NOT filtered to role==='user': the assistant's own
    // `editsApplied` and the "Direct canvas edit" system messages are exactly
    // what a follow-up needs to resolve against, and dropping them is root cause
    // R1/R2/R5 of modification requests being misunderstood.
    //
    // agentic-concepts (Session Memory): the durable per-conversation facts are
    // prepended so a constraint stated in turn 2 still binds the planner in
    // turn 30, after the transcript window has long since evicted it. Every
    // consumer of conversationContext (intent, analyze, planner) sees both.
    const transcriptBlock = buildConversationContext(
      convo.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        text: m.text ?? undefined,
        editsApplied: (m.editsApplied ?? []) as string[],
      }))
    );
    const memoryBlock = renderSessionMemory((convo.sessionMemory ?? []) as SessionMemoryEntry[]);
    const conversationContext = [memoryBlock, transcriptBlock].filter(Boolean).join('\n\n');

    convo.set('activeTools', activeTools);
    convo.set('designMode', designMode);
    convo.messages.push({
      role: 'user',
      text: userText,
      attachedTools: activeTools,
      mcpCalls: [],
      editsApplied: [],
      indicative: false,
      createdAt: new Date(),
    });
    convo.status = 'generating';
    convo.stopRequested = false;
    await convo.save();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const emit = (event: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        const emitter = createTraceEmitter(emit);
        const turnStartedAt = new Date();

        const abortController = new AbortController();
        const isStopRequested = async () => {
          const doc = await AIConversation.findById(convo!._id).select('stopRequested').lean();
          return Boolean(doc?.stopRequested);
        };
        const pollTimer = setInterval(() => {
          isStopRequested()
            .then((stopped) => {
              if (stopped) abortController.abort();
            })
            .catch(() => {});
        }, 1500);

        // Interpretability: every llmJson call anywhere in this turn — planner,
        // reviewer, router, knowledge, research — reports its provider/model/
        // outcome to the emitter, which streams it live and persists it on the
        // GenerationRun. One wrap point covers every turn type.
        void runWithLlmObserver(
          (e) => emitter.modelCall(e),
          () =>
            routeTurn({
              session, project, convo: convo!, body, arch, activeTools, autoAttached,
              designMode, routeReason,
              emit, emitter, turnStartedAt, isStopRequested, signal: abortController.signal,
              guidanceCache: mongoGuidanceCache,
              interactionResponse: ir ?? null,
              openRound,
              userText,
              conversationContext,
            })
        )
          .catch(async (e) => {
            console.error('[chat/messages] stream error:', e);
            await persistFailureAndRespond({
              convo: convo!, project, emitter, emit, turnStartedAt,
              text: 'Generation failed unexpectedly. Please retry.', retryable: true,
            });
          })
          .finally(() => {
            clearInterval(pollTimer);
            try {
              controller.close();
            } catch {
              /* already closed/cancelled */
            }
          });
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (e) {
    return fail(e);
  }
}

interface TurnCtx {
  session: { sub: string };
  project: Awaited<ReturnType<typeof getProjectForWrite>>;
  convo: NonNullable<Awaited<ReturnType<typeof AIConversation.findOne>>>;
  body: { text: string; attachedTools: string[] };
  arch: ArchitectureDoc | null;
  activeTools: ProviderId[];
  /** true when the tools were chosen by the dynamic router (no explicit chip pin this turn) */
  autoAttached: boolean;
  /** diagram mode chosen by the router (sticky per conversation) */
  designMode: DesignMode;
  /** the router's one-line rationale, for the working-trace disclosure ('' when defaulted/pinned) */
  routeReason: string;
  emit: (event: Record<string, unknown>) => void;
  emitter: TraceEmitter;
  turnStartedAt: Date;
  isStopRequested: () => Promise<boolean>;
  signal: AbortSignal;
  guidanceCache: GuidanceCachePort;
  /** validated structured response to the open round, when the client sent one */
  interactionResponse: { interactionId: string; answers: InteractionAnswer[]; skipAll: boolean; selectedOptionId?: string } | null;
  /** the open round (when one exists), as stored on its assistant message */
  openRound: Interaction | null;
  userText: string;
  /**
   * 008 FR-001 — rendered recent conversation (prior requests, what the
   * assistant applied each turn, manual canvas edits). Shared by the intent
   * resolver, analyze, interpret, and the planner so every stage reads the same
   * history instead of re-deriving intent from one sentence.
   */
  conversationContext: string;
}

type FlowPhase = 'analyze' | 'build' | 'cost' | 'finalize';

// ---- agentic-concepts: session memory + HITL pending-apply -----------------------

/**
 * Session Memory — merge this turn's durable facts into the conversation's
 * stored entries. The mutation rides on whichever convo.save() ends the turn,
 * so no extra write sits on the latency path.
 */
function recordSessionMemory(ctx: TurnCtx, entries: SessionMemoryEntry[]) {
  if (entries.length === 0) return;
  const merged = mergeSessionMemory((ctx.convo.sessionMemory ?? []) as SessionMemoryEntry[], entries);
  ctx.convo.set('sessionMemory', merged);
  ctx.convo.markModified('sessionMemory');
}

/**
 * HITL destructive_change — the loop result held back at the approval
 * checkpoint, stored wholesale on flow.pendingApply (Mixed) and re-read by
 * runApplyPendingTurn when the user approves.
 */
interface PendingApply {
  reason: string;
  reply: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: AgentLoopResult['guidance'];
  editsApplied: string[];
  mcpCalls: { provider: ProviderId; tool: string; status: 'ok' | 'failed' }[];
  coverage: RequirementCoverage[];
  indicative: boolean;
  iterations: number;
  converged: boolean;
}

// ---- Shared persistence helpers -------------------------------------------------

async function createRun(opts: {
  convo: TurnCtx['convo'];
  project: TurnCtx['project'];
  iterations: number;
  converged: boolean;
  stopped: boolean;
  terminalStatus: 'converged' | 'best_effort' | 'failed' | 'stopped';
  startedAt: Date;
  steps: TraceStepRecord[];
  modelCalls?: TraceModelCallRecord[];
  flowPhase?: FlowPhase;
}) {
  return GenerationRun.create({
    conversationId: opts.convo._id,
    projectId: opts.project._id,
    ownerId: opts.project.ownerId,
    iterations: Math.max(1, opts.iterations),
    converged: opts.converged,
    stopped: opts.stopped,
    terminalStatus: opts.terminalStatus,
    ...(opts.flowPhase ? { flowPhase: opts.flowPhase } : {}),
    startedAt: opts.startedAt,
    endedAt: new Date(),
    steps: opts.steps,
    modelCalls: opts.modelCalls ?? [],
  });
}

/**
 * Shared failure path (003 contracts/generation-reliability.md, extended by
 * 004 FR-006): persist whatever trace accumulated as a `failed` GenerationRun,
 * attach it to the failure assistant message so even a failed turn's working
 * steps stay inspectable, reset the conversation, and emit the error event.
 * 006: `flow.awaiting` is deliberately untouched — a failed phase turn leaves
 * the open round exactly as it was (contracts §3).
 */
async function persistFailureAndRespond(opts: {
  convo: TurnCtx['convo'];
  project: TurnCtx['project'];
  emitter: TraceEmitter;
  emit: TurnCtx['emit'];
  turnStartedAt: Date;
  text: string;
  retryable: boolean;
  flowPhase?: FlowPhase;
}) {
  const { convo, project, emitter, emit, turnStartedAt, text, retryable } = opts;
  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: 1, converged: false, stopped: false,
      terminalStatus: 'failed', startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: opts.flowPhase,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist failure run:', persistError);
  }
  convo.messages.push({
    role: 'assistant', text, attachedTools: [], mcpCalls: [], editsApplied: [],
    indicative: false, error: { step: 'architecture', retryable },
    ...(runId ? { runId, iterations: 1, converged: false, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  });
  try {
    convo.status = 'failed';
    convo.stopRequested = false;
    await convo.save();
  } catch {
    /* status stays 'generating'; the stale-lock guard clears it */
  }
  emit({ type: 'error', error: text, retryable, step: 'architecture' });
}

/** 006 — stop observed during a short (analyze/cost/apply) turn: nothing persisted beyond the message; the open round stays as-is. */
async function persistStoppedShortTurn(ctx: TurnCtx, flowPhase: FlowPhase) {
  const { convo, project, emitter, emit, turnStartedAt } = ctx;
  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: 1, converged: false, stopped: true,
      terminalStatus: 'stopped', startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist stopped run:', persistError);
  }
  const assistantMessage = {
    role: 'assistant' as const,
    text: 'Generation stopped at your request.',
    attachedTools: [] as ProviderId[],
    mcpCalls: [],
    editsApplied: [],
    indicative: false,
    ...(runId ? { runId, iterations: 1, converged: false, stopped: true, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();
  emit({ type: 'stopped', partial: { message: assistantMessage, conversation: { status: 'idle', activeTools: ctx.activeTools } } });
}

function findInteraction(convo: TurnCtx['convo'], interactionId: string): Interaction | null {
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    const m = convo.messages[i];
    if (m.interaction && m.interaction.id === interactionId) {
      // Return a PLAIN object: downstream helpers spread questions ({...q}),
      // and Mongoose subdocument fields live behind prototype getters — a
      // spread of the raw subdoc would silently drop every field.
      const raw = m.interaction as unknown as { toObject?: () => unknown };
      return (typeof raw.toObject === 'function' ? raw.toObject() : m.interaction) as Interaction;
    }
  }
  return null;
}

/** Mark the stored open round with its terminal status + per-question resolutions (FR-006). */
function closeStoredRound(convo: TurnCtx['convo'], interactionId: string, status: 'answered' | 'skipped' | 'superseded', resolvedQuestions?: ValidationQuestion[]) {
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    const m = convo.messages[i];
    if (m.interaction && m.interaction.id === interactionId) {
      m.interaction.status = status;
      if (resolvedQuestions) m.interaction.questions = resolvedQuestions as never;
      convo.markModified(`messages.${i}.interaction`);
      return;
    }
  }
}

function flowSnapshot(convo: TurnCtx['convo']) {
  return {
    awaiting: convo.flow?.awaiting ?? null,
    // The client only activates a round's buttons when this id matches the
    // message's interaction id — omitting it made live-streamed rounds
    // unclickable until a full page reload (GET /chat always included it).
    openInteractionId: convo.flow?.openInteractionId ?? null,
    selectedOptionId: convo.flow?.selectedOptionId ?? null,
  };
}

function preservedFromArch(arch: ArchitectureDoc | null): PreservedNode[] {
  return (arch?.nodes ?? []).map((n) => ({
    nodeId: n.nodeId,
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    containerId: n.containerId ?? null,
  }));
}

/** End a turn by opening a new round (analyze → clarify, build → cost questions, cost → options). */
async function endTurnWithRound(ctx: TurnCtx, opts: {
  replyText: string;
  interaction: Interaction;
  awaiting: 'clarify' | 'cost_questions' | 'cost_options' | 'approval';
  flowPhase: FlowPhase;
  /** included when the turn also changed the architecture (build turn) */
  architecture?: Record<string, unknown>;
  estimate?: unknown;
  mcpCalls?: { provider: ProviderId; tool: string; status: 'ok' | 'failed' }[];
  editsApplied?: string[];
  indicative?: boolean;
  iterations?: number;
  converged?: boolean;
  coverage?: RequirementCoverage[];
}) {
  const { convo, project, emitter, emit, turnStartedAt, activeTools } = ctx;
  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project,
      iterations: opts.iterations ?? 1,
      converged: opts.converged ?? true,
      stopped: false,
      terminalStatus: opts.converged === false ? 'best_effort' : 'converged',
      startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: opts.flowPhase,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: opts.replyText,
    attachedTools: [] as ProviderId[],
    mcpCalls: opts.mcpCalls ?? [],
    editsApplied: opts.editsApplied ?? [],
    indicative: opts.indicative ?? false,
    interaction: opts.interaction as never,
    ...(opts.coverage && opts.coverage.length > 0 ? { coverage: opts.coverage } : {}),
    ...(runId ? { runId, iterations: opts.iterations ?? 1, converged: opts.converged ?? true, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.set('flow.awaiting', opts.awaiting);
  convo.set('flow.openInteractionId', opts.interaction.id);
  convo.set('flow.updatedAt', new Date());
  convo.status = 'idle';
  convo.stopRequested = false;
  convo.markModified('flow');
  await convo.save();

  emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      ...(opts.architecture ? { architecture: opts.architecture } : {}),
      estimate: opts.estimate ?? null,
      conversation: { status: 'idle', activeTools },
      interaction: opts.interaction,
      flow: flowSnapshot(convo),
    },
  });
}

/**
 * 008 US1 — end a turn with a reply and NO canvas change (FR-007/FR-008).
 *
 * `architecture: null` + `answeredOnly: true` tells the client to render the
 * message and leave the diagram alone (contracts/chat-stream-events.md). This is
 * the difference between "I answered your question" and today's behavior, where
 * a question could send the planner off rewriting the design.
 */
async function endTurnWithAnswer(ctx: TurnCtx, opts: { replyText: string }) {
  const { convo, project, emitter, emit, turnStartedAt, activeTools } = ctx;
  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project,
      iterations: 1, converged: true, stopped: false, terminalStatus: 'converged',
      startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: 'analyze',
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: opts.replyText,
    attachedTools: [] as ProviderId[],
    mcpCalls: [],
    editsApplied: [],
    indicative: false,
    ...(runId ? { runId, iterations: 1, converged: true, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();

  emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      architecture: null,
      answeredOnly: true,
      estimate: null,
      conversation: { status: 'idle', activeTools },
      flow: flowSnapshot(convo),
    },
  });
}

/**
 * 008 US1 — answer a question about the current design (FR-007).
 * One mid-tier call over the conversation and the current diagram; the canvas is
 * never touched, so a failure degrades to an honest "I could not answer".
 */
async function answerOnlyTurn(ctx: TurnCtx, scope: EditScope) {
  const { arch } = ctx;
  ctx.emitter.step('answer', 'analyze', 1, 'Answering from the current design', 'running');
  try {
    const answer = await llmJson<{ answer?: unknown }>({
      role: 'analyze',
      system: [
        'You answer questions about an architecture diagram that already exists.',
        'Answer ONLY from the diagram and conversation given. Be concrete and brief',
        '(2-4 sentences). Never propose redesigns unless asked. If the answer is not',
        'determinable from what you were given, say so plainly.',
      ].join('\n'),
      user: [
        architecturePrompt(
          (arch?.nodes ?? []) as unknown as ArchNode[],
          (arch?.edges ?? []) as unknown as ArchEdge[],
          (arch?.containers ?? []) as unknown as ArchContainer[],
          (arch?.annotations ?? []) as unknown as ArchAnnotation[]
        ),
        ctx.conversationContext ? `Conversation so far:\n${ctx.conversationContext}` : '',
        `Question: ${scope.freeform || ctx.userText}`,
      ].filter(Boolean).join('\n\n'),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { type: 'string' } },
      } as unknown as Record<string, unknown>,
      maxTokens: 700,
      signal: ctx.signal,
    });
    const text = typeof answer?.answer === 'string' && answer.answer.trim()
      ? answer.answer.trim()
      : 'I could not determine that from the current diagram.';
    ctx.emitter.step('answer', 'analyze', 1, 'Answering from the current design', 'done');
    return endTurnWithAnswer(ctx, { replyText: text });
  } catch (e) {
    if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, 'analyze');
    console.error('[chat/messages] answer-only turn failed:', e);
    ctx.emitter.step('answer', 'analyze', 1, 'Answering from the current design', 'failed');
    return endTurnWithAnswer(ctx, {
      replyText: 'I was not able to answer that just now — please try rephrasing. Your diagram is unchanged.',
    });
  }
}

/**
 * 008 US1 — persist a deterministic fast-path edit (FR-005, SC-003).
 * Same persistence and result shape as a full turn, so version history, cost,
 * and the client all behave identically — it simply skipped the design loop.
 */
async function runDirectEditTurn(ctx: TurnCtx, edit: { arch: DirectEditArch; editsApplied: string[] }) {
  const { convo, project, arch, emitter, emit, turnStartedAt, activeTools } = ctx;
  emitter.step('direct-edit', 'direct-edit', 1, 'Applying edit', 'done', edit.editsApplied.join(', '));

  // Reuse the shared persistence path so versioning, cost recompute, and the
  // preserve-user-work bookkeeping behave exactly as on a full turn — the only
  // difference is that no design loop ran.
  const result: AgentLoopResult = {
    terminalStatus: 'converged',
    iterations: 1,
    converged: true,
    stopped: false,
    reply: `Done — ${edit.editsApplied.join(', ')}.`,
    nodes: edit.arch.nodes as unknown as ArchNode[],
    edges: edit.arch.edges as unknown as ArchEdge[],
    containers: edit.arch.containers as unknown as ArchContainer[],
    annotations: (edit.arch.annotations ?? []) as unknown as ArchAnnotation[],
    guidance: (arch?.guidance ?? {}) as never,
    editsApplied: edit.editsApplied,
    mcpCalls: [],
    // A deterministic edit runs no review — there is no coverage to report,
    // no checklist to measure (100 by definition), and no ReAct reasoning.
    coverage: [],
    coveragePercent: 100,
    react: [],
    indicative: false,
    changed: edit.editsApplied.length > 0,
    unsatisfiable: false,
    addRefIds: [],
  };
  const version = await persistArchitectureResult(ctx, result);
  const estimate = await recomputeProjectEstimate(project);

  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project,
      iterations: 1, converged: true, stopped: false, terminalStatus: 'converged',
      startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: 'build',
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: result.reply,
    attachedTools: [] as ProviderId[],
    mcpCalls: [],
    editsApplied: edit.editsApplied,
    indicative: false,
    ...(runId ? { runId, iterations: 1, converged: true, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();

  emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      architecture: {
        nodes: result.nodes, edges: result.edges, containers: result.containers,
        annotations: result.annotations, guidance: result.guidance, version,
      },
      estimate,
      conversation: { status: 'idle', activeTools },
      flow: flowSnapshot(convo),
    },
  });
}

// ---- agentic-concepts: HITL approval checkpoint turns ---------------------------

/**
 * HITL destructive_change — end the turn WITHOUT persisting: the draft is held
 * on flow.pendingApply and an approval round opens. The interaction reuses the
 * 'clarify' card (zero new client UI); flow.awaiting = 'approval' is what
 * routes the user's next message through the decision paths below.
 */
async function runApprovalRequestTurn(ctx: TurnCtx, result: AgentLoopResult, checkpoint: HitlCheckpoint, flowPhase: FlowPhase) {
  const { convo, emitter, arch } = ctx;
  emitter.step('hitl', 'reason', result.iterations, 'Pausing for your approval', 'done', checkpoint.reason);

  if (!convo.flow) {
    convo.set('flow', {
      awaiting: null, openInteractionId: null, preservedNodes: preservedFromArch(arch),
      pricingOptions: [], selectedOptionId: null, updatedAt: new Date(),
    });
  }
  const pending: PendingApply = JSON.parse(JSON.stringify({
    reason: checkpoint.reason,
    reply: result.reply,
    nodes: result.nodes,
    edges: result.edges,
    containers: result.containers,
    annotations: result.annotations,
    guidance: result.guidance,
    editsApplied: result.editsApplied,
    mcpCalls: result.mcpCalls,
    coverage: result.coverage,
    indicative: result.indicative,
    iterations: result.iterations,
    converged: result.converged,
  }));
  convo.set('flow.pendingApply', pending);
  convo.markModified('flow');

  const interaction = openInteraction('clarify', [buildApprovalQuestion(checkpoint)]);
  return endTurnWithRound(ctx, {
    replyText: `${result.reply}\n\n**Approval needed:** ${checkpoint.prompt} Nothing has been changed yet — your current diagram is untouched until you confirm.`,
    interaction,
    awaiting: 'approval',
    flowPhase,
    mcpCalls: result.mcpCalls,
    indicative: result.indicative,
    iterations: result.iterations,
    converged: result.converged,
    coverage: result.coverage,
  });
}

/** The user approved — apply the held draft exactly as reviewed, then clear the checkpoint. */
async function runApplyPendingTurn(ctx: TurnCtx) {
  const { convo, project, emitter } = ctx;
  const pending = (convo.flow?.pendingApply ?? null) as PendingApply | null;
  if (!pending) {
    convo.set('flow.awaiting', null);
    convo.set('flow.openInteractionId', null);
    convo.markModified('flow');
    return endTurnWithAnswer(ctx, {
      replyText: 'There is no pending change to apply — it may have been superseded. Tell me what you would like me to do.',
    });
  }

  emitter.step('hitl', 'reason', 1, 'Applying the change you approved', 'running');
  const resultLike: AgentLoopResult = {
    terminalStatus: 'converged',
    iterations: pending.iterations ?? 1,
    converged: true,
    stopped: false,
    reply: pending.reply ?? 'Applied the approved change.',
    nodes: pending.nodes,
    edges: pending.edges,
    containers: pending.containers,
    annotations: pending.annotations ?? [],
    guidance: pending.guidance ?? {},
    editsApplied: pending.editsApplied ?? [],
    mcpCalls: pending.mcpCalls ?? [],
    coverage: pending.coverage ?? [],
    coveragePercent: coveragePercent(pending.coverage ?? []),
    react: [],
    indicative: pending.indicative ?? false,
    changed: true,
    unsatisfiable: false,
    addRefIds: [],
  };
  const version = await persistArchitectureResult(ctx, resultLike);
  const estimate = await recomputeProjectEstimate(project);
  emitter.step('hitl', 'reason', 1, 'Applying the change you approved', 'done');

  recordSessionMemory(ctx, [
    { kind: 'decision', text: `Approved a change that ${pending.reason}`, turn: turnIndex(convo) },
  ]);

  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: resultLike.iterations, converged: true, stopped: false,
      terminalStatus: 'converged', startedAt: ctx.turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: 'build',
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: 'Applied the change as approved.',
    attachedTools: [] as ProviderId[],
    mcpCalls: resultLike.mcpCalls,
    editsApplied: resultLike.editsApplied,
    indicative: resultLike.indicative,
    ...(resultLike.coverage.length > 0 ? { coverage: resultLike.coverage } : {}),
    ...(runId ? { runId, iterations: resultLike.iterations, converged: true, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.set('flow.pendingApply', null);
  convo.set('flow.awaiting', null);
  convo.set('flow.openInteractionId', null);
  convo.set('flow.updatedAt', new Date());
  convo.status = 'idle';
  convo.stopRequested = false;
  convo.markModified('flow');
  await convo.save();

  ctx.emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      architecture: {
        nodes: resultLike.nodes, edges: resultLike.edges, containers: resultLike.containers,
        annotations: resultLike.annotations, guidance: resultLike.guidance, version,
      },
      estimate,
      conversation: { status: 'idle', activeTools: ctx.activeTools },
      flow: flowSnapshot(convo),
    },
  });
}

/** The user declined — discard the held draft; the current diagram stays exactly as it is. */
async function runDiscardPendingTurn(ctx: TurnCtx) {
  const { convo, emitter } = ctx;
  emitter.step('hitl', 'reason', 1, 'Checkpoint resolved — keeping the current diagram', 'done');
  recordSessionMemory(ctx, [
    { kind: 'decision', text: 'Rejected a destructive change at the approval checkpoint — current diagram kept', turn: turnIndex(convo) },
  ]);
  convo.set('flow.pendingApply', null);
  convo.set('flow.awaiting', null);
  convo.set('flow.openInteractionId', null);
  convo.set('flow.updatedAt', new Date());
  convo.markModified('flow');
  return endTurnWithAnswer(ctx, {
    replyText:
      'Understood — I have kept your current diagram exactly as it is; the proposed change was discarded. Tell me if you would like a different approach.',
  });
}

/**
 * 008 FR-020/FR-021 — distil a reusable lesson from this turn's review→fix pair
 * and store it, then surface it as a trailing `distill` trace step.
 *
 * Runs entirely after the turn's result is settled. Every failure path is
 * swallowed: the store may be unreachable, the small model may return nothing
 * generalizable, or the lesson may be rejected for carrying project-specific
 * content — none of which is a problem for the user's turn, which has already
 * succeeded.
 */
async function distillTurnLesson(ctx: TurnCtx, pair: { reviewGap: string; refinementFix: string }): Promise<void> {
  try {
    const lesson = await distillLesson({
      reviewGap: pair.reviewGap,
      refinementFix: pair.refinementFix,
      provider: ctx.activeTools[0] ?? 'any',
      designMode: ctx.designMode,
    });
    if (!lesson) return;
    const { created } = await upsertKnowledge(lesson);
    ctx.emitter.step('distill', 'distill', 1, 'Recorded a lesson', 'done',
      `${created ? 'New' : 'Reinforced'}: ${lesson.title}`);
  } catch (e) {
    console.error('[chat/messages] lesson distillation failed (turn unaffected):', e);
  }
}

// ---- Turn router (contracts §2) --------------------------------------------------

async function routeTurn(ctx: TurnCtx) {
  const { convo, activeTools, interactionResponse: ir, openRound } = ctx;
  const awaiting = convo.flow?.awaiting ?? null;

  // Disclose the dynamic routing in the working trace so the tool/mode
  // selection stays transparent (the chips above the composer update via
  // conversation.activeTools).
  if (ctx.autoAttached && activeTools.length > 0) {
    const modeLabel = ctx.designMode === 'hld' ? 'High-level design' : ctx.designMode === 'lld' ? 'Low-level design' : 'Cloud architecture';
    ctx.emitter.step('attach', 'analyze', 1, 'Selecting tools & diagram mode', 'done',
      `${modeLabel} — ${activeTools.map((t) => getProvider(t).label).join(' + ')}${ctx.routeReason ? ` · ${ctx.routeReason}` : ''}`);
  }

  // agentic-concepts (HITL) — an open approval checkpoint is resolved FIRST:
  // approve applies the held draft, reject discards it, and anything unclear is
  // treated as a new request that supersedes the checkpoint (nothing applied —
  // the checkpoint fails safe, never destructive).
  if (awaiting === 'approval' && openRound) {
    const decision = ir
      ? decisionFromAnswers(ir.answers as InteractionAnswer[], ir.skipAll)
      : interpretApprovalReply(ctx.userText);
    if (decision === 'approve') {
      closeStoredRound(convo, openRound.id, 'answered');
      return runApplyPendingTurn(ctx);
    }
    if (decision === 'reject') {
      closeStoredRound(convo, openRound.id, ir?.skipAll ? 'skipped' : 'answered');
      return runDiscardPendingTurn(ctx);
    }
    closeStoredRound(convo, openRound.id, 'superseded');
    convo.set('flow.pendingApply', null);
    convo.set('flow.awaiting', null);
    convo.set('flow.openInteractionId', null);
    convo.markModified('flow');
    // fall through — the message routes as a normal request below.
  }

  // Structured responses to open rounds.
  if (ir && openRound && awaiting === 'clarify') {
    const resolved = resolveQuestions(openRound.questions, ir.answers, ir.skipAll);
    closeStoredRound(convo, openRound.id, ir.skipAll ? 'skipped' : 'answered', resolved);
    const brief = mergeResolvedRound(currentBrief(convo, ctx.userText), resolved);
    convo.set('flow.brief', brief);
    convo.set('flow.awaiting', null);
    convo.set('flow.openInteractionId', null);
    convo.markModified('flow');
    return runBuildTurn(ctx, brief);
  }
  if (ir && openRound && awaiting === 'cost_questions') {
    const resolved = resolveQuestions(openRound.questions, ir.answers, ir.skipAll);
    closeStoredRound(convo, openRound.id, ir.skipAll ? 'skipped' : 'answered', resolved);
    convo.set('flow.awaiting', null);
    convo.set('flow.openInteractionId', null);
    convo.markModified('flow');
    return runCostOptionsTurn(ctx, resolved);
  }
  if (ir && openRound && awaiting === 'cost_options') {
    closeStoredRound(convo, openRound.id, ir.skipAll ? 'skipped' : 'answered');
    return runApplyFinalizeTurn(ctx, ir.skipAll ? null : (ir.selectedOptionId ?? null));
  }

  // Free text while a round is open (research D8). An approval round never
  // reaches here — it was fully resolved (or superseded) above.
  if (!ir && awaiting && awaiting !== 'approval' && openRound) return routeFreeTextDuringRound(ctx, awaiting, openRound);

  // No open round. Switch intent on a completed flow (FR-011)?
  const storedOptions = (convo.flow?.pricingOptions ?? []) as unknown as PricingOption[];
  if (storedOptions.length >= 2) {
    const target = detectSwitchIntent(ctx.userText, storedOptions);
    if (target && target !== (convo.flow?.selectedOptionId ?? null)) {
      return runSwitchTurn(ctx, storedOptions.find((o) => o.id === target)!);
    }
  }

  // Degraded/toolless paths keep today's behavior byte-compatible (FR-014):
  // the legacy turn asks to attach tools / runs the heuristic plan.
  if (activeTools.length === 0 || !llmAvailable()) return runLegacyTurn(ctx, null);

  // ---- 008 US1: intent & reference resolution on a follow-up ----------------
  // Only when there is something on the canvas to refer to, and only for real
  // typed text (a pure interaction response has already been handled above).
  const canvasNodes = (ctx.arch?.nodes ?? []) as unknown as { nodeId: string; serviceId: string; displayName?: string }[];
  if (canvasNodes.length > 0 && ctx.body.text.trim().length > 0) {
    ctx.emitter.step('intent', 'intent', 1, 'Understanding the request', 'running');
    let scope: EditScope;
    try {
      scope = await resolveIntent({
        text: ctx.userText,
        context: ctx.conversationContext,
        canvas: { nodes: canvasNodes.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, displayName: n.displayName })) },
        signal: ctx.signal,
      });
    } catch (e) {
      if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, 'analyze');
      throw e;
    }
    ctx.emitter.step('intent', 'intent', 1, 'Understanding the request', 'done',
      `${scope.kind}${scope.targets.length ? ` · ${scope.targets.length} element(s) resolved` : ''}`);

    const handled = await handleResolvedIntent(ctx, scope);
    if (handled) return handled;
    // Anything the fast paths decline falls through to the normal guided flow,
    // carrying the resolved scope so the planner is constrained to it (FR-009).
    return runAnalyzeTurn(ctx, scope);
  }

  return runAnalyzeTurn(ctx);
}

/**
 * 008 US1 — the branches that must NOT reach the design loop.
 *
 * Returns a promise when the turn is fully handled here, or null to fall
 * through to the normal analyze/build path. Each branch exists because running
 * the planner for it is actively wrong, not merely wasteful:
 *   question — answering must never mutate the canvas (FR-007)
 *   undo     — a restore is destructive, so it is offered, never performed
 *              automatically (FR-008)
 *   ambiguous— guessing between two candidates risks deleting the wrong node,
 *              so ask exactly one question instead (FR-006)
 *   trivial  — rename/remove/reconfigure are deterministic; the loop would cost
 *              seconds and a large-model request for no benefit (FR-005)
 */
async function handleResolvedIntent(ctx: TurnCtx, scope: EditScope): Promise<unknown | null> {
  const { arch } = ctx;

  if (scope.kind === 'question') {
    return answerOnlyTurn(ctx, scope);
  }

  if (scope.kind === 'undo') {
    return endTurnWithAnswer(ctx, {
      replyText:
        'I can restore an earlier version rather than redesigning anything — open **Version history** in the toolbar and pick the point you want to go back to. ' +
        'I have left the current diagram exactly as it is, so nothing is lost either way. ' +
        'If you would rather I change something specific instead, tell me what to change.',
    });
  }

  if (scope.kind === 'ambiguous' && scope.targets.length > 1) {
    const byId = new Map(
      ((arch?.nodes ?? []) as unknown as { nodeId: string; serviceId: string; displayName?: string }[]).map((n) => [n.nodeId, n])
    );
    const names = scope.targets.slice(0, 4).map((t) => {
      const node = byId.get(t.nodeId);
      return node?.displayName ? `**${node.displayName}** (${node.serviceId})` : `**${node?.serviceId ?? t.nodeId}**`;
    });
    // Asked as plain text rather than a structured round on purpose: the answer
    // arrives as an ordinary follow-up, and because the assistant's question is
    // now part of the conversation context, the next intent resolution has
    // exactly what it needs to disambiguate. No new round-answer plumbing, and
    // the canvas is untouched either way.
    return endTurnWithAnswer(ctx, {
      replyText:
        `More than one element matches that — did you mean ${names.slice(0, -1).join(', ')} or ${names.at(-1)}? ` +
        'I have not changed anything yet; tell me which one and I will make the change.',
    });
  }

  // Deterministic fast path — no design loop, no large-model call.
  if (scope.kind === 'rename' || scope.kind === 'remove' || scope.kind === 'reconfigure') {
    const result = applyDirectEdit(scope, {
      nodes: (arch?.nodes ?? []) as never,
      edges: (arch?.edges ?? []) as never,
      containers: (arch?.containers ?? []) as never,
      annotations: (arch?.annotations ?? []) as never,
    });
    if (result.applied) return runDirectEditTurn(ctx, result);
    // Declined (e.g. a rename with no new name) — the full path can still do it.
  }

  return null;
}

/**
 * 008 FR-002 — 1-based turn index used to stamp `firstSeenTurn` on a newly
 * stated requirement, so the ledger can show how long something has been
 * outstanding. Counting user messages is stable across restarts and matches
 * what the user perceives as "turns".
 */
function turnIndex(convo: TurnCtx['convo']): number {
  return Math.max(1, convo.messages.filter((m) => m.role === 'user').length);
}

function currentBrief(convo: TurnCtx['convo'], fallbackText: string): RequirementBrief {
  const stored = convo.flow?.brief;
  if (stored) return JSON.parse(JSON.stringify(stored)) as RequirementBrief;
  return {
    requestText: fallbackText,
    requestClass: 'major_revision',
    capabilities: [],
    scaleAssumptions: [],
    constraints: [],
    changeScope: [],
    selections: [],
    defaultsApplied: [],
  };
}

async function routeFreeTextDuringRound(ctx: TurnCtx, awaiting: 'clarify' | 'cost_questions' | 'cost_options', openRound: Interaction) {
  const { convo } = ctx;

  if (awaiting === 'cost_options') {
    const options = (convo.flow?.pricingOptions ?? []) as unknown as PricingOption[];
    const target = detectSwitchIntent(ctx.userText, options);
    if (target) {
      closeStoredRound(convo, openRound.id, 'answered');
      return runApplyFinalizeTurn(ctx, target);
    }
    if (/\b(skip|keep (the )?current|no thanks|neither)\b/i.test(ctx.userText)) {
      closeStoredRound(convo, openRound.id, 'skipped');
      return runApplyFinalizeTurn(ctx, null);
    }
    // Something else entirely — handle it as a normal turn; the options round stays open.
    return runLegacyTurn(ctx, null);
  }

  // clarify / cost_questions: interpret the reply against the open questions.
  let outcome;
  try {
    outcome = await interpretResponse({
      text: ctx.userText,
      questions: openRound.questions,
      originalRequest: convo.flow?.brief?.requestText ?? ctx.userText,
      signal: ctx.signal,
    });
  } catch (e) {
    if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, awaiting === 'clarify' ? 'analyze' : 'cost');
    throw e;
  }

  if (outcome.kind === 'followup') {
    // Conflict detected (spec edge case): ONE targeted follow-up replaces the round.
    closeStoredRound(convo, openRound.id, 'superseded');
    const question: ValidationQuestion = {
      id: 'q1', prompt: outcome.question, why: 'Your answers point in two different directions — this resolves the conflict.',
      kind: 'text', options: [], skippable: true,
    };
    const interaction = openInteraction(awaiting === 'clarify' ? 'clarify' : 'cost_questions', [question]);
    return endTurnWithRound(ctx, {
      replyText: 'Quick check before I continue — your answers conflict on one point.',
      interaction,
      awaiting,
      flowPhase: awaiting === 'clarify' ? 'analyze' : 'cost',
    });
  }

  if (outcome.kind === 'request_change') {
    // Material request change: supersede and re-analyze (never build on stale analysis).
    closeStoredRound(convo, openRound.id, 'superseded');
    convo.set('flow.awaiting', null);
    convo.set('flow.openInteractionId', null);
    convo.markModified('flow');
    if (awaiting === 'clarify') return runAnalyzeTurn(ctx);
    // A request change mid-cost-dialogue routes back through analysis too — the
    // architecture itself is being renegotiated.
    return runAnalyzeTurn(ctx);
  }

  // Interpreted answers resolve the round exactly like structured ones.
  const resolved = resolveQuestions(openRound.questions, outcome.answers, outcome.skipAll);
  closeStoredRound(convo, openRound.id, outcome.skipAll ? 'skipped' : 'answered', resolved);
  convo.set('flow.awaiting', null);
  convo.set('flow.openInteractionId', null);
  convo.markModified('flow');
  if (awaiting === 'clarify') {
    const brief = mergeResolvedRound(currentBrief(convo, ctx.userText), resolved);
    convo.set('flow.brief', brief);
    convo.markModified('flow');
    return runBuildTurn(ctx, brief);
  }
  return runCostOptionsTurn(ctx, resolved);
}

// ---- Analyze turn (006 FR-001–FR-005, T013/T028) ----------------------------------

async function runAnalyzeTurn(ctx: TurnCtx, editScope?: EditScope) {
  const { convo, arch, activeTools, emitter } = ctx;

  emitter.step('analyze', 'analyze', 1, 'Analyzing your request', 'running');
  let analysis: AnalyzeResult | null;
  try {
    analysis = await analyzeRequest({
      text: ctx.userText,
      activeTools,
      nodes: (arch?.nodes ?? []) as unknown as ArchNode[],
      edges: (arch?.edges ?? []) as unknown as ArchEdge[],
      containers: (arch?.containers ?? []) as unknown as ArchContainer[],
      annotations: (arch?.annotations ?? []) as unknown as ArchAnnotation[],
      conversationContext: ctx.conversationContext,
      signal: ctx.signal,
    });
  } catch (e) {
    if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, 'analyze');
    // Analysis is a guide, not a gate — a failure degrades to the legacy turn
    // rather than blocking the user (same spirit as the understand phase).
    console.error('[chat/messages] analyze phase failed, running legacy turn:', e);
    emitter.step('analyze', 'analyze', 1, 'Analyzing your request', 'failed');
    return runLegacyTurn(ctx, null);
  }
  if (!analysis) {
    emitter.step('analyze', 'analyze', 1, 'Analyzing your request', 'failed', 'AI assistant not configured');
    return runLegacyTurn(ctx, null);
  }
  emitter.step('analyze', 'analyze', 1, 'Analyzing your request', 'done',
    `${analysis.capabilities.length} capabilit${analysis.capabilities.length === 1 ? 'y' : 'ies'}, ${analysis.questions.length} question(s), class: ${analysis.requestClass}`);

  // An explicit "just build it / no questions / use defaults" in the request
  // skips the clarify round: build immediately on sensible defaults (they are
  // disclosed in the reply) instead of walking the full guided sequence.
  if (
    analysis.questions.length > 0 &&
    /\b(no questions|just build|build it now|skip (the )?questions|use (sensible |sane |the )?defaults|don'?t ask|without asking)\b/i.test(ctx.userText)
  ) {
    emitter.step('analyze-skip', 'analyze', 1, 'Skipping clarifying questions as requested', 'done',
      `${analysis.questions.length} question(s) answered with defaults`);
    analysis = { ...analysis, questions: [] };
  }

  // FR-013 — small edits bypass the guided sequence. At most ONE follow-up
  // question is allowed, and only when the edit itself is ambiguous.
  if (analysis.requestClass === 'small_edit') {
    const brief = briefFromAnalysis(analysis, ctx.userText);
    // Routing (Anthropic "Building Effective Agents" — add complexity only
    // when it demonstrably improves outcomes): a fully-specified small edit
    // reuses the brief analyze already computed (skipping the loop's own
    // redundant understand call) and runs lightweight (no MCP lookup, no
    // multi-round refine) instead of the full agentic pipeline.
    if (analysis.questions.length === 0) return runLegacyTurn(ctx, brief, { lightweight: true });
    const question = analysis.questions[0];
    convo.set('flow', {
      awaiting: null, brief, openInteractionId: null,
      preservedNodes: preservedFromArch(arch), pricingOptions: [], selectedOptionId: null, updatedAt: new Date(),
    });
    convo.markModified('flow');
    const interaction = openInteraction('clarify', [question]);
    return endTurnWithRound(ctx, {
      replyText: analysis.summary,
      interaction,
      awaiting: 'clarify',
      flowPhase: 'analyze',
    });
  }

  // 008 FR-002 — merge into the conversation's running ledger instead of
  // replacing it. This is the fix for root cause R3: previously this `set`
  // discarded every capability from earlier turns, so "multi-region DR" stated
  // in turn 1 silently stopped being graded once turn 2 was analyzed.
  const brief = mergeBrief(
    convo.flow?.brief as unknown as RequirementBrief | null,
    briefFromAnalysis(analysis, ctx.userText),
    turnIndex(convo),
    // A resolved modification tells us the scope explicitly; nothing is
    // withdrawn unless the user says so, so this stays empty for now.
    {}
  ) as RequirementBrief;
  convo.set('flow', {
    awaiting: null,
    brief,
    openInteractionId: null,
    preservedNodes: preservedFromArch(arch),
    pricingOptions: [],
    selectedOptionId: null,
    updatedAt: new Date(),
  });
  convo.markModified('flow');

  const confirmationNotes = analysis.collapsedChoices.length ? `\n\n${analysis.collapsedChoices.join('\n')}` : '';

  if (analysis.questions.length > 0) {
    // Clarify round opens; the canvas stays untouched (FR-005 — this turn
    // emitted no diagram events and persisted no architecture).
    const interaction = openInteraction('clarify', analysis.questions);
    return endTurnWithRound(ctx, {
      replyText: `${analysis.summary}${confirmationNotes}\n\nA few quick questions before I start building — answer what you can, or skip and I'll use sensible MVP-scale defaults.`,
      interaction,
      awaiting: 'clarify',
      flowPhase: 'analyze',
    });
  }

  // Fully specified (spec US1-S5): say so briefly and build in the same stream.
  return runBuildTurn(ctx, brief, `${analysis.summary}${confirmationNotes}`, editScope);
}

// ---- Build turn (006 FR-007/FR-008, T013/T022) -------------------------------------

async function runBuildTurn(ctx: TurnCtx, brief: RequirementBrief, analysisPreamble?: string, editScope?: EditScope) {
  const { project, convo, arch, activeTools, emit, emitter, turnStartedAt, isStopRequested, signal, guidanceCache } = ctx;

  let result: AgentLoopResult;
  try {
    result = await runAgentLoop(
      {
        text: brief.requestText || ctx.userText,
        activeTools,
        nodes: (arch?.nodes ?? []) as unknown as ArchNode[],
        edges: (arch?.edges ?? []) as unknown as ArchEdge[],
        containers: (arch?.containers ?? []) as unknown as ArchContainer[],
        annotations: (arch?.annotations ?? []) as unknown as ArchAnnotation[],
        guidance: (arch?.guidance ?? {}) as Record<string, string>,
        defaultRegion: project.defaultRegion,
        brief: briefContext(brief),
        designMode: ctx.designMode,
        conversationContext: ctx.conversationContext,
        // 008 FR-009 — a resolved modification constrains the planner to the
        // nodes the user actually referred to.
        editScopeNodeIds: editScope?.targets.map((t) => t.nodeId),
      },
      { emitter, isStopRequested, signal, guidanceCache }
    );
  } catch (e) {
    console.error('[chat/messages] architecture phase failed:', e);
    const retryable = e instanceof LlmError ? e.retryable : true;
    const text =
      e instanceof LlmError
        ? `Generation failed: ${e.message}`
        : 'Generation failed unexpectedly. Please retry.';
    await persistFailureAndRespond({ convo, project, emitter, emit, turnStartedAt, text, retryable, flowPhase: 'build' });
    return;
  }

  emitter.finalize();

  if (result.terminalStatus === 'stopped') {
    return persistStoppedLoop(ctx, result);
  }

  // agentic-concepts (HITL destructive_change) — a draft that removes a
  // meaningful share of the existing diagram is held for approval, never
  // auto-applied. Checked BEFORE persistence on purpose: the checkpoint's
  // whole value is that nothing has been written when the question is asked.
  if (result.changed && !result.unsatisfiable) {
    const checkpoint = destructiveChangeCheckpoint(
      (arch?.nodes ?? []) as unknown as { nodeId: string; serviceId?: string; displayName?: string }[],
      result.nodes
    );
    if (checkpoint) return runApprovalRequestTurn(ctx, result, checkpoint, 'build');
  }

  // Persist the updated architecture (unchanged 003/004 semantics).
  const version = await persistArchitectureResult(ctx, result);

  if (result.unsatisfiable) {
    return emitUnsatisfiable(ctx, result, version, 'build');
  }

  // agentic-concepts (Session Memory) — this turn's durable facts: the brief's
  // constraints/assumptions/selections plus the coverage outcome. Rides on
  // whichever save() ends the turn.
  recordSessionMemory(ctx, [
    ...deriveBriefMemory(brief, turnIndex(convo)),
    ...(result.coverage.length > 0
      ? [{ kind: 'outcome' as const, text: `Turn ${turnIndex(convo)}: ${coverageSummary(result.coverage)}`, turn: turnIndex(convo) }]
      : []),
  ]);

  const estimate = result.changed ? await recomputeProjectEstimate(project) : null;
  const disclosure = defaultsDisclosure(brief);

  // 008 FR-020 — learn from this turn's own correction. Fire-and-forget AFTER
  // the result is computed so it can never sit on the user's latency path, and
  // only when the first review actually rejected the draft and a later pass
  // fixed it: that pair is the only moment where both the problem and its
  // remedy are already established. A failure here is invisible by design —
  // nothing about the turn depends on it.
  if (result.distillable) {
    void distillTurnLesson(ctx, result.distillable);
  }

  // Official regional-availability check (AWS Knowledge MCP, free): flag any
  // planned service that AWS does not offer in the project's region. Honest
  // accuracy signal, best-effort — never blocks or fails the turn.
  let regionNote = '';
  const awsServiceIds = result.nodes.filter((n) => n.provider === 'aws').map((n) => n.serviceId);
  if (result.changed && awsServiceIds.length > 0) {
    const regionLabel = `Checking service availability in ${project.defaultRegion}`;
    emitter.step('region-check', 'validate', 1, regionLabel, 'running');
    try {
      const availability = await checkAwsRegionalAvailability(awsServiceIds, project.defaultRegion);
      const missing = availability.filter((a) => !a.available);
      emitter.step('region-check', 'validate', 1, regionLabel, 'done',
        missing.length > 0
          ? `${missing.length} service(s) not offered in ${project.defaultRegion}`
          : `${availability.length} service(s) confirmed available`);
      if (missing.length > 0) {
        regionNote = `⚠ Regional availability (official AWS data): ${missing.map((m) => m.product).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not offered in ${project.defaultRegion} — consider another region or an alternative service.`;
      }
    } catch {
      emitter.step('region-check', 'validate', 1, regionLabel, 'failed');
    }
  }

  const replyBase = [analysisPreamble, result.reply, regionNote, disclosure].filter(Boolean).join('\n\n');

  // Generic design modes (hld/lld): components carry no SKU, so the cost
  // dialogue and pricing options are meaningless — skip straight to the final
  // alignment pass, carrying the build reply and message metadata along.
  if (ctx.designMode !== 'cloud') {
    return runApplyFinalizeTurn(ctx, null, {
      replyBase,
      mcpCalls: result.mcpCalls,
      editsApplied: result.editsApplied,
      indicative: result.indicative,
      iterations: result.iterations,
      converged: result.converged,
      coverage: result.coverage,
    });
  }

  // Guided cost dialogue (FR-009): the build turn ends by asking the applicable
  // cost questions — or continues straight to options when none apply. The
  // legacy per-message cost-override step is owned by the guided dialogue here.
  let costQuestions: ValidationQuestion[] = [];
  // Step wrapper so the question-generation model call is attributed
  // (interpretability) — previously this call ran between steps.
  const costQLabel = 'Checking for cost questions';
  emitter.step('cost-questions', 'cost', 1, costQLabel, 'running');
  try {
    costQuestions = await generateCostQuestions({ nodes: result.nodes, brief, signal });
    emitter.step('cost-questions', 'cost', 1, costQLabel, 'done',
      costQuestions.length > 0 ? `${costQuestions.length} question(s) apply` : 'none apply');
  } catch (e) {
    if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, 'build');
    emitter.step('cost-questions', 'cost', 1, costQLabel, 'failed');
    costQuestions = [];
  }

  const architecturePayload = {
    nodes: result.nodes, edges: result.edges, containers: result.containers,
    annotations: result.annotations, guidance: result.guidance, version,
  };
  const messageExtras = {
    architecture: architecturePayload,
    estimate,
    mcpCalls: result.mcpCalls,
    editsApplied: result.editsApplied,
    indicative: result.indicative,
    iterations: result.iterations,
    converged: result.converged,
    coverage: result.coverage,
  };

  if (costQuestions.length > 0) {
    const interaction = openInteraction('cost_questions', costQuestions);
    return endTurnWithRound(ctx, {
      replyText: `${replyBase}\n\nBefore I price this: a couple of cost questions — answer or skip, and I'll show you a cheapest and a best-practice option.`,
      interaction,
      awaiting: 'cost_questions',
      flowPhase: 'build',
      ...messageExtras,
    });
  }

  // No applicable cost questions — generate the options in the same stream.
  return runCostOptionsTurn(ctx, [], { replyBase, flowPhase: 'build', ...messageExtras });
}

// ---- Cost turn (006 FR-010, T022) ---------------------------------------------------

async function runCostOptionsTurn(
  ctx: TurnCtx,
  costAnswers: ValidationQuestion[],
  carried?: {
    replyBase: string;
    flowPhase: FlowPhase;
    architecture?: Record<string, unknown>;
    estimate?: unknown;
    mcpCalls?: { provider: ProviderId; tool: string; status: 'ok' | 'failed' }[];
    editsApplied?: string[];
    indicative?: boolean;
    iterations?: number;
    converged?: boolean;
    coverage?: RequirementCoverage[];
  }
) {
  const { project, convo, emitter, signal } = ctx;

  // Price against the CURRENT persisted architecture (the build just wrote it).
  const arch = await Architecture.findOne({ projectId: project._id }).lean();
  const nodes = (arch?.nodes ?? []) as unknown as ArchNode[];
  const brief = (convo.flow?.brief ?? null) as unknown as RequirementBrief | null;

  emitter.step('options', 'options', 1, 'Preparing cheapest and best-practice pricing options', 'running');
  let options: PricingOption[];
  try {
    options = await generatePricingOptions({ nodes, defaultRegion: project.defaultRegion, brief, costAnswers, signal });
  } catch (e) {
    if (e instanceof LlmAbortError) return persistStoppedShortTurn(ctx, 'cost');
    // generatePricingOptions already degrades internally; reaching here means
    // pricing itself failed — surface it without losing the open flow.
    console.error('[chat/messages] pricing options failed:', e);
    emitter.step('options', 'options', 1, 'Preparing cheapest and best-practice pricing options', 'failed');
    await persistFailureAndRespond({
      convo: ctx.convo, project, emitter, emit: ctx.emit, turnStartedAt: ctx.turnStartedAt,
      text: 'I could not price the configuration options. Please retry.', retryable: true, flowPhase: 'cost',
    });
    return;
  }
  const degraded = options.some((o) => o.degraded);
  emitter.step('options', 'options', 1, 'Preparing cheapest and best-practice pricing options', 'done',
    options.map((o) => `${o.label}: ~$${o.monthly}/mo`).join(' · '));

  convo.set('flow.pricingOptions', options);
  convo.markModified('flow');

  const optionsIntro = degraded
    ? 'Here are two configuration options (one derived from catalog defaults — the detailed optimizer was unavailable):'
    : 'Here are two priced configurations — pick one, or skip to keep the current setup:';
  const interaction = openInteraction('cost_options', [], options);
  return endTurnWithRound(ctx, {
    replyText: [carried?.replyBase, optionsIntro].filter(Boolean).join('\n\n'),
    interaction,
    awaiting: 'cost_options',
    flowPhase: carried?.flowPhase ?? 'cost',
    architecture: carried?.architecture,
    estimate: carried?.estimate,
    mcpCalls: carried?.mcpCalls,
    editsApplied: carried?.editsApplied,
    indicative: carried?.indicative,
    iterations: carried?.iterations,
    converged: carried?.converged,
    coverage: carried?.coverage,
  });
}

// ---- Apply + finalize turn (006 FR-011/FR-012, T026) --------------------------------

async function runApplyFinalizeTurn(
  ctx: TurnCtx,
  selectedOptionId: string | null,
  /** generic-mode build path (hld/lld): the build turn's reply and metadata, carried through the finalize */
  carried?: {
    replyBase: string;
    mcpCalls: { provider: ProviderId; tool: string; status: 'ok' | 'failed' }[];
    editsApplied: string[];
    indicative: boolean;
    iterations: number;
    converged: boolean;
    coverage?: RequirementCoverage[];
  }
) {
  const { project, convo, emitter } = ctx;
  const options = (convo.flow?.pricingOptions ?? []) as unknown as PricingOption[];
  const option = selectedOptionId ? options.find((o) => o.id === selectedOptionId) ?? null : null;

  const archDoc = await Architecture.findOne({ projectId: project._id });
  if (!archDoc) {
    await persistFailureAndRespond({
      convo, project, emitter, emit: ctx.emit, turnStartedAt: ctx.turnStartedAt,
      text: 'There is no architecture to finalize — generate one first.', retryable: false, flowPhase: 'finalize',
    });
    return;
  }

  let nodes = archDoc.nodes.map((n) => JSON.parse(JSON.stringify(n)) as ArchNode);
  const edges = archDoc.edges.map((e) => JSON.parse(JSON.stringify(e)) as ArchEdge);
  let containers = archDoc.containers.map((c) => JSON.parse(JSON.stringify(c)) as ArchContainer);

  // Apply the chosen option's configs (clamped) and reprice — config-only, never structural (FR-011).
  if (option) {
    emitter.step('options', 'options', 1, `Applying the ${option.label} configuration`, 'running');
    nodes = applyOptionToNodes(nodes, option);
    const priced = await priceNodes(
      nodes.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider, config: n.config })),
      project.defaultRegion
    );
    for (const n of nodes) {
      const line = priced.perService.find((p) => p.nodeId === n.nodeId);
      if (line) {
        n.cost = line.cost;
        n.costBasis = line.basis;
      }
    }
    emitter.step('options', 'options', 1, `Applying the ${option.label} configuration`, 'done');
  }

  // Final alignment-and-flow pass (FR-012): full ELK for fresh builds, restore +
  // nudge for revisions; honest note when overlaps could not be fully resolved.
  emitter.step('finalize', 'finalize', 1, 'Setting the final alignment and flow', 'running');
  const preserved = ((convo.flow?.preservedNodes ?? []) as unknown as PreservedNode[]);
  const finalized = await finalizeArchitecture({ nodes, edges, containers, preserved });
  nodes = finalized.nodes;
  containers = finalized.containers;
  // Part of "alignment and flow": connect each edge on the side its geometry
  // now calls for. Fills absent sides only — a side the user pinned stays —
  // and this is also where LEGACY documents get sides, since finalize is the
  // one pass that re-reads and re-writes an old diagram wholesale.
  assignEdgeSides(nodes, containers, edges);
  emitter.step('finalize', 'finalize', 1, 'Setting the final alignment and flow', 'done',
    finalized.residualOverlaps > 0 ? `${finalized.residualOverlaps} overlap(s) could not be fully resolved` : 'Clean layout — no overlaps');

  // Persist once for the whole apply+finalize step ("latest completed change wins").
  // Edges included: the side assignment above is part of this pass's output.
  emitter.step('persist', 'persist', 1, 'Updating the diagram', 'running');
  const current = await Architecture.findOne({ projectId: project._id }).select('version');
  const version = (current?.version ?? 0) + 1;
  await Architecture.updateOne(
    { projectId: project._id },
    { $set: { nodes, edges, containers, version, generatedFrom: convo._id } }
  );
  // 007 1.1 — version history snapshot (best-effort).
  await recordArchitectureVersion({
    projectId: project._id,
    ownerId: project.ownerId,
    version,
    source: 'chat-turn',
    summary: [
      option ? `Applied the ${option.label} pricing configuration` : 'Final alignment and flow pass',
      ...(carried?.editsApplied ?? []),
    ],
    snapshot: {
      nodes,
      edges,
      containers,
      annotations: JSON.parse(JSON.stringify(archDoc.annotations ?? [])),
      guidance: JSON.parse(JSON.stringify(archDoc.guidance ?? {})),
    },
  });
  emitter.step('persist', 'persist', 1, 'Updating the diagram', 'done');

  const estimate = await recomputeProjectEstimate(project);

  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: carried?.iterations ?? 1, converged: carried?.converged ?? true, stopped: false,
      terminalStatus: 'converged', startedAt: ctx.turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: 'finalize',
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const replyText = [
    carried?.replyBase ?? '',
    option
      ? `Applied the ${option.label} configuration — the estimate is now ~$${estimate.monthly}/mo. You can switch to the other option any time ("switch to the ${option.id === 'cheapest' ? 'best practice' : 'cheapest'} option").`
      : carried
        ? ''
        : 'Kept the current configuration.',
    'I also set the final alignment and flow of the diagram.',
    finalized.note ?? '',
  ].filter(Boolean).join('\n\n');

  const assistantMessage = {
    role: 'assistant' as const,
    text: replyText,
    attachedTools: [] as ProviderId[],
    mcpCalls: carried?.mcpCalls ?? [],
    editsApplied: carried?.editsApplied ?? (option ? [`Applied the ${option.label} pricing configuration`] : []),
    indicative: carried?.indicative ?? option?.indicative ?? false,
    ...(carried?.coverage && carried.coverage.length > 0 ? { coverage: carried.coverage } : {}),
    ...(runId
      ? {
          runId,
          iterations: carried?.iterations ?? 1,
          converged: carried?.converged ?? true,
          stopped: false,
          stepCount: emitter.steps.length,
        }
      : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  // agentic-concepts (Session Memory) — the chosen pricing configuration is a
  // durable decision future turns must keep honoring.
  if (option) {
    recordSessionMemory(ctx, [
      { kind: 'decision', text: `Applied the ${option.label} pricing configuration (~$${estimate.monthly}/mo)`, turn: turnIndex(convo) },
    ]);
  }
  convo.set('flow.awaiting', null);
  convo.set('flow.openInteractionId', null);
  convo.set('flow.selectedOptionId', option?.id ?? null);
  convo.set('flow.updatedAt', new Date());
  convo.status = 'idle';
  convo.stopRequested = false;
  convo.markModified('flow');
  await convo.save();

  ctx.emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      architecture: {
        nodes, edges, containers,
        annotations: archDoc.annotations, guidance: archDoc.guidance, version,
      },
      estimate,
      conversation: { status: 'idle', activeTools: ctx.activeTools },
      flow: flowSnapshot(convo),
    },
  });
}

// ---- Switch turn (006 FR-011) --------------------------------------------------------

async function runSwitchTurn(ctx: TurnCtx, option: PricingOption) {
  const { project, convo, emitter } = ctx;
  const archDoc = await Architecture.findOne({ projectId: project._id });
  if (!archDoc) return runLegacyTurn(ctx, null);

  emitter.step('options', 'options', 1, `Switching to the ${option.label} configuration`, 'running');
  let nodes = archDoc.nodes.map((n) => JSON.parse(JSON.stringify(n)) as ArchNode);
  nodes = applyOptionToNodes(nodes, option);
  const priced = await priceNodes(
    nodes.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider, config: n.config })),
    project.defaultRegion
  );
  for (const n of nodes) {
    const line = priced.perService.find((p) => p.nodeId === n.nodeId);
    if (line) {
      n.cost = line.cost;
      n.costBasis = line.basis;
    }
  }
  const current = await Architecture.findOne({ projectId: project._id }).select('version');
  const version = (current?.version ?? 0) + 1;
  // Config-only write — positions/structure untouched, so nothing re-lays out (FR-011).
  await Architecture.updateOne({ projectId: project._id }, { $set: { nodes, version, generatedFrom: convo._id } });
  // 007 1.1 — version history snapshot (best-effort).
  await recordArchitectureVersion({
    projectId: project._id,
    ownerId: project.ownerId,
    version,
    source: 'chat-turn',
    summary: [`Switched to the ${option.label} pricing configuration`],
    snapshot: {
      nodes,
      edges: JSON.parse(JSON.stringify(archDoc.edges ?? [])),
      containers: JSON.parse(JSON.stringify(archDoc.containers ?? [])),
      annotations: JSON.parse(JSON.stringify(archDoc.annotations ?? [])),
      guidance: JSON.parse(JSON.stringify(archDoc.guidance ?? {})),
    },
  });
  const estimate = await recomputeProjectEstimate(project);
  emitter.step('options', 'options', 1, `Switching to the ${option.label} configuration`, 'done', `~$${estimate.monthly}/mo`);

  emitter.finalize();
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: 1, converged: true, stopped: false,
      terminalStatus: 'converged', startedAt: ctx.turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase: 'cost',
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: `Switched to the ${option.label} configuration — the estimate is now ~$${estimate.monthly}/mo.`,
    attachedTools: [] as ProviderId[],
    mcpCalls: [],
    editsApplied: [`Applied the ${option.label} pricing configuration`],
    indicative: option.indicative,
    ...(runId ? { runId, iterations: 1, converged: true, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  recordSessionMemory(ctx, [
    { kind: 'decision', text: `Switched to the ${option.label} pricing configuration (~$${estimate.monthly}/mo)`, turn: turnIndex(convo) },
  ]);
  convo.set('flow.selectedOptionId', option.id);
  convo.set('flow.updatedAt', new Date());
  convo.status = 'idle';
  convo.stopRequested = false;
  convo.markModified('flow');
  await convo.save();

  ctx.emit({
    type: 'result',
    payload: {
      message: assistantMessage,
      architecture: {
        nodes, edges: archDoc.edges, containers: archDoc.containers,
        annotations: archDoc.annotations, guidance: archDoc.guidance, version,
      },
      estimate,
      conversation: { status: 'idle', activeTools: ctx.activeTools },
      flow: flowSnapshot(convo),
    },
  });
}

// ---- Shared loop-result persistence (build + legacy turns) ---------------------------

async function persistArchitectureResult(ctx: TurnCtx, result: AgentLoopResult): Promise<number> {
  const { project, convo, arch, emitter } = ctx;
  let version = arch?.version ?? 0;
  if (result.changed && !result.unsatisfiable) {
    emitter.step('persist', 'persist', result.iterations, 'Updating the diagram', 'running');
    const current = await Architecture.findOne({ projectId: project._id }).select('version');
    version = (current?.version ?? 0) + 1;
    await Architecture.updateOne(
      { projectId: project._id },
      {
        $set: {
          ownerId: project.ownerId,
          nodes: result.nodes,
          edges: result.edges,
          containers: result.containers,
          annotations: result.annotations,
          guidance: result.guidance,
          version,
          generatedFrom: convo._id,
        },
      },
      { upsert: true }
    );
    project.providers = [...new Set(result.nodes.map((n) => n.provider))] as ProviderId[];
    if (project.status === 'draft' && result.nodes.length > 0) project.status = 'active';
    await project.save();
    // 007 1.1 — version history snapshot (best-effort).
    await recordArchitectureVersion({
      projectId: project._id,
      ownerId: project.ownerId,
      version,
      source: 'chat-turn',
      summary: result.editsApplied,
      snapshot: {
        nodes: result.nodes,
        edges: result.edges,
        containers: result.containers,
        annotations: result.annotations,
        guidance: result.guidance,
      },
    });
    emitter.step('persist', 'persist', result.iterations, 'Updating the diagram', 'done');
  }
  return version;
}

async function persistStoppedLoop(ctx: TurnCtx, result: AgentLoopResult) {
  const { convo, project, emitter, emit, turnStartedAt, activeTools } = ctx;
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: result.iterations, converged: false, stopped: true,
      terminalStatus: 'stopped', startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist stopped run:', persistError);
  }
  const assistantMessage = {
    role: 'assistant' as const,
    text: 'Generation stopped at your request.',
    attachedTools: [] as ProviderId[],
    mcpCalls: result.mcpCalls,
    editsApplied: [],
    indicative: false,
    ...(runId ? { runId, iterations: result.iterations, converged: false, stopped: true, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();
  emit({ type: 'stopped', partial: { message: assistantMessage, conversation: { status: 'idle', activeTools } } });
}

async function emitUnsatisfiable(ctx: TurnCtx, result: AgentLoopResult, version: number, flowPhase?: FlowPhase) {
  const { convo, project, emitter, emit, turnStartedAt, activeTools } = ctx;
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: result.iterations, converged: result.converged, stopped: false,
      terminalStatus: 'best_effort', startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls, flowPhase,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }
  const assistantMessage = {
    role: 'assistant' as const,
    text: result.reply,
    attachedTools: [] as ProviderId[],
    mcpCalls: result.mcpCalls,
    editsApplied: result.editsApplied,
    indicative: result.indicative,
    ...(result.coverage.length > 0 ? { coverage: result.coverage } : {}),
    ...(runId ? { runId, iterations: result.iterations, converged: result.converged, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();

  const payload = {
    message: assistantMessage,
    architecture: {
      nodes: result.nodes, edges: result.edges, containers: result.containers,
      annotations: result.annotations, guidance: result.guidance, version,
    },
    estimate: null,
    conversation: { status: 'idle', activeTools },
  };
  emit({ type: 'unsatisfiable', error: result.reply, partial: result.changed ? payload : undefined });
}

// ---- Legacy turn (features 003/004/005, byte-compatible — FR-013/FR-014) -------------

async function runLegacyTurn(ctx: TurnCtx, brief: RequirementBrief | null, opts?: { lightweight?: boolean }) {
  const { session, project, convo, arch, activeTools, emit, emitter, turnStartedAt, isStopRequested, signal, guidanceCache } = ctx;
  let result: AgentLoopResult;
  try {
    result = await runAgentLoop(
      {
        text: ctx.userText,
        activeTools,
        nodes: (arch?.nodes ?? []) as unknown as ArchNode[],
        edges: (arch?.edges ?? []) as unknown as ArchEdge[],
        containers: (arch?.containers ?? []) as unknown as ArchContainer[],
        annotations: (arch?.annotations ?? []) as unknown as ArchAnnotation[],
        guidance: (arch?.guidance ?? {}) as Record<string, string>,
        defaultRegion: project.defaultRegion,
        // A small-edit follow-up answer still informs the loop (FR-013).
        brief: brief ? briefContext(brief) : null,
        lightweight: opts?.lightweight ?? false,
        designMode: ctx.designMode,
      },
      { emitter, isStopRequested, signal, guidanceCache }
    );
  } catch (e) {
    console.error('[chat/messages] architecture phase failed:', e);
    const retryable = e instanceof LlmError ? e.retryable : true;
    const text =
      e instanceof LlmError
        ? `Generation failed: ${e.message}`
        : 'Generation failed unexpectedly. Please retry.';
    await persistFailureAndRespond({ convo, project, emitter, emit, turnStartedAt, text, retryable });
    return;
  }

  emitter.finalize();

  if (result.terminalStatus === 'stopped') {
    return persistStoppedLoop(ctx, result);
  }

  // agentic-concepts (HITL destructive_change) — same approval gate as the
  // guided build turn: held, never auto-applied.
  if (result.changed && !result.unsatisfiable) {
    const checkpoint = destructiveChangeCheckpoint(
      (arch?.nodes ?? []) as unknown as { nodeId: string; serviceId?: string; displayName?: string }[],
      result.nodes
    );
    if (checkpoint) return runApprovalRequestTurn(ctx, result, checkpoint, 'build');
  }

  const version = await persistArchitectureResult(ctx, result);

  // agentic-concepts (Session Memory) — durable facts from this turn.
  recordSessionMemory(ctx, [
    ...(brief ? deriveBriefMemory(brief, turnIndex(convo)) : []),
    ...(result.coverage.length > 0
      ? [{ kind: 'outcome' as const, text: `Turn ${turnIndex(convo)}: ${coverageSummary(result.coverage)}`, turn: turnIndex(convo) }]
      : []),
  ]);

  // Cost phase (003 FR-006/FR-008a) — unchanged for legacy/small-edit turns.
  let estimate: Awaited<ReturnType<typeof recomputeProjectEstimate>> | null = null;
  let clarification: string | null = null;
  let costError: { error: string; retryable: boolean } | null = null;
  if (!result.unsatisfiable) {
    emitter.step('cost', 'cost', result.iterations, 'Reviewing cost instructions & recalculating estimate', 'running');
    try {
      const costTurn = await orchestrateCostTurn({
        text: ctx.userText,
        nodes: result.nodes.map((n) => ({
          nodeId: n.nodeId,
          serviceId: n.serviceId,
          displayName: n.displayName,
          config: n.config,
          cost: n.cost,
        })),
        addRefIds: result.addRefIds,
      });
      if (costTurn.clarificationQuestion) {
        clarification = costTurn.clarificationQuestion;
      } else {
        for (const intent of costTurn.intents) {
          const node = result.nodes.find((n) => n.nodeId === intent.nodeId);
          await CostEstimateOverride.updateOne(
            { projectId: project._id, nodeId: intent.nodeId },
            {
              $set: {
                ...(intent.field === 'quantity'
                  ? { quantityOverride: intent.value }
                  : { totalCostOverride: intent.value }),
                configSnapshot: node?.config ?? {},
                source: 'chat',
                setBy: session.sub,
                setAt: new Date(),
              },
              $setOnInsert: { ownerId: project.ownerId },
            },
            { upsert: true }
          );
        }
      }
      if (result.changed || costTurn.intents.length > 0) {
        estimate = await recomputeProjectEstimate(project);
      }
      emitter.step('cost', 'cost', result.iterations, 'Reviewing cost instructions & recalculating estimate', 'done');
    } catch (e) {
      console.error('[chat/messages] cost phase failed:', e);
      emitter.step('cost', 'cost', result.iterations, 'Reviewing cost instructions & recalculating estimate', 'failed');
      costError = {
        error:
          e instanceof LlmError
            ? `Cost estimation failed: ${e.message}`
            : 'Cost estimation failed unexpectedly. Please retry.',
        retryable: e instanceof LlmError ? e.retryable : true,
      };
    }
  }

  const replyText = clarification
    ? result.changed
      ? `${result.reply}\n\n${clarification}`
      : clarification
    : costError
      ? `${result.reply}\n\n${costError.error}`
      : result.reply;

  const terminalStatus: 'converged' | 'best_effort' = result.unsatisfiable || !result.converged ? 'best_effort' : 'converged';
  let runId: unknown;
  try {
    const run = await createRun({
      convo, project, iterations: result.iterations, converged: result.converged, stopped: false,
      terminalStatus, startedAt: turnStartedAt, steps: emitter.steps, modelCalls: emitter.modelCalls,
    });
    runId = run._id;
  } catch (persistError) {
    console.error('[chat/messages] failed to persist run:', persistError);
  }

  const assistantMessage = {
    role: 'assistant' as const,
    text: replyText,
    attachedTools: [] as ProviderId[],
    mcpCalls: result.mcpCalls,
    editsApplied: result.editsApplied,
    indicative: result.indicative,
    ...(result.coverage.length > 0 ? { coverage: result.coverage } : {}),
    ...(costError ? { error: { step: 'cost' as const, retryable: costError.retryable } } : {}),
    ...(runId ? { runId, iterations: result.iterations, converged: result.converged, stopped: false, stepCount: emitter.steps.length } : {}),
    createdAt: new Date(),
  };
  convo.messages.push(assistantMessage);
  convo.status = 'idle';
  convo.stopRequested = false;
  await convo.save();

  const payload = {
    message: assistantMessage,
    architecture: {
      nodes: result.nodes,
      edges: result.edges,
      containers: result.containers,
      annotations: result.annotations,
      guidance: result.guidance,
      version,
    },
    estimate,
    conversation: { status: 'idle', activeTools },
    flow: flowSnapshot(convo),
  };

  if (result.unsatisfiable) {
    emit({ type: 'unsatisfiable', error: result.reply, partial: result.changed ? payload : undefined });
    return;
  }
  if (costError) {
    emit({ type: 'error', error: costError.error, retryable: costError.retryable, step: 'cost', partial: payload });
    return;
  }
  emit({ type: 'result', payload });
}
