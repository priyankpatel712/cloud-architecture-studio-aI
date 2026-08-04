# Phase 0 Research: Multi-Agent Generation with Conversation Memory, Knowledge Store & Model Tiering

**Feature**: `008-multi-agent-knowledge-pipeline` | **Date**: 2026-07-31 | **Plan**: [plan.md](./plan.md)

**Purpose**: Resolve the open technical decisions behind the plan. Every Technical Context field is settled — no `NEEDS CLARIFICATION` markers remain.

---

## R1 — Agent composition pattern

**Decision**: Keep the orchestrator as a deterministic code-level state machine (`routeTurn`) and add narrow, single-purpose agents as steps within it. No agent decides the workflow; no agent calls another agent directly.

**Rationale**: Anthropic's *Building effective agents* guidance is explicit that most production value comes from composable patterns — prompt chaining, routing, orchestrator-workers, evaluator-optimizer — rather than open-ended autonomous loops, and that you should use the simplest composition that works. The pipeline already implements orchestrator-workers (chunked planning) and evaluator-optimizer (reviewer with code-side hard gates) correctly, and those are the two patterns that matter here. The reported defect is a *context* problem, not a topology problem: adding autonomy would not have made the assistant see the conversation it was never given.

A code state machine also preserves properties this codebase depends on: a bounded 120s turn cap, a working stop control, deterministic trace step ordering, and the ability to reject a model's output code-side (the existing preserve-user-work gate). An LLM-driven controller would put all four at risk for no gain.

**Alternatives considered**:
- *LangGraph / LangChain agent runtime* — rejected. Adds a heavy dependency and a second control-flow paradigm alongside the existing state machine, and its checkpointing/streaming model would have to be reconciled with the NDJSON trace stream and turn budget already in place. The repo's feature 004 research reached the same conclusion.
- *Autonomous multi-agent swarm (agents delegating to agents)* — rejected. Unbounded token cost, non-deterministic step ordering that breaks the live trace contract, and no mechanism to enforce the 120s cap.
- *Single mega-prompt with more context* — rejected. It is what exists today for the plan step; it cannot express "classify cheaply, then act" and it wastes the largest model on trivial classification.

---

## R2 — Where conversation memory lives

**Decision**: Assemble a bounded (~1,500 char) transcript block per turn from the existing `AIConversation.messages`, rendering user text, assistant `editsApplied` summaries, and manual canvas-edit system messages. No new collection; no summarization model call.

**Rationale**: All three signals are already persisted — the failure is purely that the read path filters to `role === 'user'` and only the router consumes it. Rendering rather than summarizing keeps the turn cheap (zero extra LLM calls), deterministic, and debuggable. A character budget with newest-first retention bounds prompt growth without a model in the loop.

Deliberately **excluded from the reviewer**: self-review grades the cumulative requirement ledger, not the transcript. Mixing conversational phrasing into an objective rubric invites the grader to reward apparent responsiveness over actual requirement coverage. This is why FR-001 names interpret/analyze/design only.

**Alternatives considered**:
- *Rolling LLM-generated conversation summary* — rejected for now. Adds a model call per turn and a staleness/faithfulness failure mode. Reconsider only if transcripts routinely exceed the budget in real use.
- *Vector-retrieved relevant turns* — rejected. Over-engineering for conversations that are typically under 20 turns.
- *Send full history* — rejected. Unbounded growth against a hard turn budget, and the oldest turns are usually the least relevant to a modification.

---

## R3 — Intent classification and reference resolution

**Decision**: One small-model structured call producing an `EditScope`, with deterministic post-processing: node references are validated against the actual canvas, unknown ids are dropped, and anything unresolvable degrades to `ambiguous` (ask) or the full analyze path (never a guess).

**Rationale**: Reference resolution genuinely needs language understanding — "that lambda", "the one we just added", "it" — which regex cannot do. But the *consequences* must be deterministic, so the model proposes and code disposes: the model can only name candidates, and code verifies each id exists before it is actionable. This mirrors the existing `sanitizeRoute` / `sanitizePlan` discipline that the repo adopted precisely because structured-output enforcement proved unreliable.

Degradation is asymmetric by design: a wrong *classification* costs one wasted small call and falls back to today's behavior; a wrong *reference* would silently delete the user's work. So confidence thresholds gate the destructive paths only.

