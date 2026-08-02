import 'server-only';
import { llmAvailable, llmJson, LlmAbortError } from '@/lib/llm';
import type { ProviderId } from '@/lib/providers/types';
import type { GuidedBriefContext } from '@/lib/generate/flow';
import { summarizeArchitectureEdit } from '@/lib/generate/diff';
import { validateArchitecture } from '@/lib/generate/validate';
import { checkTopologyStructure, pruneEmptyContainers } from '@/lib/generate/topology';
import { reviewDraft, type RequirementCoverage, type ReviewVerdict } from '@/lib/generate/reviewer';
import { crossCheckTopology } from '@/lib/generate/topology-crosscheck';
import { assignEdgeSides } from '@/lib/generate/edge-sides';
import { retrieveKnowledge, recordKnowledgeUsage } from '@/lib/knowledge/store';
import { gatherKnowledge } from '@/lib/research/knowledge-agent';
import { renderKnowledgeBlock } from '@/lib/knowledge/types';
import { ITERATION_BUDGET, ABORT_THRESHOLD_MS, HARD_TIME_CAP_MS, chunkPlanDelayMs, CHUNK_ROUND_BUDGET, sleep } from '@/lib/generate/loop-config';
import type { TraceEmitter } from '@/lib/generate/trace-emitter';
import {
  gatherGuidance,
  planOneChunk,
  layoutIfStructural,
  priceArchitecture,
  architecturePrompt,
  type ArchNode,
  type ArchEdge,
  type ArchContainer,
  type ArchAnnotation,
  type Guidance,
  type DraftResult,
  type ChunkRoundResult,
  type OnChunkApplied,
  type TurnResult,
  type GuidanceCachePort,
  type GatherResult,
} from '@/lib/generate/orchestrator';

/**
 * Agent loop controller (feature 004 FR-001–FR-004, FR-009, FR-011; research
 * R2, R5, R7). Composes orchestrator.ts's backbone phases into the agentic
 * workflow: understand → gather (once) → [draft → validate → layout → price →
 * review → refine]* (≤ ITERATION_BUDGET), terminating on the first passing
 * review or when the iteration/time budget runs out (best-effort). Every
 * phase is emitted through the shared TraceEmitter (T005) so the live stream
 * and the persisted GenerationRun come from one source of truth.
 */

export interface AgentLoopInput {
  text: string;
  activeTools: ProviderId[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
  defaultRegion: string;
  /**
   * 006 FR-006/FR-008 — the consolidated requirement brief from the guided
   * clarify round. When present it REPLACES the internal understand phase
   * (single source of truth): its capabilities/changeScope drive the loop, its
   * selections become planner MUSTs and a reviewer hard gate.
   */
  brief?: GuidedBriefContext | null;
  /**
   * Routing (generation-quality improvement, Anthropic "Building Effective
   * Agents" — add complexity only when it demonstrably improves outcomes):
   * for a well-scoped small_edit, skip the live MCP guidance lookup entirely
   * and cap refinement at 1 iteration (review still runs once — the
   * deterministic hard-gate stays valuable — but a failing review ends the
   * turn best_effort instead of spending 2 more draft+review round-trips).
   */
  lightweight?: boolean;
  /**
   * Diagram mode from the dynamic router: 'cloud' (provider-specific, default),
   * 'hld' (generic high-level system design), 'lld' (generic low-level design).
   * Drives mode-specific planner guidance in the orchestrator.
   */
  designMode?: import('@/lib/generate/router').DesignMode;
  /** 008 FR-001 — rendered recent conversation, passed through to the planner. */
  conversationContext?: string;
  /**
   * 008 FR-009 — existing nodeIds this modification is scoped to. Stated to the
   * planner AND enforced code-side after each plan, because a prompt constraint
   * alone has never reliably kept the planner inside scope.
   */
  editScopeNodeIds?: string[];
}

export interface AgentLoopContext {
  emitter: TraceEmitter;
  /** fast Mongo read of conversation.stopRequested — checked at each phase boundary (research R5) */
  isStopRequested: () => Promise<boolean>;
  /** shared across every LLM call this turn; the caller aborts it on stop (FR-009) */
  signal: AbortSignal;
  /** reusable MCP-guidance cache (generation-quality improvement) — optional, undefined skips caching entirely */
  guidanceCache?: GuidanceCachePort;
}

export type LoopTerminalStatus = 'converged' | 'best_effort' | 'stopped';

export interface AgentLoopResult {
  terminalStatus: LoopTerminalStatus;
  iterations: number;
  converged: boolean;
  stopped: boolean;
  reply: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
  editsApplied: string[];
  mcpCalls: TurnResult['mcpCalls'];
  indicative: boolean;
  changed: boolean;
  unsatisfiable: boolean;
  addRefIds: (string | null)[];
  /**
   * 008 FR-020 — set only when the FIRST review rejected the draft and a later
   * pass corrected it. That pair is the highest-signal moment available: the
   * loop has already established both that something was wrong and what fixed
   * it, so no extra judgement is needed to learn from it. The route distils it
   * post-turn, off the latency path.
   */
  distillable?: { reviewGap: string; refinementFix: string };
  /**
   * Interpretability (2026-08): the final review's per-requirement verdicts —
   * each extracted requirement graded met/unmet against the APPLIED diagram,
   * with quoted evidence and the gap when unmet. Empty when no checklist was
   * supplied (small edits) or the turn never reached review. Persisted on the
   * assistant message so the user sees exactly what was evaluated and how.
   */
  coverage: RequirementCoverage[];
}

interface LoopState {
  nodes: ArchNode[];
  edges: ArchEdge[];
  containers: ArchContainer[];
  annotations: ArchAnnotation[];
  guidance: Guidance;
}

// ---- Understand phase (FR-001, research R7) ---------------------------------
// Requirements-extraction extension (Anthropic "Building effective agents",
// evaluator-optimizer): this phase now ALSO runs on an empty canvas — the
// primary generation case — because its capability list is the requirement
// checklist the planner receives as explicit MUSTs and the reviewer grades
// item by item. Previously the list was extracted only mid-conversation and
// then never consumed; now it is the loop's coverage rubric.

interface Understanding {
  capabilities: string[];
  /** existing nodeIds this request targets/must connect to; [] = unrestricted */
  changeScope: string[];
}

const UNDERSTAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['capabilities', 'changeScope'],
  properties: {
    capabilities: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Exhaustive plain-language checklist of every distinct requirement in this message: each capability/service asked for, each connection/data-flow implied ("API in front of the functions"), and each stated quality (HA/multi-AZ, backup/DR, security). One short item per requirement, phrased so a reviewer can later verify it against the diagram. Do not invent requirements the user did not state.',
    },
    changeScope: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Existing nodeIds (from the list given) that this request targets or will need to connect to. Leave empty if the request is an open-ended/full redesign that may touch anything, or the canvas is empty.',
    },
  },
} as const;

