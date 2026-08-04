/**
 * Multi-agent roster (agentic-concepts: "Multi-Agent") — the explicit manifest
 * of the specialized agents that collaborate on a generation turn, each with a
 * defined mission, the model-role tier it runs on (llm-roles.ts), and the
 * action groups it is allowed to draw from (action-groups.ts).
 *
 * The pipeline has been multi-agent since 008 (intent resolver, analyst,
 * architect, reviewer, knowledge curator, researcher, cost analyst) — this
 * module makes that architecture first-class instead of implicit: every trace
 * step kind maps to exactly one agent (asserted by tests), so the working
 * trace can attribute each step to the specialist that performed it, and the
 * ReAct log names its thinker.
 *
 * Pure — imports types only.
 */

import type { StepKind } from '@/lib/generate/trace-emitter';
import type { LlmRole } from '@/lib/llm-roles';

export interface AgentDefinition {
  id: string;
  /** display name used in the ReAct trace ("Architect: drafting …") */
  label: string;
  mission: string;
  /**
   * The llm-roles.ts role this agent's model calls are tagged with — which
   * decides the capability tier (small/mid/large) once tiering is enabled.
   * null = the agent is pure orchestration/deterministic code.
   */
  llmRole: LlmRole | null;
  /** action-groups.ts ids this agent may use */
  actionGroupIds: readonly string[];
  /** trace-emitter step kinds attributed to this agent */
  stepKinds: readonly StepKind[];
}

export const AGENT_ROSTER: readonly AgentDefinition[] = [
  {
    id: 'coordinator',
    label: 'Coordinator',
    mission:
      'Owns the ReAct loop: sequences the specialists, enforces iteration/time budgets and the coverage acceptance target, raises human-in-the-loop checkpoints, and persists the accepted result.',
    llmRole: null,
    actionGroupIds: ['diagram-editing'],
    stepKinds: ['reason', 'persist', 'finalize'],
  },
  {
    id: 'requirements-analyst',
    label: 'Requirements Analyst',
    mission:
      'Extracts the exhaustive requirement checklist from the request and conversation, classifies the request, resolves follow-up references, and asks clarifying questions.',
    llmRole: 'analyze',
    actionGroupIds: ['requirements-analysis'],
    stepKinds: ['understand', 'analyze', 'intent'],
  },
  {
    id: 'guidance-scout',
    label: 'Guidance Scout',
    mission: 'Gathers official provider architecture guidance and regional facts via the attached MCP servers, reusing the cache when a pattern is recognized.',
    llmRole: null,
    actionGroupIds: ['official-guidance'],
    stepKinds: ['lookup'],
  },
  {
    id: 'knowledge-curator',
    label: 'Knowledge Curator',
    mission: 'Retrieves stored house rules and lessons for the request, and distils new reusable lessons from turns that failed review then recovered.',
    llmRole: 'distill',
    actionGroupIds: ['knowledge'],
    stepKinds: ['knowledge', 'distill'],
  },
  {
    id: 'researcher',
    label: 'Researcher',
    mission: 'Researches official documentation when the knowledge store and MCP guidance both miss, writing findings back so the next similar request needs no lookup.',
    llmRole: 'research',
    actionGroupIds: ['knowledge'],
    stepKinds: ['research'],
  },
  {
    id: 'architect',
    label: 'Architect',
    mission: 'Synthesizes the architecture: plans concrete edits chunk by chunk against the requirement MUSTs, applies refinements, and keeps the layout readable.',
    llmRole: 'plan',
    actionGroupIds: ['diagram-editing', 'official-guidance'],
    stepKinds: ['draft', 'refine', 'layout', 'direct-edit'],
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    mission: 'Evaluator half of the loop: grades the applied draft item by item against the requirement checklist with quoted evidence, plus structural and topology gates.',
    llmRole: 'review',
    actionGroupIds: ['validation-review'],
    stepKinds: ['review', 'validate'],
  },
  {
    id: 'cost-analyst',
    label: 'Cost Analyst',
    mission: 'Prices the result via the official pricing chain and negotiates cost trade-offs (questions, cheapest vs best-practice options).',
    llmRole: 'cost',
    actionGroupIds: ['pricing'],
    stepKinds: ['price', 'cost', 'options'],
  },
] as const;

const BY_STEP_KIND = new Map<StepKind, AgentDefinition>(
  AGENT_ROSTER.flatMap((a) => a.stepKinds.map((k) => [k, a] as const))
);

/** The specialist a trace step belongs to; the coordinator owns anything unmapped. */
export function agentForStepKind(kind: StepKind): AgentDefinition {
  return BY_STEP_KIND.get(kind) ?? AGENT_ROSTER[0];
}

export function agentById(id: string): AgentDefinition | null {
  return AGENT_ROSTER.find((a) => a.id === id) ?? null;
}