**Alternatives considered**:
- *Pure regex/keyword classifier* — rejected as the primary mechanism (cannot resolve anaphora), but retained implicitly: the existing `detectSwitchIntent` regex still handles the pricing-option switch case it already covers.
- *Large model for intent* — rejected. This is a classification task; spending the constrained model on it is exactly the rate-limit problem being fixed.
- *Ask the user every time* — rejected. Destroys the conversational experience for the common unambiguous case.

---

## R4 — Model tiering mechanism

**Decision**: A static role → config-chain map (`llm-roles.ts`) with per-role overrides persisted on the existing `LlmSettings` singleton. `llmJson` accepts an optional `role`; omitting it preserves today's behavior byte-for-byte.

**Rationale**: The work classes are known and stable (routing, intent, interpretation, distillation, research, analysis, review, cost, reporting, planning), so a static map is predictable, inspectable, and testable — an operator can see exactly which model serves which step. The optional-parameter design makes migration incremental: each of the 11 call sites moves independently, and a mistake is reverted by removing one argument.

Chain *ordering* encodes the free-tier realities documented in the repo: NVIDIA ~40 req/min, Gemini ~20 req/day (never early), OpenRouter free pool 429/402-flaky (last), Groq retires models (already handled by the non-retryable 404 path).

**Alternatives considered**:
- *Dynamic difficulty scoring per request* — rejected. Requires a model call to decide which model to call; unpredictable cost and a circular dependency.
- *One model, smaller max_tokens for cheap steps* — rejected. `max_tokens` caps output, not request count, so it does nothing for a per-minute request ceiling.
- *Separate client instances per tier* — rejected. The existing single `llmJson` path already has timeout, abort, sanitize, and fallback logic that must not be duplicated.

---

## R5 — Rate-limit handling

**Decision**: Parse `Retry-After` (both delta-seconds and HTTP-date forms); wait exactly that long when ≤8s and the turn budget permits, otherwise advance to the next chain entry. Derive provider cooldown from the header when present. Add ±20% jitter to chunk pacing. Track a 60-second sliding request window per provider and skip providers already at their ceiling.

**Rationale**: `Retry-After` is the provider telling you precisely when it will serve you again — currently ignored, with retries fired at zero delay, which converts one 429 into several. The 8-second ceiling comes from the turn budget: with a 120s cap and a 25s abort threshold, a longer wait is better spent on a different provider. Jitter prevents synchronized bursts when several chunks pace identically. The sliding window is the only mechanism that avoids a 429 rather than reacting to one.

**Alternatives considered**:
- *Exponential backoff without the header* — rejected as the primary strategy; it guesses when the provider has already answered. Retained as the fallback when no header is present.
- *Global token-bucket limiter across all providers* — rejected as over-engineering: per-provider ceilings differ by an order of magnitude, so a single bucket must be sized to the weakest.
- *Queue turns server-side* — rejected. Conflicts with the existing one-generation-per-project lock and the interactive latency target.

---

## R6 — Knowledge retrieval strategy

**Decision**: Keyword scoring over an indexed MongoDB collection, filtered by provider and design mode, returning a char-capped top-K (default 6).

**Rationale**: The identical approach already works in this codebase (`matchReferencePatterns`, threshold ≥2, top 2). Expected corpus size is ~20 seeded rules growing to low hundreds via distillation — far below where keyword scanning degrades. Critically, it is *debuggable*: when a wrong rule is injected, the matching keyword is visible, whereas an embedding mismatch is opaque. It also costs zero model calls and zero external services on the retrieval path.

**Alternatives considered**:
- *MongoDB Atlas Vector Search* — rejected for now, and recorded as a deliberate non-goal. It requires an embedding model call per query and per write (reintroducing the rate-limit pressure this feature exists to reduce), plus an Atlas-tier dependency the local `mongodb://127.0.0.1` development setup does not have.
- *Full-text `$text` search alone* — rejected as insufficient: no provider/mode filtering or confidence weighting, and relevance is not tunable.
- *Load all rules into every prompt* — rejected. Blows the prompt budget and dilutes attention as the corpus grows.

---

## R7 — Where provider-specific rules live

**Decision**: Provider rules live beside their provider (`providers/<id>/rules.ts`) and are collected through the existing registry. Only provider-agnostic rules live in `knowledge/core-rules.ts`.

**Rationale**: Constitution Principle II requires that adding a provider be achievable by implementing a provider plugin, and that core code never hard-code a provider's services. A core `seed-rules.ts` containing CloudFront, Cognito, WAF, and Route 53 would violate both — adding Azure would mean editing core. Co-locating rules with the provider's catalog, MCP adapter, and pricing adapter also keeps a single place to update when that provider's surface changes.