function sanitizeUnderstanding(raw: unknown, existingNodeIds: Set<string>): Understanding {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const capabilities = Array.isArray(p.capabilities)
    ? p.capabilities.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const changeScope = Array.isArray(p.changeScope)
    ? p.changeScope.filter((x): x is string => typeof x === 'string' && existingNodeIds.has(x))
    : [];
  return { capabilities, changeScope };
}

async function understandRequest(text: string, currentNodes: ArchNode[], signal: AbortSignal): Promise<Understanding> {
  const existingNodeIds = new Set(currentNodes.map((n) => n.nodeId));
  const nodeList = currentNodes.map((n) => `${n.nodeId}: ${n.serviceId}`).join(', ');
  const raw = await llmJson<unknown>({
    system: [
      'You analyze a user request against a cloud architecture canvas before any edits are made.',
      'Identify: (1) the exhaustive requirement checklist — every distinct capability, service,',
      'connection/data-flow, and stated quality (HA, DR, security, scale) the user explicitly asked',
      'for in this message; and (2) which EXISTING nodeIds (from the list given) this request',
      'targets or must connect to. Leave changeScope empty if the request is a full redesign that',
      'may reasonably touch anything, or the canvas is empty.',
    ].join('\n'),
    user: `${currentNodes.length > 0 ? `Existing nodes: ${nodeList}` : 'The canvas is currently empty.'}\n\nUser request: ${text}`,
    schema: UNDERSTAND_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
    signal,
  });
  return sanitizeUnderstanding(raw, existingNodeIds);
}

// ---- Preserve-user-work enforcement across refine passes (FR-011, research R7) ----

function snapshotProtected(nodes: ArchNode[], protectedIds: Set<string>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const n of nodes) if (protectedIds.has(n.nodeId)) snapshot.set(n.nodeId, JSON.stringify(n));
  return snapshot;
}

function protectedViolations(nodes: ArchNode[], snapshot: Map<string, string>): string[] {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const violations: string[] = [];
  for (const [id, serialized] of snapshot) {
    const current = byId.get(id);
    if (!current || JSON.stringify(current) !== serialized) violations.push(id);
  }
  return violations;
}

// ---- Chunk-planning round loop (005 FR-001/004/006/007/010, research R1/R3) ----
// Replaces a single draftAndApply() call with a small loop over planOneChunk():
// each round plans at most CHUNK_SIZE new services/containers, aware of every
// prior round's result within this same iteration (FR-004 — `roundState` is
// threaded forward), and the loop stops on `moreNeeded: false`, the round-budget
// safety cap, or the turn running low on time (FR-006). A round-1 failure
// propagates unchanged (existing 003/004 architecture-phase-failure contract,
// handled by the caller); a round ≥2 failure preserves every prior round's
// applied chunks and is swallowed here (FR-010). A stop observed BETWEEN
// rounds is reported via `stoppedMidRound` rather than thrown, so the caller
// can still run layout/price/validate on the already-applied chunks before
// reporting `stopped` — preserving them, per FR-007 — instead of discarding
// this iteration's whole draft the way a mid-LLM-call abort does.

