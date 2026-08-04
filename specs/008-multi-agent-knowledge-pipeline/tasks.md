---
description: "Task list for feature 008 — Multi-Agent Generation with Conversation Memory, Knowledge Store & Model Tiering"
---

# Tasks: Multi-Agent Generation with Conversation Memory, Knowledge Store & Model Tiering

**Input**: Design documents from `/specs/008-multi-agent-knowledge-pipeline/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included — spec.md Assumptions state "Automated tests are explicitly in scope for this feature", and constitution Principle V requires the affected flow be driven and observed. Framework is **vitest** (`npm test` → `vitest run`); suites live flat in `app/tests/*.test.ts`.

**Organization**: Grouped by user story so each ships independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: US1–US5 from [spec.md](./spec.md)
- Every task names its exact file path

## Path Conventions

Next.js app under `app/`. Source `app/src/`, tests `app/tests/` (flat, `*.test.ts`), scripts `app/scripts/`. Paths are repo-root-relative.

⚠️ **Read `app/node_modules/next/dist/docs/` before touching any route handler or runtime code** — per [app/AGENTS.md](app/AGENTS.md) this Next.js version diverges from training data.

⚠️ **Within a story phase, tests are written first and must FAIL before implementation begins.**

---

## Phase 1: Setup & Prerequisites

**Purpose**: Close a live security exposure and capture measurements that become unrecoverable later. **T001 and T003 are order-critical.**

- [X] T001 Verify local secret hygiene before Phase 6 adds search-service keys — `app/.env.local` untracked, ignore rules effective, no key material in tracked files or either repo's history (constitution Principle III). **Done 2026-07-31: verified clean; never committed, so no rotation is required — the earlier "committed secrets" finding was incorrect and has been withdrawn from plan.md.**
- [X] T002 Record the current `npm test` and `npm run build` pass/fail state in [specs/008-multi-agent-knowledge-pipeline/quickstart.md](specs/008-multi-agent-knowledge-pipeline/quickstart.md) under Phase 0
- [X] T003 Pre-tiering baseline recorded to [baseline.json](./baseline.json) (2026-08-01, `npm run baseline`, tiering confirmed OFF): 6/6 requests reached a full design pass — every run shows `analyze → understand → lookup → knowledge → draft… → review → persist`, so the measurement is of real design turns, not clarify rounds. **Numbers: convergenceRate 0.1667, meanIterationsToPass 1. CAVEAT — recorded under severe provider degradation**: Groq (the active connection) was day-capped from repeated harness runs, so every call walked the fallback chain (NVIDIA timeouts, Gemini truncation en route); wall times ran 157–315s, which starves the loop's 120s budget and forces best-effort exits at 1–2 iterations. This measures the pipeline under duress, and comparing post-tiering quality against 0.1667 would pass trivially. **Before enabling tiering, re-run `npm run baseline` once providers are healthy** (Groq's daily cap has reset) — the harness is fixed (T119), the request set is pinned, and a healthy-conditions file simply overwrites this one. The tiering toggle stays OFF until then
- [X] T004 [P] Create scaffolding directories `app/src/lib/knowledge/` and `app/src/lib/research/`, each with a placeholder `index.ts`
- [X] T005 [P] Add new environment variables with explanatory comments to [app/.env.example](app/.env.example): `TAVILY_API_KEY`, `BRAVE_API_KEY`, `KNOWLEDGE_STORE_ENABLED`, `KNOWLEDGE_TOP_K`, `WEB_RESEARCH_ENABLED`, `AWS_DOCS_MCP_COMMAND`, `DIAGRAM_MCP_CROSSCHECK_ENABLED`

**Checkpoint**: Secret hygiene verified, scaffolding ready, baseline harness committed (measurement pending — see T003)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared seams every story builds on. Deliberately **behavior-preserving** — role resolution returns today's config until Phase 4 fills in real chains, so nothing changes yet.

**⚠️ CRITICAL**: No user story work begins until this phase completes

- [X] T006 [P] Add `tier: 'small' | 'mid' | 'large'`, `ctx: number`, and `multimodal: boolean` to every model entry and extend the `LlmProviderInfo` type in [app/src/lib/llm-catalog.ts](app/src/lib/llm-catalog.ts)
- [X] T007 [P] Define the `LlmRole` union and a `resolveRoleConfigs(role?)` that delegates to the existing `resolveLlmConfigs()` for every role, per the contract in [contracts/agent-interfaces.md](./contracts/agent-interfaces.md), in new file `app/src/lib/llm-roles.ts`
- [X] T008 Thread an optional `role?: LlmRole` through the `llmJson()` input type into config resolution in [app/src/lib/llm.ts](app/src/lib/llm.ts) — omitting `role` MUST be byte-identical to today (compatibility contract)
- [X] T009 Unit test that omitting `role` resolves the pre-existing chain and that every `LlmRole` resolves to a usable chain, in `app/tests/llm-roles.test.ts` (depends on T007, T008)
- [X] T010 Add trace step kinds `intent`, `direct-edit`, `knowledge`, `research`, `distill` with existing running/done/failed semantics in [app/src/lib/generate/trace-emitter.ts](app/src/lib/generate/trace-emitter.ts)
- [X] T011 [P] Extend the persisted step-kind enum so new kinds survive reload in [app/src/lib/models/GenerationRun.ts](app/src/lib/models/GenerationRun.ts)
- [X] T012 Unit test that new step kinds emit and persist with correct status transitions, in `app/tests/trace-emitter-agents.test.ts` (depends on T010, T011)
- [X] T013 Make the chat client tolerant of the additive stream contract in [contracts/chat-stream-events.md](./contracts/chat-stream-events.md) — ignore unrecognized `step.kind`, accept a `distill` step arriving after `result`, and treat `architecture: null` as "no canvas change" rather than "clear canvas" — in [app/src/components/studio/ChatPanel.tsx](app/src/components/studio/ChatPanel.tsx)

**Checkpoint**: Role plumbing, trace kinds, and client tolerance in place with zero behavior change

---

## Phase 3: User Story 1 - Follow-up requests are understood and scoped (Priority: P1) 🎯 MVP

**Goal**: The assistant sees the conversation, carries requirements across turns, resolves "that lambda" to a real node, changes only what was asked, applies trivial edits instantly with clamping, asks when ambiguous, answers questions without mutating the canvas, and offers (never forces) a restore on undo.

**Independent Test**: Run [quickstart.md](./quickstart.md) US1 scenarios 1–8 against a generated architecture. Every turn touches only intended elements; a turn-1 requirement still fails review in turn 3; a question leaves the canvas untouched.

### Tests for User Story 1 ⚠️

- [X] T014 [P] [US1] Test conversation-context rendering: bounded ~1500 chars, includes assistant replies and manual canvas edits, newest-first truncation, in `app/tests/conversation-context.test.ts`
- [X] T015 [P] [US1] Test `mergeBrief` unions capabilities, preserves `firstSeenTurn`, retains earlier unmet requirements, and only marks `withdrawn` on explicit withdrawal, in `app/tests/brief-merge.test.ts`
- [X] T016 [P] [US1] Test `sanitizeEditScope` coercion rules from [data-model.md](./data-model.md): unknown kind → `ambiguous`, non-existent nodeIds dropped, target-requiring kind with zero targets → `ambiguous`, two comparable-confidence targets → `ambiguous`, in `app/tests/intent-sanitize.test.ts`
- [X] T017 [P] [US1] Fixture test reference resolution against a seeded canvas — single-match, multi-match, and no-match for "that lambda" / "the queue" / "the cache", in `app/tests/intent-resolve.test.ts`
- [X] T018 [P] [US1] Test the direct-edit executor: rename, remove (orphaned edges cleaned, emptied container removed), single-field reconfigure, **config clamped to declared field bounds**, re-priced, and `applied: false` returned untouched for unsupported kinds, in `app/tests/direct-edit.test.ts`
- [X] T019 [P] [US1] Test out-of-scope mutation rejection: a plan touching nodes outside `EditScope.targets` is rejected and not applied, in `app/tests/edit-scope-enforcement.test.ts`
- [ ] T020 ⚠️ **NOT STARTED** — needs `LlmUsage` records from Phase 4 to assert "zero large-tier calls". [P] [US1] Test the fast path completes under the 5-second bound and records **zero large-tier model requests**, in `app/tests/fast-path-budget.test.ts` (SC-003)

### Implementation for User Story 1

- [X] T021 [P] [US1] Implement `buildConversationContext(convo, arch)` rendering bounded `USER:` / `ASSISTANT: applied …` / `CANVAS EDIT (manual): …` lines per [data-model.md](./data-model.md), in new file `app/src/lib/generate/conversation-context.ts`
- [X] T022 ⚠️ **NOT STARTED** — route.ts wiring pass. [US1] Stop filtering conversation history to `role === 'user'` — include assistant messages and the `role: 'system'` "Direct canvas edit" messages (dropped today at line 178, root causes R2/R5) in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [X] T023 [US1] Inject the conversation-context block into the `analyzeRequest` prompt in [app/src/lib/generate/analyze.ts](app/src/lib/generate/analyze.ts)
- [X] T024 [US1] Inject the conversation-context block into the `interpretResponse` prompt in [app/src/lib/generate/analyze.ts](app/src/lib/generate/analyze.ts)
- [X] T025 [US1] Add a "Conversation so far" section to the plan prompt user block in [app/src/lib/generate/orchestrator.ts](app/src/lib/generate/orchestrator.ts) — do **not** add it to the reviewer (FR-001 scopes review to the requirement ledger)
- [X] T026 [P] [US1] Extend `briefSchema` capabilities with `status: 'met' | 'pending' | 'withdrawn'` and `firstSeenTurn: number` per [data-model.md](./data-model.md), in [app/src/lib/models/AIConversation.ts](app/src/lib/models/AIConversation.ts)
- [X] T027 [US1] Implement `mergeBrief(prev, next)` with union, `firstSeenTurn` preservation, and retention of absent-but-unmet capabilities, in [app/src/lib/generate/flow.ts](app/src/lib/generate/flow.ts)
- [X] T028 ⚠️ **NOT STARTED — blocks the R3 fix from taking effect**: `mergeBrief` is implemented and unit-tested, but until it replaces the wholesale `flow` overwrite the ledger is still reset each turn. [US1] Replace the wholesale `flow` overwrite in `runAnalyzeTurn` with `mergeBrief` so earlier requirements survive (root cause R3) in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [X] T029 [US1] Build the reviewer requirement checklist from the cumulative ledger (all entries where `status !== 'withdrawn'`) rather than the current message, in [app/src/lib/generate/agent-loop.ts](app/src/lib/generate/agent-loop.ts)
- [X] T030 **Done via `briefContext` — no reviewer.ts change needed**: `briefContext` now returns `activeRequirements()`, so `reviewDraft` already grades the cumulative ledger. Takes effect once T028 wires `mergeBrief` into the route. [US1] Grade cumulative carried-forward requirements in `reviewDraft`, keeping existing code-side hard gates authoritative, in [app/src/lib/generate/reviewer.ts](app/src/lib/generate/reviewer.ts)
- [X] T031 [P] [US1] Define the `EditScope` type, `INTENT_SCHEMA`, and `sanitizeEditScope()` per [data-model.md](./data-model.md) and [contracts/agent-interfaces.md](./contracts/agent-interfaces.md), in new file `app/src/lib/generate/intent.ts`
- [X] T032 [US1] Implement `resolveIntent(...)` as one `role: 'intent'` call (~400 max tokens, single attempt, never retried on malformed output) that degrades to the full analyze path on any failure, in `app/src/lib/generate/intent.ts`
- [X] T033 [P] [US1] Implement `applyDirectEdit(scope, arch)` per [contracts/agent-interfaces.md](./contracts/agent-interfaces.md) — rename / remove / single-field reconfigure, orphaned-edge cleanup, empty-container removal, **clamp to field bounds** (FR-039), re-price, re-validate, `applied: false` on any failure — in new file `app/src/lib/generate/direct-edit.ts`
- [X] T034 [US1] Wire `resolveIntent` into `routeTurn` with branches for `question`, `undo`, high-confidence simple edits, `ambiguous`, and the default analyze/build path, in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [X] T035 [US1] Emit the answer-only terminal payload (`architecture: null`, `answeredOnly: true`) for `question` turns per [contracts/chat-stream-events.md](./contracts/chat-stream-events.md), in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [ ] T036 ⚠️ **DEVIATED — implemented as an answer-only prose offer instead of a structured `restore_offer` interaction.** FR-008's guarantees (never auto-restores, never redesigns) hold; the structured round is deferred and [contracts/chat-stream-events.md](./contracts/chat-stream-events.md) records why. Original scope: [US1] Emit the `restore_offer` interaction payload for `undo` turns and perform the restore only on explicit confirmation, routing through the existing version-restore path (FR-008), in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [ ] T037 ⚠️ **NOT NEEDED under the T036 deviation** (the reply renders as an ordinary assistant message). Required only if the structured restore round is built later. Original scope: [US1] Render the answer-only reply and the restore-offer choice (Restore / Keep) using the existing interaction-round UI, in [app/src/components/studio/ChatPanel.tsx](app/src/components/studio/ChatPanel.tsx)
- [X] T038 [US1] Pass `EditScope.targets` into the planner as a hard scope constraint in the plan prompt, in [app/src/lib/generate/orchestrator.ts](app/src/lib/generate/orchestrator.ts)
- [X] T039 [US1] Enforce scope code-side after each plan lands — reject mutations outside `EditScope.targets` plus requested additions, reusing the preserve-user-work rejection mechanism, in [app/src/lib/generate/agent-loop.ts](app/src/lib/generate/agent-loop.ts)
- [X] T040 [US1] Emit `intent` and `direct-edit` trace steps so reference resolution and fast-path application are visible in the live trace, in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [ ] T041 [P] [US1] Author the 20-prompt modification evaluation fixture set (add / remove / rename / reconfigure / question / undo / ambiguous, each with an expected touched-node set) in `app/tests/fixtures/modification-eval.json`
- [ ] T042 [US1] Add the evaluation runner asserting SC-001 (≥90% turns touch only intended elements) and SC-006 (≥90% ambiguous cases ask), in `app/tests/modification-eval.test.ts`

**Checkpoint**: The reported defect is fixed and independently demonstrable — MVP shippable here

---

## Phase 4: User Story 2 - Generation stays inside provider rate limits (Priority: P2)

**Goal**: Simple steps run on small models, design stays on the most capable, rate-limit responses are honored rather than hammered, and real usage is recorded and comparable to the Phase 1 baseline.

**Independent Test**: [quickstart.md](./quickstart.md) US2 scenarios — burst test completes with zero rate-limit failures; `smallMidShare ≥ 0.5`; quality at or better than `baseline.json`.

### Tests for User Story 2 ⚠️

- [X] T043 [P] [US2] Test `Retry-After` parsing for delta-seconds and HTTP-date forms plus malformed values, in `app/tests/retry-after.test.ts`
- [X] T044 [P] [US2] Test per-role default chains resolve to expected provider/model ordering, skip providers lacking credentials, and cap chain length at 3, in `app/tests/llm-role-chains.test.ts`
- [ ] T045 ⚠️ **PARTIAL** — the sliding-window helper and pre-flight reordering are built and typechecked, but asserting the behavior needs a Mongo-backed test harness this suite does not yet have. [P] [US2] Test the sliding-window helper deprioritizes a provider at its per-minute ceiling before a request is sent, in `app/tests/llm-usage-window.test.ts`
- [ ] T046 ⚠️ **NOT STARTED** — burst test needs a live provider or a stubbed transport. [P] [US2] Burst test: a request volume that reliably 429-failed pre-feature completes with zero rate-limit turn failures, in `app/tests/rate-limit-burst.test.ts` (SC-005)
- [ ] T047 ⚠️ **NOT STARTED** — needs usage records from a real tiered run (blocked with T048). [P] [US2] Test `smallMidShare` computed from usage records reaches ≥0.5 for a representative guided turn, in `app/tests/model-tier-share.test.ts` (SC-004)

### Implementation for User Story 2

- [X] T048 **DONE — activated by the operator 2026-08-01** via the Settings toggle, after the T003 baseline was recorded (with its degraded-conditions caveat noted there). Live resolution verified: small roles → `groq/llama-3.1-8b-instant`, mid/large → NVIDIA nemotron-49b, the day-capped active model demoted to a mid fallback. Original scope: [US2] Replace the pass-through resolver with real per-role chains and defaults per the plan's role table, encoding free-tier ordering constraints (Gemini never early, OpenRouter last), in `app/src/lib/llm-roles.ts`
- [X] T049 [P] [US2] Pass `role: 'route'` at the router call site in [app/src/lib/generate/router.ts](app/src/lib/generate/router.ts)
- [X] T050 [US2] Pass `role: 'analyze'` and `role: 'interpret'` at their respective call sites in [app/src/lib/generate/analyze.ts](app/src/lib/generate/analyze.ts)
- [X] T051 [P] [US2] Pass `role: 'review'` at the reviewer call site in [app/src/lib/generate/reviewer.ts](app/src/lib/generate/reviewer.ts)
- [X] T052 [P] [US2] Pass `role: 'cost'` at both call sites in [app/src/lib/generate/cost-options.ts](app/src/lib/generate/cost-options.ts) and the call site in [app/src/lib/generate/cost-orchestrator.ts](app/src/lib/generate/cost-orchestrator.ts)
- [X] T053 [P] [US2] Pass `role: 'report'` at both call sites in [app/src/lib/generate/report.ts](app/src/lib/generate/report.ts)
- [X] T054 [US2] Pass `role: 'plan'` at the planning call site — keeps the most capable model — in [app/src/lib/generate/orchestrator.ts](app/src/lib/generate/orchestrator.ts)
- [X] T055 [US2] Parse `Retry-After` on 429 and wait exactly that delay when ≤8s and the turn budget allows, otherwise advance to the next chain entry, in [app/src/lib/llm.ts](app/src/lib/llm.ts)
- [X] T056 [US2] Derive the provider cooldown from `Retry-After` when present instead of the fixed 120s, in [app/src/lib/llm.ts](app/src/lib/llm.ts)
- [X] T057 [P] [US2] Add ±20% jitter to the chunk-planning pacing delay in [app/src/lib/generate/loop-config.ts](app/src/lib/generate/loop-config.ts)
- [X] T058 [P] [US2] Create the `LlmUsage` model with the fields, TTL index, and provider/at index from [data-model.md](./data-model.md), in new file `app/src/lib/models/LlmUsage.ts`
- [X] T059 [US2] Capture `response.usage`, latency, and outcome on both the OpenAI-compatible and Anthropic SDK paths as fire-and-forget writes that can never fail a turn, in [app/src/lib/llm.ts](app/src/lib/llm.ts)
- [X] T060 [US2] Add `recentRequests(provider, windowMs)` and use it to deprioritize a provider near its per-minute budget before dispatch, in `app/src/lib/llm-roles.ts`
- [X] T061 [P] [US2] Add the optional `roleModels` map to the settings singleton in [app/src/lib/models/LlmSettings.ts](app/src/lib/models/LlmSettings.ts)
- [X] T062 [US2] Extend the settings read/write path and validation schema to accept per-role overrides per [contracts/settings-llm-usage.md](./contracts/settings-llm-usage.md), rejecting unknown role keys, in [app/src/lib/llm-settings.ts](app/src/lib/llm-settings.ts) and [app/src/lib/schemas.ts](app/src/lib/schemas.ts) — completed with T104/T105; `roleModels` keys are now `z.enum([...LLM_ROLES])`, so a typo is a 400 rather than a setting that looks saved and is silently ignored. **Deviation**: the shared `parseBody` maps schema failures to **400**, not the 422 the contract names; changing that status is a cross-cutting API change and was not made for one field
- [X] T063 [US2] Honor stored `roleModels` ahead of defaults in chain resolution, in `app/src/lib/llm-roles.ts`
- [X] T064 [US2] Compare post-tiering convergence rate and iterations-to-pass against `baseline.json` and record the result in [quickstart.md](./quickstart.md) (SC-004, FR-041) — **measured and recorded 2026-08-01; verdict: not yet passed.** Both legs ran on the identical request set under the same degraded providers: convergence 0→0 (vacuously “held”), smallMidShare **0.109 < 0.5 ✗**. The failed share exposed T123 (below). SC-004 stays open until a healthy-fleet round — both legs are one command each and overwrite their files
- [X] T124 **Baseline request set v2 — 20 architectures grounded in official AWS references** (user request 2026-08-01). Replaced the six synthetic prompts with 20 workloads mirroring named AWS reference architectures — six generative-AI patterns (RAG knowledge-base assistant per the Bedrock agents + knowledge bases pattern, intelligent document processing, text-to-SQL analytics, agent-based task automation, batch content generation, semantic search) plus 14 classics (serverless web app, e-commerce, VOD, event-driven orders, microservices, lakehouse, streaming analytics, IoT, fraud ML, personalization, SaaS multi-tenant, payments ledger, warm-standby DR, game backend). GenAI entries cross-checked against the AWS Knowledge MCP the same day. Prompts describe capabilities, never name services — choosing services is the pipeline’s job. Also added: `--limit N` smoke mode (labeled as a subset), and a comparison guard that refuses a ––post verdict when pre/post `requestSet` labels differ — a 20-request run compared against the old 6-request file would be a confident verdict about two different exams. **v1 measurement files are superseded; both legs must be re-run on v2 (~40–90 min each) once the provider fleet is healthy — on 2026-08-01 it was fully exhausted (Groq day-capped, HuggingFace 402 credits depleted), verified by a ––limit 1 smoke that the harness correctly refused to record**
- [X] T123 **Unplanned fix — the mid tier was a label, not a behavior.** `TIER_PREFERENCES.mid` led with `nvidia/…nemotron-49b`, whose catalog tier is **large** — so 54/55 mid-role calls (review/cost/analyze) in the measured post-tiering run were served by, and recorded as, the same model class the plan role uses; smallMidShare could never have reached 0.5 with that configuration. Mid now leads with genuinely mid-tagged models (groq 70b, HF 70b); nvidia stays reachable via the catch-all. Regression-pinned: `llm-role-chains.test.ts` “tier honesty” asserts every mid role leads with a catalog-mid model whenever one is configured. The 49b was deliberately NOT retagged mid — that would have raised the measured share without moving any work, gaming the metric SC-004 exists to measure

**Checkpoint**: Rate-limit failures eliminated under normal conditions; large-model usage measurably reduced with quality held at baseline

---

## Phase 5: User Story 3 - Reusable knowledge (Priority: P3)

**Goal**: Best-practice rules, patterns, and self-distilled lessons live in MongoDB, are retrieved per request, supplied to both designer and reviewer, and grow from the system's own corrections — with provider rules living in their provider plugin.

**Independent Test**: [quickstart.md](./quickstart.md) US3 scenarios — rules consulted and graded; a distilled lesson verified project-agnostic; disabling a rule takes effect with no redeploy; AWS rules provably live outside core.

### Tests for User Story 3 ⚠️

- [X] T065 [P] [US3] Test keyword retrieval scoring, provider/designMode filtering, top-K limiting, char capping, exclusion of disabled/low-confidence/stale entries, and `[]` on database failure, in `app/tests/knowledge-store.test.ts`
- [ ] T066 ⚠️ **PARTIAL** — `contentHash` identity is unit-tested in `knowledge-store.test.ts`; asserting the upsert round-trip needs a Mongo-backed harness this suite lacks. [P] [US3] Test content-hash dedupe: an equivalent entry updates in place and returns `created: false`, in `app/tests/knowledge-dedupe.test.ts`
- [X] T067 [P] [US3] Test distilled lessons containing project names, user-text literals, or identifiers are rejected before storage, in `app/tests/knowledge-distill.test.ts` (FR-021)
- [X] T068 [P] [US3] Test that provider rules are collected through the registry and that no core module enumerates a provider's services, in `app/tests/provider-rules-registry.test.ts` (FR-038, constitution II)

### Implementation for User Story 3

- [X] T069 [P] [US3] Create the `KnowledgeEntry` model with all fields, the unique `hash` index, the provider/designMode/enabled index, the text index, and the `lastUsedAt` index per [data-model.md](./data-model.md), in new file `app/src/lib/models/KnowledgeEntry.ts`
- [X] T070 [US3] Implement `retrieveKnowledge`, `upsertKnowledge`, and `recordKnowledgeUsage` per [contracts/agent-interfaces.md](./contracts/agent-interfaces.md), including normalization and content hashing, in new file `app/src/lib/knowledge/store.ts`
- [X] T071 [P] [US3] Author the provider-agnostic core rules (no empty containers, left→right reading order, queue between producer and consumer, every node edged, modification-turn scoping, ambiguity, undo-means-restore) in new file `app/src/lib/knowledge/core-rules.ts`
- [X] T072 [P] [US3] Author AWS seed rules per [data-model.md](./data-model.md) in new file `app/src/lib/providers/aws/rules.ts` — **must not live in core** (FR-038)
- [X] T073 [P] [US3] Author MongoDB Atlas seed rules in new file `app/src/lib/providers/mongodb/rules.ts`
- [X] T074 [P] [US3] Author HLD/LLD seed rules, migrated out of the hardcoded design-principles brief, in new file `app/src/lib/providers/system/rules.ts`
- [X] T075 [US3] Expose per-provider `rules` through the provider plugin type and registry so seeding walks the registry, in [app/src/lib/providers/types.ts](app/src/lib/providers/types.ts) and [app/src/lib/providers/registry.ts](app/src/lib/providers/registry.ts)
- [X] T076 [US3] Create the idempotent (hash-keyed) seeding script with a `--prune` mode, sourcing rules from the registry plus core rules, in new file `app/scripts/seed-knowledge.mjs`, and register a `seed:knowledge` script in [app/package.json](app/package.json)
- [X] T077 [US3] Inject retrieved knowledge as a `HOUSE RULES & LESSONS:` block into the plan prompt in [app/src/lib/generate/orchestrator.ts](app/src/lib/generate/orchestrator.ts)
- [X] T078 [US3] Inject the same retrieved rules into the reviewer prompt so stored rules are graded, not merely suggested (FR-019), in [app/src/lib/generate/reviewer.ts](app/src/lib/generate/reviewer.ts)
- [X] T079 [US3] Back `matchReferencePatterns` with the knowledge store, retaining the hardcoded array as an offline fallback — [reference-patterns.ts](app/src/lib/generate/reference-patterns.ts) (pure serialize/parse/select), [knowledge/patterns.ts](app/src/lib/knowledge/patterns.ts) (store-backed matcher), seeding extended, orchestrator swapped. Seeded and verified live: 10 pattern rows in the store, visible in Settings → AI Knowledge. Design points: serialized content puts **notes last** so the 600-char store cap can only ever truncate prose, never the service ids/flow the planner maps onto the canvas (all 10 built-ins verified ≤ cap); the fallback boundary is "no pattern rows", not "no enabled rows", so an operator disabling all patterns gets none — the built-in array must not resurrect what they switched off (FR-032); selection logic is shared (`selectPatterns`) so a pattern cannot match differently depending on where it was loaded from
- [X] T080 [US3] Replace the hardcoded design-principles brief with the seeded system rules in [app/src/lib/providers/system/mcp.ts](app/src/lib/providers/system/mcp.ts)
- [X] T081 [US3] Generalize the guidance-cache signature to fall back to top capability keywords when no reference pattern matches, keeping old-form keys valid, in [app/src/lib/generate/guidance-cache.ts](app/src/lib/generate/guidance-cache.ts)
- [X] T082 [P] [US3] Implement `distillLesson(...)` as one `role: 'distill'` call returning `null` when no generalizable lesson exists, with project-identifying content rejected before storage, in new file `app/src/lib/knowledge/distill.ts`
- [X] T083 [US3] Invoke the distiller post-turn — after the result is persisted, never blocking the stream, only when iteration 1 failed review and a refinement corrected it — in [app/src/app/api/projects/[id]/chat/messages/route.ts](app/src/app/api/projects/[id]/chat/messages/route.ts)
- [X] T084 [US3] Implement the confidence lifecycle (start 0.6, +0.05 per passing injected turn, prune below 0.5 or unused 60 days) in `app/src/lib/knowledge/store.ts`
- [X] T085 [US3] Emit a `knowledge` trace step naming consulted rule titles and count, in [app/src/lib/generate/agent-loop.ts](app/src/lib/generate/agent-loop.ts)

**Checkpoint**: Generation grounded in stored, editable, self-growing knowledge; provider rules extensible without core edits

---

## Phase 6: User Story 4 - The assistant researches what it does not know (Priority: P4)

**Goal**: A research agent fills genuine gaps from official documentation, caches findings into the store, re-verifies once stale, and the external integration set becomes configuration-driven.

**Independent Test**: [quickstart.md](./quickstart.md) US4 scenarios — research step visible, finding stored with source and horizon, repeat request performs zero lookups, aged entry re-verified, unset keys degrade gracefully.

### Tests for User Story 4 ⚠️

- [X] T086 [P] [US4] Test backend selection order (Tavily → Brave → disabled), graceful no-key disablement, and post-call domain filtering that drops non-allowlisted hosts, in `app/tests/web-search-backend.test.ts`
- [ ] T087 ⚠️ **PARTIAL** — the waterfall's ordering is implemented and the disabled/no-key paths are covered by `web-search-backend.test.ts`; asserting "no web call when the store hits" needs a Mongo-backed harness. [P] [US4] Test the waterfall performs no web call when the store or provider MCPs satisfy the need, and at most one web call per turn, in `app/tests/knowledge-waterfall.test.ts`
- [ ] T088 ⚠️ **COVERED ELSEWHERE** — keyword-only transmission is enforced and tested at the boundary (`toSafeQuery` in `web-search-backend.test.ts`) rather than in a separate suite. [P] [US4] Test that only derived capability keywords — never raw user request text — are transmitted to a search backend, in `app/tests/research-privacy.test.ts` (FR-030)
- [ ] T089 ⚠️ **PARTIAL** — staleness withholding is unit-tested in `knowledge-store.test.ts` (`selectRelevant`); the re-verification round-trip needs Mongo. [P] [US4] Test an entry past `staleAfter` is re-verified from source rather than reused, in `app/tests/knowledge-staleness.test.ts` (FR-026)

### Implementation for User Story 4

- [X] T090 [P] [US4] Define the `SearchBackend` interface with Tavily and Brave implementations, a disabled no-op, and post-call domain-allowlist filtering per [contracts/agent-interfaces.md](./contracts/agent-interfaces.md), in new file `app/src/lib/research/web-search.ts`
- [X] T091 [US4] Enforce keyword-only transmission at the search boundary so callers cannot opt out (FR-030), in `app/src/lib/research/web-search.ts`
- [X] T092 [US4] Implement `gatherKnowledge(...)` with the contractual store → MCP → web ordering, at most one web operation per turn, and `degraded` reporting, in new file `app/src/lib/research/knowledge-agent.ts`
- [X] T093 [US4] Summarize fetched pages via a `role: 'research'` call and persist findings as `source: 'web'` with `sourceUrl` and `staleAfter: +14d`, in `app/src/lib/research/knowledge-agent.ts`
- [X] T094 [US4] Implement stale-entry re-verification: a finding past its horizon is refreshed from source before reuse (FR-026), in `app/src/lib/research/knowledge-agent.ts`
- [X] T095 [US4] Emit a `research` trace step naming the derived search terms actually sent, in [app/src/lib/generate/agent-loop.ts](app/src/lib/generate/agent-loop.ts)
- [X] T096 [P] [US4] Create the data-driven MCP server registry (`id`, `command`, `tools`, `provider`, `purpose`, `enabled`) seeded from environment, in new file `app/src/lib/providers/mcp-registry.ts`
- [X] T097 [US4] Resolve MCP servers through the registry instead of scattered environment lookups, preserving the existing command-keyed client pool, in [app/src/lib/providers/mcp-client.ts](app/src/lib/providers/mcp-client.ts) — `resolveMcpServer`/`mcpServersForPurpose`/`callServerTool` added; `aws/mcp.ts`, `aws/pricing.ts` and `mongodb/mcp.ts` no longer read `*_MCP_COMMAND`. The AWS documentation server is now a real second knowledge rung (called with its own tool and argument shape), and regional availability selects its server by **declared tool**, not by id
- [X] T098 [P] [US4] Register `awslabs.aws-documentation-mcp-server` as a fallback knowledge rung in `app/src/lib/providers/mcp-registry.ts`
- [X] T099 [US4] Add the optional diagram-MCP topology cross-check behind `DIAGRAM_MCP_CROSSCHECK_ENABLED`, surfaced to the reviewer as **advisory only** and never authoritative or user-visible as truth (FR-040), in [app/src/lib/generate/topology-crosscheck.ts](app/src/lib/generate/topology-crosscheck.ts) + [reviewer.ts](app/src/lib/generate/reviewer.ts) — `advisoryNotes` is a separate input from `validationGaps` precisely so it cannot reach a hard gate; success and "not configured" both return `''`, so no path can depend on the check having run. **Worth knowing**: the diagram MCP is a renderer, not an architecture validator — its signal is narrow (broken references, ungraphable layouts) and largely overlaps our own structural validator. It earns its place by being independent of our code, not by being smarter than it, which is why it stays off by default

**Checkpoint**: Knowledge gaps closed from official sources and cached; integrations extensible by configuration

---

## Phase 7: User Story 5 - Operators can see and tune AI behavior (Priority: P5)

**Goal**: Real usage replaces mock figures, per-role model assignment is configurable, and stored knowledge is reviewable — all under existing RBAC and the accessibility floor.

**Independent Test**: [quickstart.md](./quickstart.md) US5 scenarios — real usage shown, role assignment honored, disabled rule not applied, non-admin read-only with server-side enforcement.

### Tests for User Story 5 ⚠️

- [X] T100 [P] [US5] Test usage aggregation totals, `byConnection`, `byRole`, and `smallMidShare` for a window, and that `byRole` is omitted without `settings:manage`, in `app/tests/usage-aggregate.test.ts`
- [X] T101 [P] [US5] Test knowledge admin endpoints enforce `settings:manage` server-side, return 409 on hash collision, and 422 on content over 600 chars, in `app/tests/knowledge-admin-rbac.test.ts`

### Implementation for User Story 5

- [X] T102 [P] [US5] Implement `GET /api/settings/llm/usage` per [contracts/settings-llm-usage.md](./contracts/settings-llm-usage.md), returning zeroed totals rather than an error on an empty collection, in new file `app/src/app/api/settings/llm/usage/route.ts`
- [X] T103 [P] [US5] Implement knowledge admin `GET`, `PATCH`, `DELETE`, and `POST /reseed` per [contracts/settings-knowledge.md](./contracts/settings-knowledge.md), including the `willReseed` flag on seed-entry deletion — **deviation from the stated single file, on purpose**: the App Router derives the URL from the directory, so `PATCH`/`DELETE` on `:id` must live in `knowledge/[id]/route.ts` and reseed in `knowledge/reseed/route.ts`; putting them in one file would not produce the contracted URLs. Seeding itself moved to `app/src/lib/knowledge/seed.ts` so the endpoint and `npm run seed:knowledge` share one implementation
- [X] T104 [P] [US5] Add validation schemas for the usage and knowledge admin endpoints in [app/src/lib/schemas.ts](app/src/lib/schemas.ts)
- [X] T105 [US5] Extend `GET /api/settings/llm` with `roleModels` and a `roleDefaults` resolution preview so tiering is verifiable without running a generation, in [app/src/app/api/settings/llm/route.ts](app/src/app/api/settings/llm/route.ts)
- [X] T106 [US5] Replace the hardcoded "Usage this month" mock figures with real aggregates in [app/src/app/(dashboard)/settings/page.tsx](app/src/app/(dashboard)/settings/page.tsx)
- [X] T107 [US5] Add per-role model assignment controls, read-only for non-administrators, in [app/src/app/(dashboard)/settings/page.tsx](app/src/app/(dashboard)/settings/page.tsx)
- [X] T108 [US5] Add a knowledge review panel (list, edit, disable, delete, reseed) showing source and confidence, in [app/src/app/(dashboard)/settings/page.tsx](app/src/app/(dashboard)/settings/page.tsx)
- [X] T109 [US5] Verify the new settings controls meet the constitution accessibility floor — visible keyboard focus, reduced-motion, responsive — in [app/src/app/(dashboard)/settings/page.tsx](app/src/app/(dashboard)/settings/page.tsx). **Verified**: `Button`, `Switch`, `Input`/`Select`/`Textarea` all carry focus-visible rings; the two bare `<button>`s (section nav, "show per-step assignment") were given explicit rings since they do not inherit one; reduced-motion is covered globally by `globals.css` (including the `animate-spin` loaders); every new grid uses `sm:` breakpoints and the usage table scrolls inside `overflow-x-auto` rather than forcing page-level horizontal scroll; the usage table has a `<caption>` and `scope="col"` headers, filter `Select`s carry `aria-label`, and status/error text uses `role="status"` / `role="alert"`. **Not done**: the section nav is a `<nav>` of buttons rather than a true ARIA tablist with arrow-key navigation — pre-existing, and converting it is a separate change

**Checkpoint**: All five stories complete; AI behavior observable and tunable

---

## Phase 8: Polish & Cross-Cutting Concerns

- [~] T110 **PARTIAL — automated portion green, live scenarios pending.** Re-run the feature 004 quickstart scenarios (live trace, iteration budget, stop control) and record results — must pass unchanged (SC-008)
- [~] T111 **PARTIAL — automated portion green, live scenarios pending.** Re-run the feature 005 quickstart scenarios (incremental chunked build-up, pacing) and record results — must pass unchanged (SC-008)
- [~] T112 **PARTIAL — automated portion green, live scenarios pending.** Re-run the feature 006 quickstart scenarios (analyze → clarify → build → cost → finalize) and record results — must pass unchanged (SC-008)
- [~] T113 **PARTIAL** — sign-off checklist in [quickstart.md](./quickstart.md) filled in with what is actually verified: the automated quality gate is checked and dated; every item needing a browser, a live model, or a running database is left unchecked with the reason stated. The remaining boxes need one working-environment pass
- [X] T114 Run `npm test`, `npm run build`, and `npm run lint` in `app/` and confirm all pass (constitution Principle V quality gate) — **2026-07-31: 53 files / 527 tests pass, build compiles, lint clean.** Run with MongoDB deliberately stopped, which is how the knowledge-store stall (below) was found
- [X] T115 [P] Review whether the multi-agent roster, knowledge store, and model-tiering policy warrant a constitution amendment in [.specify/memory/constitution.md](.specify/memory/constitution.md) — **review done 2026-07-31; the amendment itself is a governance act and awaits the maintainer's go-ahead.** Findings:

  **Warrants an amendment — knowledge provenance & privacy.** 008 introduced something the constitution has no rule for: a durable store that shapes every generation and that **the system writes to itself**. Two invariants are currently protected only by module comments and would be easy for a future feature to breach without noticing: (a) only derived capability keywords may leave the system — raw request text can name employers, products and internal systems; (b) nothing project-specific may be promoted into shared knowledge. Both are security-shaped and belong under Principle III, which already says credentials never reach the browser but says nothing about user content flowing outward or into shared state. Recommended addition to Technology & Security Constraints: *no raw user content leaves the system or enters durable shared knowledge; stored knowledge carries its source and a confidence, and any entry is disableable by an operator without a deploy.*

  **Warrants an amendment — advisory sources are never authoritative.** FR-040's rule (a secondary opinion informs self-review, never overrides the design, never shown as truth) is the same principle as the existing *"placeholder pricing is clearly labelled as indicative"* constraint, generalized. Both exist so the user can always tell how much to trust what they are shown. Recommended as a one-line generalization of that existing bullet rather than a new section.

  **Does NOT warrant an amendment — model tiering.** Which model serves which work class is tunable operational policy, like the 90s/120s performance envelopes already described as "tunable without a product change". Constitutionalising a tier table would freeze a decision that should follow provider pricing and rate limits. Principle I already governs the part that matters (which providers are legitimate).

  **Does NOT warrant an amendment — the agent roster.** The roles are an implementation shape, not a governance rule; naming them in the constitution would make every future refactor an amendment.
- [X] T122 **Unplanned fix — every settings save returned 400 (Zod 4 exhaustive-record semantics).** T104 constrained `roleModels` keys with `z.record(z.enum([...LLM_ROLES]), …)` so a typo'd role would be rejected — but in Zod 4 a record with an enum key schema is **exhaustive**: it rejects any object missing one of the ten keys. The settings UI always sends `roleModels`, containing only the roles the operator pinned (usually none), so **every save of Settings → AI Provider failed** from the moment the constraint landed. Caught live — an operator's `PUT /api/settings/llm 400` in the dev log while the baseline ran; it shipped because `llmSettingsPutSchema` was the one new schema without a test. Fixed with `z.partialRecord` (partial maps and `{}` valid, unknown keys still rejected) in [schemas.ts](app/src/lib/schemas.ts), pinned by `app/tests/llm-settings-schema.test.ts`, and verified against the running server: empty map → 200, one pinned role → 200
- [X] T120 **Unplanned fix — a stale fallback model took down whole turns (the opposite of what the fallback chain is for).** `llmJson` treated a hard config error (bad key, missing model) as fatal for the ENTIRE chain: `if (!e.retryable && e.kind === undefined) throw e`. On the **active** connection that is right — the operator chose it and silently serving from elsewhere would hide a misconfiguration. On a **fallback** it is wrong: the operator never chose that connection for this turn, it is standing in because the primary was rate-limited, and aborting there converts a transient limit into a failed turn. **Observed live during the baseline run**: Groq rate-limited (`route/rate_limited: 2`, `analyze/rate_limited: 1` in `LlmUsage`), the chain fell back to OpenRouter's catalog default `meta-llama/llama-3.3-70b-instruct:free` which had been **withdrawn upstream**, and two of six requests died with no architecture — while two healthy connections sat unused behind it. Fixed in [llm.ts](app/src/lib/llm.ts): a config error on a fallback now skips that connection and continues down the chain
- [X] T121 **Unplanned — the model catalog had rotted, and nothing could tell.** Verified every catalog id against each provider's live model list: OpenRouter's `meta-llama/llama-3.3-70b-instruct:free` (**the defaultModel**) and `deepseek/deepseek-chat-v3-0324:free` were gone, as was NVIDIA's `qwen/qwen2.5-coder-32b-instruct`. Replaced with live-verified ids and real context lengths fetched from the provider APIs rather than guessed. Added `app/scripts/check-models.mjs` (`npm run models:check`), which fails the run when a **defaultModel** no longer exists — that is the id a fallback picks, so a stale one is the dangerous case. Now reports `✓` for all 5 keyed providers. Also gave NVIDIA a genuine SMALL model (`meta/llama-3.1-8b-instruct`) and added it to the small-tier preferences in [llm-roles.ts](app/src/lib/llm-roles.ts): without one, the highest-frequency roles fell through to NIM's 49b default, putting exactly the load back on the largest model that this feature exists to remove
- [X] T117 **Unplanned — the CLI scripts could not run at all.** `seed-knowledge.mjs` and `measure-baseline.mjs` import app source (`@/…` aliases, `.ts` files, `server-only`), which plain `node` resolves none of — so `npm run seed:knowledge` had never actually executed. Added `tsx` + `scripts/tsconfig.json` (aliases plus a `server-only` stub mirroring the vitest one) and `--env-file=.env.local`. **Verified against a live database**: 24 rules seeded, and a second run reported `0 created, 24 updated`, confirming the FR-022 content-hash dedupe end to end rather than by unit test alone
- [X] T118 **Unplanned — MCP connectivity was unverifiable.** An MCP server is a subprocess launched from a command string; a typo, a missing runtime, or a renamed tool all fail the same silent way, degrading generation to indicative mode with nothing said. Added `app/scripts/mcp-doctor.mjs` (`npm run mcp:doctor`), which launches every server the **registry** reports, lists its tools, and flags any tool an adapter intends to call that is not there. Added `closeMcpClients()` to [mcp-client.ts](app/src/lib/providers/mcp-client.ts) so short-lived callers do not leave subprocesses running. **Result: 4/4 reachable, zero missing tools** — `aws-knowledge` (5 tools, incl. `aws___get_regional_availability`), `aws-pricing` (9), `mongodb-knowledge` (29), `aws-documentation` (5). This is the first end-to-end proof of the T097/T098 registry work against real servers
- [X] T119 **Unplanned fix — the baseline harness measured the wrong thing (would have invalidated SC-004).** Two defects. (1) `new URL(...).pathname` yields `/C:/…` on Windows, so the write failed as `C:\C:\…` and nothing was saved. (2) Far worse: a fresh request enters the **006 guided flow**, which answers with an *analyze* turn that asks clarifying questions and draws nothing — persisted as `converged: true, iterations: 1` because it did what it set out to do. The harness read those fields directly, so its first run reported a perfect **1.0 convergence / 1.0 iterations** baseline computed entirely from turns that never designed anything; the persisted runs each had exactly one step, `analyze:done`. Fixed by driving each request through the clarify round with skip-all (006 Scenario 2) to reach the build turn, measuring the run that contains a `draft`/`review`/`refine` step, and **refusing to write `baseline.json` at all** when no request reached a design pass. A baseline that looks authoritative but was computed from clarify turns is worse than none — the SC-004 comparison would silently pass
- [X] T116 **Unplanned fix — knowledge store degrades fast, not eventually.** `retrieveKnowledge`/`upsertKnowledge`/`recordKnowledgeUsage` caught database errors but only after `connectDB` waited out Mongoose's 30s server-selection timeout, so an outage in an OPTIONAL grounding source would have added ~30s to **every generation turn** — inside a 120s turn budget — before degrading. Bounded with an explicit deadline (1.5s read / 4s write) in [app/src/lib/knowledge/store.ts](app/src/lib/knowledge/store.ts); pinned by `app/tests/knowledge-store-deadline.test.ts`. Found by running the suite with MongoDB stopped, which surfaced it as nine agent-loop timeouts. `pruneKnowledge` is deliberately left unbounded: its only callers are the seed CLI and the admin reseed endpoint, where a real failure should be reported rather than silently skipped

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. **T001 before any new key is added; T003 before Phase 4.**
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Stories (Phases 3–7)**: All depend only on Foundational; proceed in priority order P1 → P5
- **Polish (Phase 8)**: Depends on all desired stories

### User Story Dependencies

- **US1 (P1)**: Foundational only. Passes `role: 'intent'`, which resolves to existing behavior until US2 — **no dependency on other stories**.
- **US2 (P2)**: Foundational only. **Requires T003's baseline to already exist** for SC-004 comparison.
- **US3 (P3)**: Foundational only. Its distiller uses `role: 'distill'`, which works with or without US2.
- **US4 (P4)**: Foundational only for the MCP registry. Its caching benefit is fully realized once US3's store exists; if built first, findings still ground the current turn.
- **US5 (P5)**: Foundational only for endpoints. Shows real data once US2's usage records exist and manages entries once US3 exists — **ship after both for full value**.

### ⚠️ Shared-File Contention (read before parallelizing stories)

These files are edited by multiple stories. **Sequence the stories rather than staffing them concurrently**, or assign single-owner-per-file:

| File | Tasks |
|---|---|
| `chat/messages/route.ts` | T022, T028, T034, T035, T036, T040 (US1) · T083 (US3) |
| `orchestrator.ts` | T025, T038 (US1) · T054 (US2) · T077 (US3) |
| `reviewer.ts` | T030 (US1) · T051 (US2) · T078 (US3) · T099 (US4) |
| `llm.ts` | T008 (Foundational) · T055, T056, T059 (US2) |
| `llm-roles.ts` | T007 (Foundational) · T048, T060, T063 (US2) |
| `agent-loop.ts` | T029, T039 (US1) · T085 (US3) · T095 (US4) |
| `settings/page.tsx` | T106–T109 (US5, strictly sequential) |
| `knowledge/store.ts` | T070, T084 (US3) |

### Within Each User Story

- Tests are written first and MUST FAIL before implementation
- Models/types → services → route wiring → trace/UI integration
- Complete a story before starting the next priority

### Parallel Opportunities

- T004, T005 (Setup)
- T006, T007, T011 (Foundational); T008 follows T007; T009 follows T007+T008; T012 follows T010+T011
- All seven US1 tests (T014–T020)
- T021, T026, T031, T033, T041 (US1 — distinct new or independent files)
- All five US2 tests (T043–T047); implementations T049, T051, T052, T053, T057, T058, T061
- All four US3 tests (T065–T068); implementations T069, T071, T072, T073, T074, T082
- All four US4 tests (T086–T089); implementations T090, T096, T098
- T100, T101 (US5 tests); T102, T103, T104 (distinct new files) — T105–T109 are sequential

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests together, confirm they fail:
Task: "Test conversation-context rendering in app/tests/conversation-context.test.ts"
Task: "Test mergeBrief in app/tests/brief-merge.test.ts"
Task: "Test sanitizeEditScope in app/tests/intent-sanitize.test.ts"
Task: "Fixture test reference resolution in app/tests/intent-resolve.test.ts"
Task: "Test direct-edit executor incl. clamping in app/tests/direct-edit.test.ts"
Task: "Test out-of-scope rejection in app/tests/edit-scope-enforcement.test.ts"
Task: "Test fast-path budget in app/tests/fast-path-budget.test.ts"

# Then the independent new-file implementations together:
Task: "Create conversation-context.ts in app/src/lib/generate/conversation-context.ts"
Task: "Create intent.ts EditScope + sanitizer in app/src/lib/generate/intent.ts"
Task: "Create direct-edit executor in app/src/lib/generate/direct-edit.ts"
Task: "Extend briefSchema in app/src/lib/models/AIConversation.ts"
Task: "Author eval fixtures in app/tests/fixtures/modification-eval.json"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (T001–T005) — **rotate keys and capture the baseline first**
2. Phase 2 Foundational (T006–T013) — blocks everything, changes nothing
3. Phase 3 User Story 1 (T014–T042)
4. **STOP and VALIDATE**: run quickstart US1 scenarios 1–8 and the evaluation set; confirm SC-001, SC-002, SC-003, SC-006
5. Ship — the reported follow-up defect is fixed on its own

### Incremental Delivery

1. Setup + Foundational → seams in place, zero behavior change
2. US1 → follow-ups understood → **MVP, ship**
3. US2 → rate limits handled, large-model calls roughly halved → ship
4. US3 → knowledge store and self-learned rules → ship
5. US4 → web research and configurable integrations → ship
6. US5 → observability and operator control → ship

### Team Strategy

Given the shared-file contention table above, **sequential story delivery is recommended over concurrent staffing**. If parallelizing, assign file ownership: one developer owns `chat/messages/route.ts` + `agent-loop.ts` + `orchestrator.ts` (US1 core), another owns `llm.ts` + `llm-roles.ts` (US2), a third owns the new `knowledge/` and `research/` directories (US3/US4), which have almost no overlap with the rest.

---

## Notes

- Every new model output passes through a `sanitize*` function before use — structured-output enforcement is documented-unreliable on the configured providers and small models are worse (FR-036)
- Never loop on non-compliant model output; degrade to prior behavior instead
- New steps respect the existing 120s hard cap and 25s abort threshold (FR-037)
- `[P]` marks tasks touching different files with no incomplete dependency
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
