# Research: Guided Diagram Generation Flow

**Feature**: 006-guided-generation-flow | **Date**: 2026-07-09

All unknowns from the Technical Context resolved. Each decision below records what was chosen,
why, and what else was evaluated. File references are to the current codebase (features
001/003/004/005 implemented).

## D1 — Interaction model: multi-turn phase state machine (the load-bearing decision)

**Decision**: The guided flow spans **multiple short turns** governed by a state machine
persisted on the conversation (`AIConversation.flow`). A turn that needs user input ends
normally — its assistant message carries a structured `interaction` (question round or pricing
options) and the conversation records `flow.awaiting`. The user's response arrives as the next
POST to the same messages route (structured `interactionResponse` and/or free text), and the
router runs the next phase's turn. A turn never blocks waiting for the user.

**Rationale**: The messages route runs with `maxDuration = 120` and streams NDJSON to a single
terminal event; holding a stream open across unbounded user think-time is impossible on this
platform and would violate SC-008's budget accounting. The multi-turn model gives FR-015
("user wait time excluded") structurally for free, survives tab-closes and thread resumes (the
open round is just message + conversation state, re-rendered on GET), and keeps every existing
guarantee (409 lock, stop semantics, stale-lock guard, NDJSON error contract) because each
phase is an ordinary turn.

**Alternatives considered**:
- *Blocking stream (pause mid-turn, resume on answer)*: rejected — impossible within the 120s
  route ceiling; would also break the stop/stale-lock model and burn the time budget on think-time.
- *Client-side orchestration with separate endpoints per phase* (`/analyze`, `/answers`,
  `/options`…): rejected — splinters the concurrency lock and stop control across routes,
  duplicates auth/stream scaffolding, and makes thread resume harder (client must reassemble
  state). One route + a server-side router keeps the protocol in one place.
- *Reuse the existing cost-`clarificationQuestion` text-append pattern*: rejected as the primary
  mechanism — it is advisory prose with no options, no resolution state, and no way to validate
  answers; kept only as prior art for free-text answering (see D8).

## D2 — Analyze phase: extend `understandRequest` into a user-facing analyze step

**Decision**: Replace the internal-only `understand` phase (`agent-loop.ts` lines 120–137) with
a richer `analyzeRequest()` in a new `lib/generate/analyze.ts`. One structured LLM call
(`ANALYZE_SCHEMA`) returns: capabilities, scale signals, constraints, detected gaps, the request
classification (D4), validation questions (≤ `QUESTION_LIMIT`), and candidate service sets (D3).
The result renders as the assistant's analysis summary (FR-001) plus the interaction block, and
is emitted as a new `analyze` trace step. The build turn consumes the consolidated
`RequirementBrief` instead of re-running understand.

**Rationale**: The understand phase already extracts `capabilities[]` and `changeScope[]` — the
analyze phase is the same extraction with more fields and a visible output, so one call serves
both FR-001 and the loop's existing needs (change-scope protection carries over). One call keeps
the analyze turn well inside budget and the provider rate cap.

**Alternatives considered**: two separate calls (analysis, then question generation) — rejected;
doubles latency and rate-limit exposure for no quality gain at this scale. Keeping understand
internal and adding a parallel analyze call — rejected; two overlapping extractions can disagree,
and the brief must be the single source of truth (FR-006).

## D3 — Candidate service sets: catalog-grounded LLM proposal, code-validated

**Decision**: The analyze call proposes, per stated need with multiple viable services, a
`service_choice` question listing 2–4 candidate service IDs drawn from the catalog prompt
(`catalogPrompt()` already feeds the full provider catalogs), each with a one-line trade-off and
exactly one `recommended: true`. Server code validates every candidate against
`serviceById`/`resolveServiceDef`, drops unknown IDs, dedupes, and collapses the question to a
confirmation when fewer than 2 valid candidates survive (spec edge case).

**Rationale**: The catalog has no capability→candidates mapping (confirmed absent), and
maintaining a static one would hard-code provider knowledge in core — against Principle II. The
LLM already selects services from the catalog prompt today; asking it to *enumerate* the
plausible candidates it would otherwise silently choose among is the same competence, and code
validation makes hallucinated IDs harmless. New providers' catalogs automatically join the
candidate pool.