interface ChunkRoundsInput {
  text: string;
  activeTools: ProviderId[];
  guidance: Guidance;
  mcpGuidance: string[];
  failed: ProviderId[];
  official: boolean;
  refinementInstructions?: string;
  /** 006 — brief context fed into every chunk round's planner prompt (T012) */
  brief?: GuidedBriefContext | null;
  /** extracted requirement checklist — restated to every planner round as explicit MUSTs */
  requirements?: string[];
  /** diagram mode from the dynamic router — threaded into every planner round */
  designMode?: import('@/lib/generate/router').DesignMode;
  /** 008 FR-001 — rendered recent conversation, threaded into every planner round */
  conversationContext?: string;
  /** 008 FR-019 — retrieved house rules, threaded into every planner round */
  knowledgeBlock?: string;
  /** 008 FR-009 — nodeIds this modification is scoped to */
  editScopeNodeIds?: string[];
  signal: AbortSignal;
}

interface ChunkRoundsOutcome {
  draft: ChunkRoundResult;
  /** a stop was observed between chunk rounds — no LLM call was aborted. */
  stoppedMidRound: boolean;
}

/**
 * Render-order refinement: interim chunk emits show every pre-existing
 * diagram element as-is, but hide any node/container introduced or
 * reparented THIS round — so new services stream onto the canvas "loose"
 * first, and containers (new ones, or a pre-existing node's move into one)
 * only reveal once the iteration's full, ELK-laid-out result is emitted
 * after layout (runAgentLoop, below). A node whose parentId points at a
 * container absent from the emitted containers array collapses to (0,0) in
 * @xyflow/react, so containment must be stripped from the node too, not just
 * omitted from the containers array.
 */
function forInterimEmit(
  nodes: ArchNode[],
  containers: ArchContainer[],
  preExistingContainerIds: Set<string>
): { nodes: ArchNode[]; containers: ArchContainer[] } {
  return {
    nodes: nodes.map((n) => (n.containerId && !preExistingContainerIds.has(n.containerId) ? { ...n, containerId: null } : n)),
    containers: containers.filter((c) => preExistingContainerIds.has(c.containerId)),
  };
}

/**
 * 008 FR-009 — nodes a draft changed that the request never referred to.
 *
 * Exported and pure so the rule is testable in isolation: a modification turn
 * may ADD what the user asked for, but must not remove or reconfigure an
 * element outside the resolved scope. That asymmetry is the whole point —
 * "rename that lambda" must never come back having also re-tuned the database.
 *
 * Position is deliberately NOT compared: layout is recomputed every turn, so
 * treating a moved node as a violation would reject every legitimate plan.
 */
export function outOfScopeViolations(
  before: readonly ArchNode[],
  after: readonly ArchNode[],
  allowedNodeIds: readonly string[]
): string[] {
  const allowed = new Set(allowedNodeIds);
  const afterById = new Map(after.map((n) => [n.nodeId, n]));
  const violations: string[] = [];
  for (const prev of before) {
    if (allowed.has(prev.nodeId)) continue;
    const next = afterById.get(prev.nodeId);
    if (!next) {
      violations.push(prev.nodeId);
      continue;
    }
    const configChanged = JSON.stringify(next.config ?? {}) !== JSON.stringify(prev.config ?? {});
    const serviceChanged = next.serviceId !== prev.serviceId;
    const renamed = (next.displayName ?? '') !== (prev.displayName ?? '');
    if (configChanged || serviceChanged || renamed) violations.push(prev.nodeId);
  }
  return violations;
}