This was flagged CRITICAL during `/speckit-analyze` against an earlier draft that placed all rules in core; the corrected placement is now a functional requirement (FR-038).

**Alternatives considered**:
- *Single core seed file* — rejected: constitution violation, as above.
- *Rules seeded only from the database with no code artifact* — rejected. Loses version control, code review, and reproducible environment setup.

---

## R8 — Web search backend

**Decision**: A pluggable interface with a backend chain — Tavily → Brave → disabled — constrained by an official-documentation domain allowlist, invoked at most once per turn and only after the store and provider MCPs miss.

**Rationale**: No cloud provider publishes a general web-search MCP or API, so constitution Principle I's "prefer official" cannot be satisfied by an official *index*; it is instead satisfied at the *source* level by restricting results to official documentation domains. Tavily leads because it is purpose-built for agent retrieval (returns extracted content, not just links, reducing follow-up fetches) with a usable free tier; Brave provides an independent fallback with a different index. Both are plain HTTPS APIs reachable with `fetch`, so neither adds an SDK dependency.

Absence of a key disables the rung silently, matching how unset MCP env vars already degrade the app to indicative mode — the feature is additive and never a hard dependency.

**Alternatives considered**:
- *Google Programmable Search / SerpAPI* — rejected. More restrictive free quotas and, for SerpAPI, a scraping-intermediary posture that is a poor fit for a product that emphasizes official sources.
- *Direct crawl of documentation sites* — rejected. Fragile against markup changes, and closer to scraping than to a supported integration.
- *No web research at all* — rejected. Leaves genuine gaps (newly launched services, changed quotas) permanently unanswerable, which was an explicit user request.

---

## R9 — Lesson distillation safety

**Decision**: Distillation runs post-turn and off the critical path, only when iteration 1 failed review and a refinement corrected it. Lessons are content-hashed for dedupe, start at confidence 0.6, gain 0.05 per passing turn in which they were injected, and are pruned when unused for 60 days or when confidence falls below 0.5. The distiller prompt forbids project names, user-text literals, and identifiers.

**Rationale**: The review-failure → refinement-fix pair is the highest-signal moment available: the system has already established both that something was wrong and what fixed it, so no additional judgment call is needed. Running post-turn keeps it entirely outside the latency budget. The confidence lifecycle is the safety mechanism — a bad lesson is injected, fails to help, is never reinforced, and ages out, so no human intervention is required for the common case (with operator override available in Phase 5).

Privacy is enforced at generation time rather than at read time because a lesson that never contains project data cannot leak it later.

**Alternatives considered**:
- *Distill from every turn* — rejected. Most turns teach nothing; the corpus would fill with noise and dilute retrieval.
- *Human approval before a lesson is active* — rejected as the default (it defeats the "resolves easily" goal), but the Phase 5 admin surface makes review and disabling possible.
- *Distill inline during the turn* — rejected. Adds latency to the user-visible path for a benefit that only accrues to *future* turns.

---

## R10 — MCP server configuration

**Decision**: A data-driven registry (`providers/mcp-registry.ts`) describing `{ id, command, tools[], provider, purpose, enabled }`, seeded from environment variables, with `mcp-client.ts` resolving through it.

**Rationale**: MCP server definitions are currently spread across individual env vars read at their call sites, so adding a server means editing code. A registry makes the set declarative and mirrors the provider plugin registry philosophy already established in `registry.ts`. `mcp-client.ts` already pools clients by command string, so the registry is a thin lookup on top rather than a rewrite.

**Alternatives considered**:
- *An `McpServerConfig` MongoDB collection* — deferred, not rejected. Env-seeded config is sufficient now and avoids a bootstrap dependency (the app must reach MCPs before any admin UI exists). The registry shape is designed so a DB-backed source can replace the env seed later without changing call sites.
- *Reuse the repo-root `.mcp.json`* — rejected. That file configures the coding agent's MCP servers, not the application's; conflating them would couple developer tooling to runtime behavior.

---

## Resolved Technical Context

No `NEEDS CLARIFICATION` markers remain. All entries in the plan's Technical Context are settled: TypeScript/Next.js on Node, Mongoose over MongoDB, vitest, single web application, 120s turn cap with a <5s fast path, and the free-tier constraints encoded into default role chains.

**One decision explicitly deferred**: semantic/vector knowledge retrieval (R6). It is recorded as a non-goal with a defined revisit trigger — measured retrieval hit-rate proving inadequate in production use — rather than left as an open question.
