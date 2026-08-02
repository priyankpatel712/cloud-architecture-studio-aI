import 'server-only';

/**
 * Agentic loop configuration (feature 004 — spec Assumptions, research R2;
 * constitution v1.2.0 performance envelope).
 *
 * The generation turn runs as a bounded evaluator-optimizer loop. These are the
 * knobs that keep it safe: how many review→refine passes it may take, the hard
 * wall-clock ceiling the route enforces, and how much time must remain before a
 * new refinement iteration is allowed to start (abort refinement — not the turn —
 * when the budget is nearly spent, returning the best draft so far, FR-004).
 *
 * All three are tunable via env without a product change (spec Assumptions);
 * the defaults match the constitution's 90s p90 / 120s hard-cap envelope.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Maximum review→refine iterations per turn (FR-003). Default 3. */
export const ITERATION_BUDGET = intEnv('AGENT_ITERATION_BUDGET', 3);

/**
 * Hard wall-clock cap for the whole turn (SC-004). Default 120_000ms. Kept in
 * sync with the route's `maxDuration` (which is expressed in seconds).
 */
export const HARD_TIME_CAP_MS = intEnv('AGENT_HARD_TIME_CAP_MS', 120_000);

/**
 * Minimum time that must remain in the turn budget before another refinement
 * iteration may start. When less than this remains, the loop stops and returns
 * the best draft so far rather than risk blowing the hard cap mid-iteration.
 * Default 25_000ms (research R2).
 */
export const ABORT_THRESHOLD_MS = intEnv('AGENT_ABORT_THRESHOLD_MS', 25_000);

/**
 * Incremental diagram build-up (feature 005 — spec FR-001/008, research R1-3).
 * A generation turn's draft phase plans and applies changes in small chunks
 * instead of one large call, so the diagram builds up progressively on the
 * canvas and — since each chunk is its own LLM call — the turn's own request
 * timing stays paced under a configured provider's requests-per-minute cap
 * (observed: NVIDIA NIM's 40 req/min).
 */

/** Max new services/containers planned per chunk/round. Default 4. */
export const CHUNK_SIZE = intEnv('AGENT_CHUNK_SIZE', 4);

/**
 * Pause between rendering successive slice-groups from a single oversized
 * response (the defensive backstop, research R2) — a UI-pacing delay only,
 * skipped entirely when a response already fits in one group (FR-009/SC-003).
 * Default 400ms.
 */
export const CHUNK_RENDER_DELAY_MS = intEnv('AGENT_CHUNK_RENDER_DELAY_MS', 400);

/**
 * Pause between successive chunk-planning LLM calls within the same turn
 * (research R3). Default 1_600ms — just over NVIDIA's 40 req/min cap
 * (60_000 / 40 = 1_500ms), tunable per configured provider (FR-008).
 */
export const CHUNK_PLAN_DELAY_MS = intEnv('AGENT_CHUNK_PLAN_DELAY_MS', 1_600);

/**
 * 008 FR-012 — the pacing delay with ±20% jitter applied.
 *
 * A fixed interval makes every concurrent turn pace identically, so several
 * turns started together stay in lockstep and hit the provider in synchronized
 * bursts — the exact pattern that trips a per-minute cap. Jitter spreads them
 * out. Never returns less than half the configured delay, so jitter can only
 * smooth the pattern, never defeat the rate limit it exists to respect.
 */
export function chunkPlanDelayMs(): number {
  const jitter = 1 + (Math.random() * 0.4 - 0.2);
  return Math.max(Math.round(CHUNK_PLAN_DELAY_MS * 0.5), Math.round(CHUNK_PLAN_DELAY_MS * jitter));
}

/**
 * Safety cap on chunk-planning rounds within one iteration's draft phase, in
 * case a misbehaving model never sets moreNeeded: false. Default 10.
 */
export const CHUNK_ROUND_BUDGET = intEnv('AGENT_CHUNK_ROUND_BUDGET', 10);

/**
 * Guided generation flow (feature 006 — spec FR-002/FR-009/FR-010, plan T001).
 * Bounds on the interactive rounds: how many validation questions a clarify
 * round may ask, how many cost questions the cost dialogue may ask, and the
 * minimum number of priced options the cost turn must present.
 */

/** Max validation questions per clarify round (006 FR-002). Default 5. */
export const QUESTION_LIMIT = intEnv('GUIDED_QUESTION_LIMIT', 5);

/** Max cost-related questions in the cost dialogue (006 FR-009). Default 3. */
export const COST_QUESTION_LIMIT = intEnv('GUIDED_COST_QUESTION_LIMIT', 3);

/** Minimum priced options the cost turn presents — cheapest + best practice (006 FR-010). */
export const OPTION_COUNT = intEnv('GUIDED_OPTION_COUNT', 2);

/** Shared delay primitive for the chunk pacing above. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reusable LLM/MCP response cache (generation-quality improvement). Official
 * MCP guidance for a recognized architecture pattern and AWS regional-
 * availability facts are persisted so a similar future request reuses them
 * instead of re-querying the live MCP server every turn.
 */

/** MCP guidance cache TTL — kept shorter since some guidance (e.g. AWS's
 * "current_awareness" search) is intentionally time-sensitive. Default 14 days. */
export const MCP_GUIDANCE_CACHE_TTL_MS = intEnv('MCP_GUIDANCE_CACHE_TTL_MS', 14 * 24 * 60 * 60 * 1000);

/** AWS regional-availability cache TTL — a near-static fact, safe to keep longer. Default 30 days. */
export const AWS_REGION_AVAILABILITY_CACHE_TTL_MS = intEnv('AWS_REGION_AVAILABILITY_CACHE_TTL_MS', 30 * 24 * 60 * 60 * 1000);
