/**
 * Model role policy (feature 008, contracts/agent-interfaces.md §7).
 *
 * A generation turn is not one kind of work: classifying which toolset a message
 * needs is trivial, drafting an architecture is not. Today every call goes to the
 * same model, so a 300-token routing call burns the same per-minute budget as an
 * 8K-token planning call — which is why turns hit provider rate limits.
 *
 * This module owns the *policy* — which roles exist, which capability band each
 * should draw from, and how a chain is selected. It deliberately performs no I/O
 * and imports nothing from llm.ts at runtime (`import type` is erased), so the
 * dependency runs one way only: llm.ts -> llm-roles.ts. Keep it that way; a
 * runtime cycle here would be loaded at module-init time and is easy to create
 * by accident.
 *
 * COMPATIBILITY CONTRACT: `selectRoleChain` currently returns the supplied chain
 * unchanged for every role, so tagging a call site with its role is inert. Phase
 * 2 of the plan implements real per-role chains; until then each of the eleven
 * call sites can be migrated independently with no behavior change, and a
 * mistake is reverted by deleting one argument. app/tests/llm-roles.test.ts pins
 * this equivalence — update it deliberately, not to make a failure go away.
 */

import type { LlmModelTier, LlmProviderId } from './llm-catalog';
import type { LlmRuntimeConfig } from './llm';

/**
 * Classes of internal work. Explicit rather than derived so the set stays
 * reviewable: every LLM call site in the pipeline maps to exactly one of these.
 */
export const LLM_ROLES = [
  // Small — classification, interpretation, summarising.
  'route',
  'intent',
  'interpret',
  'distill',
  'research',
  // Mid — reasoning over a request or a draft.
  'analyze',
  'review',
  'cost',
  'report',
  // Large — synthesising an architecture.
  'plan',
] as const;

export type LlmRole = (typeof LLM_ROLES)[number];

/**
 * The capability band each role should draw from once tiering is enabled
 * (plan §2.3B). Declared now so the intent is reviewable alongside the seam and
 * the test can assert the split is total.
 */
export const ROLE_TIERS: Record<LlmRole, LlmModelTier> = {
  route: 'small',
  intent: 'small',
  interpret: 'small',
  distill: 'small',
  research: 'small',
  analyze: 'mid',
  review: 'mid',
  cost: 'mid',
  report: 'mid',
  plan: 'large',
};

export function isLlmRole(value: unknown): value is LlmRole {
  return typeof value === 'string' && (LLM_ROLES as readonly string[]).includes(value);
}

/**
 * Is per-role model tiering active?
 *
 * SETTINGS ARE THE ONLY SOURCE. Tiering is configured in Settings → AI Provider
 * alongside the provider, model and API keys it governs, and there is no env
 * fallback: two places to set one switch means the UI can show "off" while the
 * process runs "on", and the operator has no way to tell which is true.
 *
 * DEFAULT OFF, DELIBERATELY. FR-041/SC-009 require a pre-tiering design-quality
 * baseline to be recorded first — once tiering is on, the "before" numbers can
 * never be reproduced, and SC-004 ("quality at or better than baseline") becomes
 * unverifiable. Unset therefore means off: a deployment that has never opened
 * Settings keeps today's behaviour, where every role resolves to the same chain
 * and the role tags on the call sites are inert.
 */
export function resolveRoleTiering(stored: boolean | null | undefined): boolean {
  return stored === true;
}

/**
 * Preferred model per provider for each tier, used to build a role's chain from
 * whatever connections are actually configured.
 *
 * Ordering encodes the free-tier realities recorded in the repo: NVIDIA NIM is
 * the workhorse (~40 req/min); Groq is fast and has a genuine small model, so it
 * leads for small work; Gemini's free tier is ~20 requests/DAY so it is never
 * early; OpenRouter's free pool 429/402s unpredictably and goes last.
 */
/**
 * Providers whose free tier is capped PER DAY rather than per minute, so they
 * must never lead a chain for high-frequency work.
 *
 * This matters more than it looks. The small-tier roles (route, intent,
 * interpret, distill) fire several times per turn — exactly the traffic that
 * would exhaust a ~20-requests/day allowance within a handful of turns and then
 * spend the rest of the day failing over. A provider listed here is still used,
 * but only after every unconstrained option, so it acts as a genuine last
 * resort instead of a fast-burning default.
 */
const DAILY_QUOTA_PROVIDERS: ReadonlySet<LlmProviderId> = new Set([
  'gemini',
  'openrouter',
  // Workers AI's free tier is a small daily neuron allocation (~10k/day) that
  // a few dozen large calls can exhaust — same shape as Gemini's per-day cap.
  'cloudflare',
]);

