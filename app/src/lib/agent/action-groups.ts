/**
 * Action groups — the tool/function-calling surface of the generation pipeline,
 * organized as logical collections an agent picks from (agentic-concepts:
 * "Tool Use / Function Calling" + "Action Group").
 *
 * Every capability the pipeline can invoke — LLM function calls with forced
 * JSON schemas, official provider MCP tools, and deterministic engine code —
 * is declared here once, grouped by the category of task it serves. The
 * registry is the single reviewable inventory of what the agents may do:
 * agent-loop.ts names the group it is drawing from when it reasons about a
 * step (the ReAct trace), roster.ts grants each specialist agent a subset of
 * groups, and the manifest render keeps prompts/docs honest about what
 * actually exists.
 *
 * Pure and import-free (validate.ts style) — unit-testable in isolation.
 */

export type AgentToolKind = 'llm' | 'mcp' | 'deterministic';

export interface AgentTool {
  /** stable identifier, referenced from prompts and the ReAct trace */
  name: string;
  description: string;
  /**
   * How the tool executes: 'llm' = a schema-forced model function call,
   * 'mcp' = an official provider MCP server invocation, 'deterministic' =
   * engine code with no model in the path.
   */
  kind: AgentToolKind;
}

export interface ActionGroup {
  id: string;
  label: string;
  /** what category of task this group exists to perform */
  purpose: string;
  tools: readonly AgentTool[];
}

export const ACTION_GROUPS: readonly ActionGroup[] = [
  {
    id: 'requirements-analysis',
    label: 'Requirements analysis',
    purpose: 'Turn a natural-language request into an explicit requirement checklist, resolved references, and a change scope.',
    tools: [
      { name: 'understand_request', description: 'Extract the exhaustive requirement checklist and change scope from the message (agent-loop.ts).', kind: 'llm' },
      { name: 'analyze_request', description: 'Classify the request and produce clarifying questions plus a consolidated brief (analyze.ts).', kind: 'llm' },
      { name: 'resolve_intent', description: 'Resolve follow-up references ("that lambda") against the canvas and classify the edit kind (intent.ts).', kind: 'llm' },
      { name: 'interpret_response', description: 'Interpret a free-text reply against an open question round (analyze.ts).', kind: 'llm' },
    ],
  },
  {
    id: 'official-guidance',
    label: 'Official guidance lookup',
    purpose: 'Ground the design in official provider architecture guidance and regional facts.',
    tools: [
      { name: 'mcp_recommend', description: 'Query the attached providers\' official MCP servers for architecture guidance (orchestrator gatherGuidance).', kind: 'mcp' },
      { name: 'aws_region_availability', description: 'Check planned AWS services against official regional availability (providers/aws/mcp.ts).', kind: 'mcp' },
      { name: 'guidance_cache', description: 'Reuse cached MCP guidance for recognized patterns instead of re-querying (guidance-cache.ts).', kind: 'deterministic' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge store & research',
    purpose: 'Retrieve stored house rules and learned lessons; research official documentation when the store and MCP both miss; distill new lessons.',
    tools: [
      { name: 'retrieve_knowledge', description: 'Fetch stored house rules/patterns/lessons matching the requirements (knowledge/store.ts).', kind: 'deterministic' },
      { name: 'gather_knowledge', description: 'Research official documentation via web search and write findings back to the store (research/knowledge-agent.ts).', kind: 'llm' },
      { name: 'distill_lesson', description: 'Distil a reusable lesson from a review-gap → refinement-fix pair, post-turn (knowledge/distill.ts).', kind: 'llm' },
      { name: 'record_knowledge_usage', description: 'Reinforce rules that were present in a turn that passed review (knowledge/store.ts).', kind: 'deterministic' },
    ],
  },
  {
    id: 'diagram-editing',
    label: 'Diagram editing',
    purpose: 'Plan and apply architecture changes, then lay the result out for readable flow.',
    tools: [
      { name: 'plan_chunk', description: 'Plan at most CHUNK_SIZE new services/containers as concrete edits (orchestrator planOneChunk).', kind: 'llm' },
      { name: 'apply_direct_edit', description: 'Apply a deterministic rename/remove/reconfigure without a design loop (direct-edit.ts).', kind: 'deterministic' },
      { name: 'elk_layout', description: 'Re-layout the diagram with ELK after structural changes (canvas/layout.ts).', kind: 'deterministic' },
      { name: 'prune_empty_containers', description: 'Remove AI-created containers whose whole subtree ended empty (topology.ts).', kind: 'deterministic' },
      { name: 'assign_edge_sides', description: 'Connect each edge on the side its final geometry calls for (edge-sides.ts).', kind: 'deterministic' },
    ],
  },
  {
    id: 'validation-review',
    label: 'Validation & review',
    purpose: 'Grade the applied draft — structural correctness, topology quality, and item-by-item requirements coverage.',
    tools: [
      { name: 'validate_architecture', description: 'Deterministic structural validation (dangling edges, invalid configs) (validate.ts).', kind: 'deterministic' },
      { name: 'check_topology', description: 'Best-practice containment structure check (AWS Cloud > Region > VPC…) (topology.ts).', kind: 'deterministic' },
      { name: 'review_draft', description: 'Evaluator half of the loop: grade every requirement with quoted evidence (reviewer.ts).', kind: 'llm' },
      { name: 'crosscheck_topology', description: 'Optional external second opinion on the topology via the diagram MCP (topology-crosscheck.ts).', kind: 'mcp' },
    ],
  },
  {
    id: 'pricing',
    label: 'Pricing & cost',
    purpose: 'Price the result via the official pricing chain and negotiate cost trade-offs with the user.',
    tools: [
      { name: 'price_nodes', description: 'Price every service via the official pricing chain, indicative fallback labelled (pricing.ts).', kind: 'mcp' },
      { name: 'generate_cost_questions', description: 'Ask the applicable cost questions after a build (cost-options.ts).', kind: 'llm' },
      { name: 'generate_pricing_options', description: 'Produce cheapest and best-practice priced configurations (cost-options.ts).', kind: 'llm' },
      { name: 'apply_pricing_option', description: 'Apply a chosen option\'s configs (clamped) and re-price — config-only, never structural (cost-options.ts).', kind: 'deterministic' },
    ],
  },
] as const;

export function actionGroup(id: string): ActionGroup | null {
  return ACTION_GROUPS.find((g) => g.id === id) ?? null;
}

/** Which group a tool belongs to — every tool name is declared in exactly one group. */
export function groupForTool(toolName: string): ActionGroup | null {
  return ACTION_GROUPS.find((g) => g.tools.some((t) => t.name === toolName)) ?? null;
}

/** Compact manifest for prompts/docs: one line per group, tools named inline. */
export function renderActionGroupManifest(): string {
  return ACTION_GROUPS.map(
    (g) => `${g.label} (${g.id}): ${g.purpose} Tools: ${g.tools.map((t) => t.name).join(', ')}.`
  ).join('\n');
}