**Alternatives considered**: static capability→services mapping per provider catalog — rejected
(maintenance burden, Principle II tension, goes stale as catalogs grow); deriving candidates
purely from catalog `category` equality — rejected (categories are coarse: "database" lumps
choices the user cares to distinguish, while some needs cross categories).

## D4 — Major-vs-small-edit router: classifier in the analyze call + code backstops

**Decision**: `ANALYZE_SCHEMA` includes `requestClass: 'new' | 'major_revision' | 'small_edit'`
with prompt guidance (small = narrow blast radius: rename, config tweak, add/modify ≤2 services
on an existing canvas; major = redesign, multi-service addition, changed non-functional
requirements). Code backstops: empty canvas ⇒ always `new` (guided); a `small_edit`
classification with an ambiguity may carry at most one follow-up question (FR-013); classifier
failure degrades to `major_revision` for a non-empty request (safe default: asks before acting).
Small edits route directly into today's loop — zero interaction steps (SC-007).

**Rationale**: The blast-radius judgment is inherently semantic — the spec itself defers it to
an assistant heuristic. Placing it in the analyze call costs nothing extra (same call), and the
code backstops bound the failure modes.

**Alternatives considered**: pure heuristics (keyword lists, node-count deltas) — rejected as
primary (brittle: "add a cache" vs "add multi-region DR" differ only semantically); a separate
cheap classifier call — rejected (extra latency/rate budget for information the analyze call
already has).

## D5 — Pricing options: LLM-planned config variants, engine-priced, stored for switching

**Decision**: A new `lib/generate/cost-options.ts` generates exactly two named variants of the
built architecture — `cheapest` and `best_practice` — as **per-node config patches** (tier /
instance-type / quantity choices), never removing a service or dropping a confirmed capability
(FR-011). One structured LLM call (`OPTIONS_SCHEMA`) plans both patch sets with trade-off
summaries, grounded in catalog field definitions and the brief's scale answers; every patched
config passes `clampToFieldBounds`; then each variant is priced deterministically with
`priceNodes()` for itemized monthly estimates. Both options persist on `conversation.flow`
(and as a `cost_options` interaction on the message). Applying one writes the configs to the
architecture nodes and runs `recomputeProjectEstimate`; switching later re-applies the stored
other option without any regeneration — config-only writes don't trigger re-layout
(`layoutIfStructural` gating already guarantees this).

**Rationale**: LLM plans *which* knobs to turn (semantic), the pricing engine computes *what it
costs* (deterministic, honors the ±5%/indicative policy — figures are never LLM-generated).
Config-patch variants preserve the capability guarantee by construction since node/edge structure
is untouched. Storing both options makes FR-011's switch path a cheap deterministic re-apply.

