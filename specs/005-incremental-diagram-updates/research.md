# Research: Incremental Diagram Build-Up During Generation

## 1. Chunking mechanism

**Decision**: Extend the existing single "draft" LLM call (`draftAndApply` in `orchestrator.ts`) into a small uniform loop: call it repeatedly within one iteration, each call planning only the next portion of the request (capped at `CHUNK_SIZE` new services/containers) against the architecture as it stands *after* every previously-applied chunk. Each call's response carries a `moreNeeded: boolean` — the loop stops when `false` (or a safety cap of chunks is reached).

**Rationale**: This is what the feature actually asks for — the AI's own planning process proceeds step-by-step, not just the rendering of an already-complete plan. It requires no new endpoint, no new schema type, and reuses `architecturePrompt(state...)` unchanged (later chunks already see everything applied so far — FR-004 falls out for free). A request needing only 1-2 services naturally sets `moreNeeded: false` on the first call, so small requests take exactly the same single call as today (FR-009).

**Alternatives considered**:
- *Pure code-side slicing of one already-complete plan response* (no extra LLM calls): simpler and strictly cheaper on request count, but the AI's own planning still happens in one shot — it doesn't reduce a single call's size/latency, and large monolithic plan calls have been the actual source of provider slowness/timeouts observed in production (feature 004's NVIDIA congestion incidents). Rejected as the *primary* mechanism, but kept as a **defensive backstop** (see §2) in case a single chunk response still comes back oversized.
- *Separate "outline" call producing a fixed chunk manifest upfront, then per-chunk detail calls*: adds an extra LLM call purely for planning the plan, and locks in chunk boundaries that can't adapt if the model changes approach mid-way. Rejected — more complexity for no demonstrated benefit over the uniform loop.

**Rate-limit tradeoff, acknowledged**: splitting one turn's planning into N calls instead of 1 increases that turn's own request count. This is deliberately mitigated, not eliminated, by §3's inter-chunk pacing delay — full elimination of cross-turn burst risk would require a global request limiter shared across concurrent turns/users, which is out of scope for this feature (the spec's SC-002 is explicitly scoped to "normal provider conditions" for this reason).

## 2. Defensive code-side slicing (backstop)

**Decision**: If a single chunk response still contains more than `CHUNK_SIZE` new `add` entries despite the prompt instruction, split that response's `add`/associated `edges`/`containers.add` into groups of at most `CHUNK_SIZE` *before* applying, using the same index-resolution the plan-apply step already does for `new:<index>` references (`decideAdds`/`resolveRef` in `orchestrator.ts`). An edge or container-membership reference is placed in the earliest group where every node/container it depends on is already applied (either pre-existing or from an earlier group in this same slice); a reference to a not-yet-applied index in a later group is deferred to that group. Each group is applied and rendered before the next group is processed — no additional LLM call is needed for this.

**Rationale**: Guarantees the visible-incremental-build requirement (FR-001/002/003, SC-001) holds deterministically even if the model doesn't fully comply with the "at most `CHUNK_SIZE` per round" instruction, mirroring the existing prompt-guidance-plus-code-level-backstop pattern already used for cost realism (`clampToFieldBounds` in `catalog.ts`, constitution v1.3.0).

## 3. Request pacing

**Decision**: Await a minimum delay (`CHUNK_DELAY_MS`) between successive chunk-planning LLM calls within the same turn, and between successive slice-groups' applied-and-rendered updates within a single response (a short UI-pacing delay, separate constant, so a big single-shot backstop-sliced response doesn't dump all its groups on the canvas in the same tick).

**Rationale**: Smooths out a turn's own request timing so it doesn't itself burst near a provider's per-minute cap, and gives the UI-visible reveal (P1) a perceptible step-by-step pace rather than everything appearing within the same animation frame. Both delays are env-configurable (FR-008), following the existing `loop-config.ts` pattern (`AGENT_ITERATION_BUDGET`, `AGENT_HARD_TIME_CAP_MS`, `AGENT_ABORT_THRESHOLD_MS`).

**Alternatives considered**: A global, cross-request token-bucket limiter shared across all concurrent turns on the server would more rigorously guarantee a provider-wide cap — rejected for this feature as a bigger, separate concern (multi-turn/multi-user concurrency control), not implied by the spec's single-turn-scoped requirements; noted as a possible future feature.

## 4. Live diagram transport

**Decision**: Reuse the existing NDJSON stream (`POST /api/projects/[id]/chat/messages`, feature 004 contract) — add one new additive event type, `diagram`, carrying a full architecture snapshot (`nodes`, `edges`, `containers`) after each applied chunk/group. No new endpoint.

**Rationale**: The stream, and the client's consumption loop (`ChatPanel.tsx`, `projects/new/page.tsx`), already exist; the terminal `result` event already carries a full architecture payload the client knows how to render onto the canvas. Emitting the same shape mid-stream and routing it through the same rendering path is the smallest change that satisfies "visible before the next chunk is planned" (FR-002) — no diffing/patching protocol is needed since a full snapshot is cheap at this scale (single-digit to low-double-digit nodes) and avoids an entire class of client-side merge bugs a delta protocol would risk.

**Alternatives considered**: A delta/patch event (`added`/`removed`/`updated` node-id lists) would be smaller over the wire, but architectures at this scale are small enough that the bandwidth savings are not worth the added client-side merge-state complexity and bug surface. Rejected.

## 5. Schema change

**Decision**: Add two fields to the existing `PLAN_SCHEMA` (`orchestrator.ts`):
- `moreNeeded: boolean` (required) — whether another chunk is needed after this one to fully satisfy the request.
- `chunkLabel: string` (optional) — a short human-readable summary of this chunk's contents (e.g. "Adding compute and networking"), used as the trace step's `detail` so multi-chunk iterations are distinguishable instead of all showing the generic "Designing the architecture plan" label.

**Rationale**: Minimal, additive schema extension; every other field (`add`, `remove`, `update`, `edges`, `containers`, `unsatisfiable`, `reply`) keeps its existing meaning and validation.

## 6. Persistence

**Decision**: Add an optional `chunk: Number` field to the `traceStepSchema` sub-document in `app/src/lib/models/GenerationRun.ts` — the 1-based chunk index within its iteration when a draft step was chunked; absent for non-chunked (single-chunk) steps.

**Rationale**: Additive, backward-compatible (existing documents simply lack the field); lets a persisted trace later distinguish "iteration 1, chunk 2 of 3" from a plain single-shot draft step, without introducing a new collection or step `kind`.