async function runChunkRounds(
  input: ChunkRoundsInput,
  initialState: LoopState,
  iteration: number,
  emitter: TraceEmitter,
  isStopRequested: () => Promise<boolean>,
  timeRemaining: () => number
): Promise<ChunkRoundsOutcome> {
  let roundState = initialState;
  let chunkCounter = 0;
  const preExistingContainerIds = new Set(initialState.containers.map((c) => c.containerId));
  const onChunkApplied: OnChunkApplied = (nodes, edges, containers) => {
    chunkCounter++;
    const interim = forInterimEmit(nodes, containers, preExistingContainerIds);
    emitter.diagram(interim.nodes, edges, interim.containers, iteration, chunkCounter);
  };
  const planRound = (round: number, refinementInstructions: string | undefined) =>
    planOneChunk(
      {
        text: input.text,
        activeTools: input.activeTools,
        current: roundState,
        guidance: roundState.guidance,
        mcpGuidance: input.mcpGuidance,
        failed: input.failed,
        official: input.official,
        refinementInstructions,
        brief: input.brief,
        requirements: input.requirements,
        designMode: input.designMode,
        conversationContext: input.conversationContext,
        knowledgeBlock: input.knowledgeBlock,
        editScopeNodeIds: input.editScopeNodeIds,
        signal: input.signal,
      },
      { iteration, round },
      emitter.legacyProgress('draft', iteration, round > 1 ? round : undefined),
      onChunkApplied
    );

  let round = 1;
  // Round 1's failure is NOT caught here — it propagates to runAgentLoop's
  // existing try/catch, preserving the 003/004 "first draft failing" contract.
  let result: ChunkRoundResult = await planRound(round, input.refinementInstructions);
  roundState = { nodes: result.nodes, edges: result.edges, containers: result.containers, annotations: result.annotations, guidance: result.guidance };

  while (result.moreNeeded && !result.unsatisfiable && round < CHUNK_ROUND_BUDGET && timeRemaining() > ABORT_THRESHOLD_MS) {
    round++;
    if (await isStopRequested()) return { draft: result, stoppedMidRound: true };
    await sleep(chunkPlanDelayMs());
    try {
      result = await planRound(round, undefined);
    } catch (e) {
      if (e instanceof LlmAbortError) throw e;
      console.error(`[agent-loop] chunk round ${round} failed at iteration ${iteration}, keeping ${chunkCounter} already-applied chunk(s):`, e);
      break;
    }
    roundState = { nodes: result.nodes, edges: result.edges, containers: result.containers, annotations: result.annotations, guidance: result.guidance };
  }

  return { draft: result, stoppedMidRound: false };
}

// ---- Result assembly ---------------------------------------------------------

function buildResult(opts: {
  terminalStatus: LoopTerminalStatus;
  iterations: number;
  converged: boolean;
  original: LoopState;
  state: LoopState;
  draft: DraftResult | null;
  mcpCalls: TurnResult['mcpCalls'];
  replyOverride?: string;
  distillable?: { reviewGap: string; refinementFix: string };
  coverage?: RequirementCoverage[];
}): AgentLoopResult {
  const editsApplied = summarizeArchitectureEdit(opts.original, opts.state);
  const rawGuidance = opts.draft?.rawGuidance ?? {};
  // Connection sides from the FINAL geometry — after layout, after every chunk
  // round, on stopped partials too, since whatever is here is what persists.
  // Fills absent sides only: a side the user pinned on the canvas rode in on
  // the original document and stays exactly as they set it.
  assignEdgeSides(opts.state.nodes, opts.state.containers, opts.state.edges);
  return {
    ...(opts.distillable ? { distillable: opts.distillable } : {}),
    terminalStatus: opts.terminalStatus,
    iterations: opts.iterations,
    converged: opts.converged,
    stopped: opts.terminalStatus === 'stopped',
    reply: opts.replyOverride ?? opts.draft?.reply ?? '',
    nodes: opts.state.nodes,
    edges: opts.state.edges,
    containers: opts.state.containers,
    annotations: opts.state.annotations,
    guidance: opts.state.guidance,
    editsApplied,
    mcpCalls: opts.mcpCalls,
    indicative: opts.draft?.indicative ?? false,
    changed: editsApplied.length > 0 || JSON.stringify(rawGuidance) !== '{}',
    unsatisfiable: opts.draft?.unsatisfiable ?? false,
    addRefIds: opts.draft?.addRefIds ?? [],
    coverage: opts.coverage ?? [],
  };
}

function unmetSummary(unmetCapabilities: string[]): string {
  return `${unmetCapabilities.length} capabilit${unmetCapabilities.length === 1 ? 'y' : 'ies'} unmet: ${unmetCapabilities.join(', ')}`;
}