const TIER_PREFERENCES: Record<LlmModelTier, { provider: LlmProviderId; model: string }[]> = {
  small: [
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    // NVIDIA NIM's small model. Present because Groq is the connection that
    // rate-limits first in practice (observed live: route and analyze calls
    // 429'ing during the baseline run), and without a small NIM option the
    // small-tier roles fell through to NIM's 49b default — putting the
    // highest-frequency work back on the largest model, which is the exact
    // load this feature exists to remove.
    { provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct' },
    // Mistral's free Experiment tier is ~1 req/s — fine as a fourth option for
    // small work, too tight to lead a chain that fires several times per turn.
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    // Bedrock entries sit last in every tier: selectRoleChain skips providers
    // without a key, so these are inert until a Bedrock key is configured and
    // never displace the free-tier ordering tuned above.
    { provider: 'bedrock', model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
  ],
  // Mid preferences must name models the catalog actually TAGS mid. The first
  // measured post-tiering run (post-tiering.json, 2026-08-01) had nvidia's
  // 49b — catalog tier LARGE — leading this list: 54 of 55 mid-role calls ran
  // on the same model the plan role uses, smallMidShare came out 0.11 against
  // the ≥0.5 target, and "mid tier" was a fiction the usage data exposed.
  // nvidia stays reachable through the everything-else-configured catch-all in
  // selectRoleChain; it just no longer masquerades as a mid model.
  mid: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    // Cerebras answers in well under a second at ~30 req/min with a daily
    // token pool (~1M) that mid-frequency roles won't exhaust — the natural
    // second when Groq (the first to rate-limit in practice) is saturated.
    { provider: 'cerebras', model: 'gemma-4-31b' },
    { provider: 'mistral', model: 'mistral-medium-latest' },
    { provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct' },
    { provider: 'bedrock', model: 'us.amazon.nova-pro-v1:0' },
  ],
  large: [
    { provider: 'nvidia', model: 'nvidia/llama-3.3-nemotron-super-49b-v1' },
    { provider: 'anthropic', model: 'claude-opus-4-8' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'mistral', model: 'mistral-large-latest' },
    { provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
  ],
};

/**
 * Pick the connection chain for a role from the already-resolved candidates.
 *
 * Resolution order (FR-010/FR-015/FR-016):
 *   1. an operator override for this role, when that connection has a key
 *   2. the role's tier preferences, restricted to configured connections
 *   3. everything else, so a chain is never shorter than it needs to be
 *
 * A role can only ever be served by a connection the user has configured — this
 * function reorders candidates, it never invents one.
 */
export function selectRoleChain(
  role: LlmRole | undefined,
  configs: LlmRuntimeConfig[],
  opts: {
    /** Resolved by the caller from settings-then-env (see resolveRoleTiering). */
    enabled?: boolean;
    override?: { provider: LlmProviderId; model: string } | null;
  } = {}
): LlmRuntimeConfig[] {
  const { enabled = false, override } = opts;
  if (!role || !enabled || configs.length === 0) return configs;

  const usable = new Map(configs.map((c) => [c.provider, c]));
  const chain: LlmRuntimeConfig[] = [];
  const taken = new Set<string>();

  const push = (cfg: LlmRuntimeConfig | undefined) => {
    if (!cfg || taken.has(cfg.provider)) return;
    taken.add(cfg.provider);
    chain.push(cfg);
  };

  if (override) {
    const base = usable.get(override.provider);
    // Honour the operator's model choice, but only over a keyed connection.
    if (base) push({ ...base, model: override.model || base.model });
  }

  // Tier-preferred connections first, but never one on a per-day quota — those
  // are held back below so high-frequency roles cannot burn a daily allowance.
  for (const pref of TIER_PREFERENCES[ROLE_TIERS[role]]) {
    if (DAILY_QUOTA_PROVIDERS.has(pref.provider)) continue;
    const base = usable.get(pref.provider);
    if (base) push({ ...base, model: pref.model });
  }

  // Then anything else configured — including the operator's active connection,
  // which is a better default for frequent calls than a day-capped free tier
  // even when its model is larger than the role strictly needs.
  for (const cfg of configs) {
    if (DAILY_QUOTA_PROVIDERS.has(cfg.provider)) continue;
    push(cfg);
  }

  // Day-capped providers last: still available as a fallback, never the default.
  for (const cfg of configs) push(cfg);

  return chain;
}