**Alternatives considered**: two full regenerations with different objectives — rejected (slow,
burns rate budget, risks structural drift that violates "both options preserve every confirmed
capability"); rule-based variants (min all numeric fields / max redundancy flags) — rejected as
primary (catalog fields lack the semantics to know that Multi-AZ is "best practice" but a bigger
instance is just "bigger"; kept as the degradation path when the options call fails: cheapest =
catalog minimums via `clampToFieldBounds` floors, best-practice = catalog defaults, honestly
labelled); reusing `CostEstimateOverride` to represent options — rejected (overrides model
user-pinned per-line costs, not coherent config variants; mixing them would corrupt the
override UX's "manual" semantics).

## D6 — Finalize pass: scoped ELK layout + overlap audit

**Decision**: `lib/generate/finalize.ts` runs after the pricing option is applied (or skipped):
(1) re-layout via the existing `layoutWithElk` (`layered`, `direction: RIGHT` ⇒ consistent
left-to-right flow, container-aware) — **scoped to the changed subgraph** (new/AI-modified nodes
via ELK selection support) in the revision case so user-arranged positions are preserved
(FR-012); full-canvas layout when the whole architecture is AI-generated this flow; (2) a
deterministic AABB overlap audit over final node/container boxes (using the established
`NODE_W`/`NODE_H` geometry) with a simple axis-nudge resolution for residual collisions between
laid-out and position-preserved elements; (3) if overlaps remain after bounded nudging, deliver
best layout and state the limitation in the reply (spec edge case — honest reporting per
Principle V). Emitted as a `finalize` trace step.

**Rationale**: ELK layered already produces non-overlapping, direction-consistent layouts for
the elements it controls; the only real overlap risk is the boundary between preserved user
positions and newly laid-out elements, which a bounded deterministic nudge handles without
another dependency or LLM call. Reuses the exact engine the toolbar's Auto-arrange uses, so
"final pass" and manual tidy-up agree.

**Alternatives considered**: always full re-layout — rejected (destroys user-arranged positions,
violating FR-012's preservation clause and 004's preserve-user-work guarantee); a second layout
engine or constraint solver for overlap guarantees — rejected (new dependency for a marginal
case; Principle I/YAGNI); LLM-driven positioning — rejected (nondeterministic, slow, and layout
is a solved deterministic problem here).

## D7 — Budget accounting: per-turn envelopes, no new budget machinery

**Decision**: Each phase turn keeps the existing envelope (`HARD_TIME_CAP_MS`, route
`maxDuration = 120`). Expected shapes: analyze turn = 1 LLM call (seconds); build turn =
unchanged 004/005 loop; cost turn = 1 LLM call + deterministic pricing; apply+finalize turn =
0 LLM calls (writes + ELK). No cross-turn budget is tracked — SC-008 is per active phase, and
user think-time sits between turns by construction (D1).

**Rationale**: Matches the constitution's "conversational ordering only — budgets unchanged"
clause; avoids inventing a cross-phase budget model the spec doesn't require.

**Alternatives considered**: a cumulative flow budget across phases — rejected; punishes users
for thinking and contradicts FR-015.

## D8 — Free-text answers while a round is open: interpret, then route

**Decision**: If the user types free text while `flow.awaiting` is set (instead of using the
option UI), the next turn first runs a small structured interpretation step: map the text onto
the open questions (answers), detect skip intent ("just build it" ⇒ skip-all with defaults), or
detect a material request change ⇒ supersede the open round (mark `superseded`), re-run analyze
on the amended request, and issue a fresh round (spec edge case). Structured
`interactionResponse` payloads skip interpretation entirely and are validated by ID against the
stored open round.

**Rationale**: Users will type — the chat composer stays enabled (the thread is a chat, not a
form). ID-validated structured answers stay the fast path; interpretation is the tolerant
fallback, and "supersede + re-analyze" prevents building on stale analysis (FR guidance from
spec edge cases).

**Alternatives considered**: disable the composer while a round is open — rejected (hostile UX,
blocks the "restate my request" escape hatch); treat any free text as skip-all — rejected
(silently discards real answers).

## D9 — First-generation surface (project creation) joins the guided flow

**Decision**: The creation flow (`POST /api/chat/start` → first streamed turn) participates
fully: the first turn is an analyze turn, and the user lands in the studio with the open
clarification round rendered from the thread (message `interaction` + `flow.awaiting` returned
by GET chat). No canvas content exists until the round resolves — consistent with FR-005 and
with feature 004's decision that every surface shows the same turn behavior (no surface is
exempt).

**Rationale**: Spec SC-001 says 100% of new-architecture turns analyze-then-clarify; the
creation page is the canonical new-architecture surface. Reusing thread-state rendering means
zero bespoke creation-page protocol.

**Alternatives considered**: keep creation page on the legacy immediate build — rejected
(violates SC-001 and splits the product into two contradictory generation behaviors).

## D10 — Trace and persistence of the new phases

**Decision**: New `StepKind` values `analyze`, `options`, `finalize` (additive union extension,
same pattern as 005's `chunk` addition). Each phase turn persists its own `GenerationRun` with a
new optional `flowPhase` field (`'analyze' | 'build' | 'cost' | 'finalize'`) so the persisted
trace history shows the guided sequence across turns; message summaries (`runId`, `stepCount`,
…) unchanged. The question/answer record itself lives on messages (`interaction` + the user's
response message), satisfying FR-006's "recorded in the conversation thread" directly.

**Rationale**: Follows the 004 separation (trace weight in `GenerationRun`, summary on the
message) and keeps every phase turn's working visible under the existing WorkingTrace UI with
minimal schema growth.

**Alternatives considered**: one cross-turn GenerationRun per guided flow — rejected (breaks the
one-run-per-turn invariant the stop/persist paths rely on; resume across turns would need run
mutation, complicating the immutable-trace model).