export async function runAgentLoop(input: AgentLoopInput, ctx: AgentLoopContext): Promise<AgentLoopResult> {
  const { emitter, isStopRequested, signal } = ctx;
  const original: LoopState = {
    nodes: input.nodes, edges: input.edges, containers: input.containers, annotations: input.annotations, guidance: input.guidance,
  };

  // FR-014a (001): no tool attached → ask, never guess. No loop needed.
  if (input.activeTools.length === 0) {
    return buildResult({
      terminalStatus: 'converged',
      iterations: 1,
      converged: true,
      original,
      state: original,
      draft: null,
      mcpCalls: [],
      replyOverride:
        'Please attach at least one provider tool (AWS and/or MongoDB Atlas) so I know which cloud to design for — I never guess. Use the attach chips next to the message box.',
    });
  }

  const turnStart = Date.now();
  const timeRemaining = () => HARD_TIME_CAP_MS - (Date.now() - turnStart);

  // Phase: understand (FR-001). Best-effort — a failure here degrades to an
  // unrestricted scope rather than failing a turn that would otherwise succeed.
  // 006 FR-006: a guided turn's brief REPLACES this phase entirely — the brief
  // is the single source of truth, so the loop never re-derives (and possibly
  // contradicts) what the user already confirmed.
  let understanding: Understanding = { capabilities: [], changeScope: [] };
  if (input.brief) {
    understanding = { capabilities: input.brief.capabilities, changeScope: input.brief.changeScope.filter((id) => input.nodes.some((n) => n.nodeId === id)) };
    const capCount = input.brief.capabilities.length;
    const selCount = input.brief.selectedServiceIds.length;
    const briefDetail = [
      `${capCount} confirmed capabilit${capCount === 1 ? 'y' : 'ies'}`,
      selCount > 0 ? `${selCount} selected service(s)` : '',
    ].filter(Boolean).join(', ');
    emitter.step('understand', 'understand', 1, 'Applying your confirmed requirements', 'done', briefDetail);
  } else if (llmAvailable()) {
    emitter.step('understand', 'understand', 1, 'Gathering your requirements', 'running');
    try {
      understanding = await understandRequest(input.text, input.nodes, signal);
      const capCount = understanding.capabilities.length;
      const detail = [
        capCount > 0 ? `${capCount} requirement${capCount === 1 ? '' : 's'} identified` : '',
        understanding.changeScope.length > 0
          ? `scoped to ${understanding.changeScope.length} existing service(s)`
          : input.nodes.length > 0
            ? 'open-ended change'
            : 'starting from an empty canvas',
      ].filter(Boolean).join(' — ');
      emitter.step('understand', 'understand', 1, 'Gathering your requirements', 'done', detail);
    } catch (e) {
      if (e instanceof LlmAbortError) {
        return buildResult({ terminalStatus: 'stopped', iterations: 0, converged: false, original, state: original, draft: null, mcpCalls: [] });
      }
      console.error('[agent-loop] understand phase failed, continuing unrestricted:', e);
      emitter.step('understand', 'understand', 1, 'Gathering your requirements', 'failed');
    }
  }

  // The coverage rubric for this turn: the guided brief's confirmed
  // capabilities when present (006 single-source-of-truth), otherwise the
  // checklist just extracted. Fed to every planner round as explicit MUSTs and
  // to the reviewer for item-by-item grading.
  const requirementChecklist = input.brief ? input.brief.capabilities : understanding.capabilities;

  if (await isStopRequested()) {
    return buildResult({ terminalStatus: 'stopped', iterations: 0, converged: false, original, state: original, draft: null, mcpCalls: [] });
  }

  // Phase: gather (once — refine passes below re-draft/validate/layout/price/
  // review only, per plan.md Scale/Scope, not a repeated MCP lookup). A
  // well-scoped small_edit (routing, Anthropic "Building Effective Agents" —
  // add complexity only when it demonstrably improves outcomes) skips the
  // live lookup entirely rather than emitting a step that would just no-op.
  const gathered: GatherResult = input.lightweight
    ? {
        mcpCalls: [],
        // Honest, non-degraded note — avoids the draft/review prompts' existing
        // "(No official MCP guidance available — mark as indicative)" caveat,
        // which is correct for a genuine MCP failure but wrong here: this turn
        // deliberately skipped a lookup it didn't need.
        mcpGuidance: ['(Well-scoped edit — official architecture guidance intentionally skipped; not required for this change.)'],
        failed: [],
        official: true, // keeps `indicative` accurate — this isn't a degraded turn
      }
    : await gatherGuidance(input.text, input.activeTools, original, emitter.legacyProgress('lookup', 1), ctx.guidanceCache, requirementChecklist);

  if (await isStopRequested()) {
    return buildResult({ terminalStatus: 'stopped', iterations: 0, converged: false, original, state: original, draft: null, mcpCalls: gathered.mcpCalls });
  }

  // 008 FR-019/FR-034 — stored house rules and learned lessons for this request.
  // Retrieved ONCE per turn (like the MCP gather) and given to BOTH the planner
  // and the reviewer, so rules are applied and graded from the same list — a
  // rule that is applied but never checked quietly stops being followed.
  // Best-effort: an empty result just means an ungrounded turn, as before.
  let knowledgeBlock = '';
  let knowledgeIds: unknown[] = [];
  if (requirementChecklist.length > 0) {
    emitter.step('knowledge', 'knowledge', 1, 'Consulting house rules', 'running');
    try {
      const entries = await retrieveKnowledge({
        keywords: requirementChecklist,
        provider: input.activeTools[0] ?? 'any',
        designMode: input.designMode ?? 'any',
      });
      knowledgeBlock = renderKnowledgeBlock(entries);
      knowledgeIds = entries.map((e) => e._id).filter(Boolean);
      emitter.step('knowledge', 'knowledge', 1, 'Consulting house rules', 'done',
        entries.length > 0 ? entries.map((e) => e.title).join('; ') : 'no matching rules');

      // 008 US4 FR-024 — nothing stored and no MCP guidance? Fall through to the
      // research rung, which fills the gap from official documentation and
      // writes the finding back so the next similar request needs no lookup.
      if (entries.length === 0) {
        const researched = await gatherKnowledge({
          keywords: requirementChecklist,
          provider: input.activeTools[0] ?? 'any',
          designMode: input.designMode ?? 'any',
          mcpGuidance: gathered.mcpGuidance,
          signal,
          onStep: (status, detail) =>
            emitter.step('research', 'research', 1, 'Researching official documentation', status, detail),
        });
        if (researched.block) knowledgeBlock = researched.block;
      }
    } catch {
      emitter.step('knowledge', 'knowledge', 1, 'Consulting house rules', 'failed');
    }
  }

  let state: LoopState = original;
  let draft: DraftResult | null = null;
  let verdict: ReviewVerdict = { pass: false, unmetCapabilities: [], refinementInstructions: '', coverage: [] };
  let iterations = 0;
  let converged = false;
  let firstReviewGap: string | null = null;
  let protectedSnapshot: Map<string, string> | null = null;
  /** protected-id set, computed once at iteration 1 and reused (topology's exemptNodeIds mirrors protectedSnapshot's scope) */
  let exemptNodeIds: Set<string> | undefined;
  const maxIterations = input.lightweight ? 1 : ITERATION_BUDGET;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    if (await isStopRequested()) {
      return buildResult({ terminalStatus: 'stopped', iterations: iteration - 1, converged: false, original, state, draft, mcpCalls: gathered.mcpCalls });
    }

    let draftResult: DraftResult;
    let stoppedMidRound = false;
    try {
      const rounds = await runChunkRounds(
        {
          text: input.text,
          activeTools: input.activeTools,
          guidance: state.guidance,
          mcpGuidance: gathered.mcpGuidance,
          failed: gathered.failed,
          official: gathered.official,
          refinementInstructions: iteration > 1 ? verdict.refinementInstructions : undefined,
          brief: input.brief,
          requirements: requirementChecklist,
          designMode: input.designMode,
          conversationContext: input.conversationContext,
          knowledgeBlock,
          editScopeNodeIds: input.editScopeNodeIds,
          signal,
        },
        state,
        iteration,
        emitter,
        isStopRequested,
        timeRemaining
      );
      draftResult = rounds.draft;
      stoppedMidRound = rounds.stoppedMidRound;
    } catch (e) {
      if (e instanceof LlmAbortError) {
        return buildResult({ terminalStatus: 'stopped', iterations: iteration - 1, converged: false, original, state, draft, mcpCalls: gathered.mcpCalls });
      }
      // The FIRST draft failing is the 003 architecture-phase failure contract —
      // propagate unchanged so the route's existing catch handles it identically.
      if (iteration === 1) throw e;
      console.error(`[agent-loop] refine draft failed at iteration ${iteration}, keeping previous best:`, e);
      break;
    }

    // 008 FR-009 — a resolved modification is confined to the nodes the user
    // actually referred to, plus anything it explicitly adds. The planner is
    // TOLD this in its prompt, but prompt instructions have never been
    // sufficient on their own, so the plan is checked and rejected here. This
    // runs from iteration 1 (unlike the preserve-user-work gate below, which
    // only guards refine passes) because an out-of-scope first draft is exactly
    // the "I asked to rename one thing and it rewrote the diagram" complaint.
    if (input.editScopeNodeIds?.length) {
      const outOfScope = outOfScopeViolations(original.nodes, draftResult.nodes, input.editScopeNodeIds);
      if (outOfScope.length > 0) {
        emitter.step(
          `scope:${iteration}`,
          'validate',
          iteration,
          'Checking the change stayed in scope',
          'failed',
          `Rejected — would have altered ${outOfScope.length} element${outOfScope.length === 1 ? '' : 's'} the request never mentioned`
        );
        if (iteration === 1) {
          // Nothing better exists yet; return the untouched architecture rather
          // than applying an out-of-scope draft.
          return buildResult({
            terminalStatus: 'best_effort', iterations: iteration, converged: false,
            original, state: original, draft: null, mcpCalls: gathered.mcpCalls,
          });
        }
        break;
      }
    }

    // FR-011/research R7: a refine pass may not alter nodes outside the
    // understood change scope. A violation fails the iteration — the previous
    // best draft is kept, never this one.
    if (iteration > 1 && protectedSnapshot) {
      const violations = protectedViolations(draftResult.nodes, protectedSnapshot);
      if (violations.length > 0) {
        emitter.step(
          `refine:${iteration}`,
          'refine',
          iteration,
          `Refining the design (iteration ${iteration})`,
          'failed',
          `Rejected — would have altered ${violations.length} untouched service${violations.length === 1 ? '' : 's'}`
        );
        break;
      }
    }

    if (draftResult.unsatisfiable) {
      draft = draftResult;
      state = { nodes: draftResult.nodes, edges: draftResult.edges, containers: draftResult.containers, annotations: draftResult.annotations, guidance: draftResult.guidance };
      break;
    }

    // 005 FR-007: a stop observed BETWEEN chunk rounds must still preserve the
    // chunks already applied — proceed through layout/price/validate on them
    // (below) instead of discarding this iteration's draft the way a stop
    // observed here, with NO rounds applied yet, still does.
    if (!stoppedMidRound && (await isStopRequested())) {
      return buildResult({ terminalStatus: 'stopped', iterations: iteration - 1, converged: false, original, state, draft, mcpCalls: gathered.mcpCalls });
    }

    // Container hygiene (C4/AWS style: a boundary box must contain something):
    // AI-created containers whose whole subtree ended the draft phase empty are
    // pruned before layout. Pre-existing containers are protected — a user's
    // intentionally empty box is their work, never deleted. Runs after ALL
    // chunk rounds so a round-1 container round 2 populates is never touched.
    const preExistingIds = new Set(original.containers.map((c) => c.containerId));
    const pruned = pruneEmptyContainers(draftResult.nodes, draftResult.containers, preExistingIds);
    if (pruned.removedIds.length > 0) {
      draftResult.containers = pruned.containers;
      console.warn(`[agent-loop] pruned ${pruned.removedIds.length} empty AI-created container(s) at iteration ${iteration}`);
    }

    const containers = await layoutIfStructural(
      draftResult.structuralChange,
      draftResult.nodes,
      draftResult.edges,
      draftResult.containers,
      emitter.legacyProgress('layout', iteration)
    );
    await priceArchitecture(draftResult.nodes, input.defaultRegion, draftResult.indicative, emitter.legacyProgress('price', iteration));

    const gaps = validateArchitecture(draftResult.nodes, draftResult.edges, containers);
    emitter.step(
      `validate:${iteration}`,
      'validate',
      iteration,
      'Validating the structure',
      gaps.length > 0 ? 'failed' : 'done',
      gaps.length > 0 ? gaps.join('; ') : undefined
    );

    draft = draftResult;
    state = { nodes: draftResult.nodes, edges: draftResult.edges, containers, annotations: draftResult.annotations, guidance: draftResult.guidance };

    // 005 render-order refinement: containers are the last thing revealed on
    // canvas — interim chunk emits (runChunkRounds' onChunkApplied) hid any
    // newly-introduced container/membership; this is the full, ELK-laid-out
    // result (autoLayout resized/positioned containers around their now-
    // arranged members). Skipped on a non-structural turn (pure cost/config
    // edit) so it never flickers a diagram nothing actually restructured.
    if (draftResult.structuralChange) {
      emitter.diagram(state.nodes, state.edges, state.containers, iteration, 0);
    }

    // Empty changeScope means the understand phase found no specific target (or
    // is a full-canvas redesign) — treat as unrestricted rather than protecting
    // every existing node, which would block legitimate multi-node refinements.
    // Computed once (iteration 1) and reused on later iterations; exemptNodeIds
    // mirrors protectedSnapshot's scope so checkTopologyStructure below never
    // flags a protected, pre-existing node as an unfixable orphan gap.
    if (iteration === 1 && understanding.changeScope.length > 0) {
      const existingIds = new Set(input.nodes.map((n) => n.nodeId));
      const protectedIds = new Set([...existingIds].filter((id) => !understanding.changeScope.includes(id)));
      protectedSnapshot = snapshotProtected(state.nodes, protectedIds);
      exemptNodeIds = protectedIds;
    }

    // Containerization quality (loop-engineering hook, research: AWS Cloud >
    // Region > VPC > AZ > Subnet, Atlas Project > Cluster): feeds the SAME
    // hard-gate reviewDraft() already applies to validationGaps, so a poorly
    // structured diagram — not just a missing capability — drives a refine
    // pass. Kept separate from `gaps`/the validate step above: this is a
    // best-practice/structural-quality signal, not a correctness failure, so
    // it never marks "Validating the structure" as failed.
    const topologyGaps = checkTopologyStructure(state.nodes, state.containers, { exemptNodeIds });

    if (stoppedMidRound || (await isStopRequested())) {
      return buildResult({ terminalStatus: 'stopped', iterations: iteration, converged: false, original, state, draft, mcpCalls: gathered.mcpCalls });
    }

    if (!llmAvailable()) {
      // Degraded mode (no LLM): nothing to review or refine — matches the
      // legacy single-pass behavior, trivially "converged" (SC-005).
      converged = true;
      break;
    }

    // 008 FR-040 — optional external opinion on the topology, off unless the
    // diagram MCP is configured AND enabled. Returns '' for "fine" and for "not
    // configured" alike, and never throws, so nothing here needs a branch.
    const advisoryNote = await crossCheckTopology({
      nodes: state.nodes,
      edges: state.edges,
      containers: state.containers,
      signal,
    });

    let reviewVerdict: ReviewVerdict;
    // Open the step BEFORE the reviewer's model call so the call is attributed
    // to it (interpretability: emitter.modelCall tags the running step).
    emitter.step(`review:${iteration}`, 'review', iteration, 'Checking requirements coverage', 'running');
    try {
      reviewVerdict = await reviewDraft({
        requestText: input.text,
        architectureSummary: architecturePrompt(state.nodes, state.edges, state.containers, state.annotations),
        mcpGuidance: gathered.mcpGuidance,
        knowledgeBlock,
        advisoryNotes: advisoryNote ? [advisoryNote] : [],
        validationGaps: [...gaps, ...topologyGaps],
        changeScope: understanding.changeScope,
        // Requirements-coverage rubric — the reviewer grades every item and cites evidence.
        requirementChecklist,
        // 006 FR-008 — hard gate: every user-selected service must be present in the draft.
        requiredServiceIds: input.brief?.selectedServiceIds ?? [],
        presentServiceIds: state.nodes.map((n) => n.serviceId),
        signal,
      });
    } catch (e) {
      if (e instanceof LlmAbortError) {
        return buildResult({ terminalStatus: 'stopped', iterations: iteration, converged: false, original, state, draft, mcpCalls: gathered.mcpCalls });
      }
      console.error(`[agent-loop] review failed at iteration ${iteration}, accepting current draft:`, e);
      emitter.step(`review:${iteration}`, 'review', iteration, 'Checking requirements coverage', 'failed', 'Review could not complete — accepting current draft');
      converged = true;
      break;
    }

    verdict = reviewVerdict;
    const covered = reviewVerdict.coverage.filter((c) => c.met).length;
    const coverageDetail =
      reviewVerdict.coverage.length > 0
        ? `${covered}/${reviewVerdict.coverage.length} requirements covered`
        : reviewVerdict.pass
          ? 'All requested capabilities present'
          : unmetSummary(reviewVerdict.unmetCapabilities);
    emitter.step(
      `review:${iteration}`,
      'review',
      iteration,
      'Checking requirements coverage',
      'done',
      reviewVerdict.pass && reviewVerdict.coverage.length > 0
        ? `All ${reviewVerdict.coverage.length} requirements covered`
        : coverageDetail
    );

    if (reviewVerdict.pass) {
      converged = true;
      break;
    }
    // 008 FR-020 — remember what the FIRST review rejected. If a later pass
    // then converges, that (gap -> fix) pair becomes a reusable lesson.
    if (iteration === 1 && reviewVerdict.unmetCapabilities.length > 0) {
      firstReviewGap = reviewVerdict.unmetCapabilities.join('; ');
    }
    if (iteration >= maxIterations) break; // best-effort — budget exhausted (FR-004)
    if (timeRemaining() < ABORT_THRESHOLD_MS) break; // best-effort — not enough time for another pass (FR-003)
  }

  // 008 FR-022 — reinforce only the rules that were present in a turn that
  // actually PASSED review. A lesson that keeps appearing in failing turns is
  // not earning its place and decays out of retrieval on its own, which is what
  // makes the store self-correcting without a human reviewing every entry.
  if (converged && knowledgeIds.length > 0) {
    void recordKnowledgeUsage(knowledgeIds);
  }

  let replyOverride: string | undefined;
  if (draft && !draft.unsatisfiable && !converged && verdict.unmetCapabilities.length > 0) {
    replyOverride = `${draft.reply}\n\nNote: this is the best design I could produce within the iteration budget. Still ${unmetSummary(verdict.unmetCapabilities)}.`;
  } else if (draft && !draft.unsatisfiable && converged && verdict.pass && verdict.coverage.length > 0) {
    // Coverage confirmation — the reviewer verified every extracted requirement
    // against the applied diagram, so say so explicitly.
    replyOverride = `${draft.reply}\n\nRequirements check: all ${verdict.coverage.length} requirement${verdict.coverage.length === 1 ? '' : 's'} from your request are covered in the diagram.`;
  }

  const editsForLesson = summarizeArchitectureEdit(original, state).join(', ');
  return buildResult({
    terminalStatus: converged ? 'converged' : 'best_effort',
    iterations,
    converged,
    original,
    state,
    draft,
    mcpCalls: gathered.mcpCalls,
    replyOverride,
    // The final verdict's per-requirement table — what the evaluation UI shows.
    coverage: verdict.coverage,
    // Only a turn that FAILED review then RECOVERED teaches anything.
    ...(converged && firstReviewGap && iterations > 1 && editsForLesson
      ? { distillable: { reviewGap: firstReviewGap, refinementFix: editsForLesson } }
      : {}),
  });
}
