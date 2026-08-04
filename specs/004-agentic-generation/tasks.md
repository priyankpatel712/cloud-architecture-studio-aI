# Tasks: Agentic Architecture Generation with Live Working Trace

**Input**: Design documents from `/specs/004-agentic-generation/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/agentic-generation.md](./contracts/agentic-generation.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The plan explicitly requests vitest unit tests (loop controller, verdict gating, trace assembly, sanitizers) and the quickstart gates run `npm test`; the 001/002/003 suites are the SC-005 regression gate.

**Organization**: Tasks are grouped by user story (US1→US3, priority order) so each story is an independently testable increment. This feature **amends the existing 001/003 generation flow** — most tasks refactor/extend existing files rather than create from scratch.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish carry no story label)
- All paths are repository-relative; the app lives under `app/`.

## Path Conventions

Existing Next.js single project. Source under `app/src/`, tests under `app/tests/`. Key touch-points (from plan.md Structure):
- `app/src/lib/generate/` — loop, reviewer, orchestrator, validation, trace emitter
- `app/src/lib/models/` — `AIConversation.ts` (extend), `GenerationRun.ts` (new)
- `app/src/app/api/projects/[id]/chat/` — `messages/`, `runs/[runId]/` (new), `stop/` (new), `route.ts` (thread GET)
- `app/src/components/studio/ChatPanel.tsx` + `WorkingTrace.tsx` (new)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration prerequisites for the agentic loop. No new runtime dependencies (research R1).

- [x] T001 [P] Add loop configuration constants (iteration budget = 3, hard time cap = 120s, per-iteration abort threshold = 25s remaining) in `app/src/lib/generate/loop-config.ts`, tunable via env with these defaults (spec Assumptions; research R2).
- [x] T002 Raise the route `maxDuration` from 60s to 120s in `app/src/app/api/projects/[id]/chat/messages/route.ts` (SC-004; constitution v1.2.0 performance envelope).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data model + shared step/trace machinery that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Create the `GenerationRun` Mongoose model in `app/src/lib/models/GenerationRun.ts` per [data-model.md](./data-model.md): `conversationId`, `projectId`, `ownerId`, `iterations`, `converged`, `stopped`, `terminalStatus` (`converged|best_effort|failed|stopped`), `startedAt`/`endedAt`, and `steps: TraceStep[]` (embedded subdocument: `id`, `kind`, `label`, `detail?`, `iteration`, `status`, `startedAt`/`endedAt`).
- [x] T004 [P] Extend `app/src/lib/models/AIConversation.ts`: add `stopRequested: boolean` (default false) to the conversation schema, and add `runId: ObjectId`, `iterations`, `converged`, `stopped`, `stepCount` to `messageSchema` (assistant-message run summary — data-model.md). Do NOT add an embedded `trace[]`.
- [x] T005 Implement the shared v2 trace emitter in `app/src/lib/generate/trace-emitter.ts`: typed step events (`kind` ∈ `understand|lookup|draft|review|refine|layout|price|validate|persist|cost`, 1-based `iteration`, optional ≤300-char `detail`, `status` running→done/failed), a guarded write that guarantees a terminal status even on client disconnect, and in-memory accumulation of completed steps for one-shot `GenerationRun` assembly at turn end (contract §1; research R4; single-source-of-truth rule from data-model.md).

**Checkpoint**: Model + emitter ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Iterative self-refining generation (Priority: P1) 🎯 MVP

**Goal**: Replace the single-shot call with a multi-phase loop (understand → gather → draft → self-review → refine, ≤3 iterations) that yields architectures covering every requested capability, terminating on convergence or budget.

**Independent Test**: Send "fintech API with WAF, user auth, encryption, multi-region DR" to a fresh project; verify the returned architecture contains a service for every named capability, correctly connected, and the NDJSON stream shows ≥1 review/refine pass (quickstart Scenario 1).

### Tests for User Story 1

- [x] T006 [P] [US1] Unit tests for the loop controller in `app/tests/agent-loop.test.ts`: iteration-budget cap (stops at 3), early-exit on first passing verdict, review→refine feeds unmet capabilities forward, best-effort return when budget exhausts.
- [x] T007 [P] [US1] Unit tests for `sanitizeVerdict()` in `app/tests/reviewer.test.ts`: non-boolean `pass` → false, non-string `unmetCapabilities` entries dropped, `refinementInstructions` truncated (data-model.md ReviewVerdict rules).

### Implementation for User Story 1

- [x] T008 [US1] Refactor `app/src/lib/generate/orchestrator.ts` so gather / plan+apply / layout / price become individually loop-invocable functions returning structured results, preserving `sanitizePlan` and all 003 behavior (FR-007).
- [x] T009 [P] [US1] Implement the structural validation gate `validateArchitecture()` in `app/src/lib/generate/validate.ts`: every edge endpoint resolves to a node, container parents acyclic and existing, every node priced (cost ≥ 0 present); returns named gaps to feed the reviewer (FR-010; research R6).
- [x] T010 [P] [US1] Implement the self-review call + `sanitizeVerdict()` in `app/src/lib/generate/reviewer.ts`: evaluate the applied, priced draft against (a) each requested capability, (b) gathered MCP guidance, (c) preserve-user-work; return `{pass, unmetCapabilities[], refinementInstructions}` (FR-002; research R2).
- [x] T011 [US1] Implement the agent loop controller in `app/src/lib/generate/agent-loop.ts`: run the backbone via the T008 orchestrator functions emitting steps through the T005 emitter, then the evaluator-optimizer iterate (≤3) using T010's verdict and T009's gaps, with a per-iteration wall-clock guard (abort refinement — not the turn — when < the T001 threshold remains), early-exit on pass, and best-effort return naming unmet capabilities (FR-001, FR-003, FR-004). Depends on T005, T008, T009, T010.
- [x] T012 [US1] Add understand-phase change-scope extraction and preserve-user-work enforcement in `app/src/lib/generate/agent-loop.ts`: the reviewer/refine may only touch in-scope nodeIds; a diff assertion (`summarizeArchitectureEdit`) that untouched nodes changed fails the iteration instead of persisting it (FR-011; research R7; spec edge case). Depends on T011.
- [x] T013 [US1] Wire the loop into `app/src/app/api/projects/[id]/chat/messages/route.ts`: run `agent-loop` per turn, stream v2 step events, and persist the architecture only at the existing single persist point; reuse the existing 409 + stale-lock one-generation-at-a-time guard (FR-007). Depends on T011.
- [x] T014 [US1] Ensure knowledge-source failure degrades to clearly-labelled indicative mode with a failed `lookup` step emitted and the loop continuing, in `app/src/lib/generate/agent-loop.ts` / `orchestrator.ts` (FR-008; spec edge case). Depends on T011.

**Checkpoint**: US1 is independently testable via the NDJSON stream (quickstart Scenario 1) — the loop refines and terminates. Live UI and stop are not yet present.

---

## Phase 4: User Story 2 - Live working trace in the chat (Priority: P2)

**Goal**: Show every loop step live in the chat (grouped by iteration, running/done/failed), persist the full trace separately, and let any viewer expand it later on demand — all within the accessibility floor.

**Independent Test**: Run a generation and watch ChatPanel — steps appear live (≤1s) grouped by iteration; reload the project and expand "Show working…" to fetch and view the full trace; a shared read-only user sees it too (quickstart Scenarios 2 & 7).

### Tests for User Story 2

- [x] T015 [P] [US2] Unit test for run assembly in `app/tests/trace-emitter.test.ts`: the single emitter's accumulated steps equal the persisted `GenerationRun.steps`, and the message summary (`stepCount`/`iterations`/`converged`) matches, across success / best-effort / failure paths.

### Implementation for User Story 2

- [x] T016 [US2] At every turn-end path in `app/src/app/api/projects/[id]/chat/messages/route.ts`, write one `GenerationRun` document (from the T005 accumulator) and set the assistant message's `runId` + summary fields; the terminal `result` payload carries the summary only, not the full trace (FR-006; contract §1, §2). Depends on T003, T004, T005, T013.
- [x] T017 [P] [US2] Add `GET /api/projects/[id]/chat/runs/[runId]/route.ts` returning the run's full `steps` (+ run summary), gated by project read access (any viewer), `404` when the `runId` does not belong to a run under this project (FR-006, SC-003; contract §4).
- [x] T018 [P] [US2] Extend the thread GET in `app/src/app/api/projects/[id]/chat/route.ts` to include each assistant message's `runId`, `iterations`, `converged`, `stopped`, `stepCount` (never the full trace) in the mapped response (contract §3).
- [x] T019 [P] [US2] Create `app/src/components/studio/WorkingTrace.tsx` rendering steps grouped by iteration (spinner/✓/✕ + `detail` secondary text, "Iteration N" divider for ≥2), implementing the a11y floor: no animation under `prefers-reduced-motion` (instant state changes), keyboard-focusable expand/collapse with visible focus (Enter/Space), and a polite `aria-live` region announcing phase/iteration boundaries, step failures, and turn completion — not every step; region scrolls within the chat at mobile widths (FR-005, FR-012, SC-007).
- [x] T020 [US2] Integrate `WorkingTrace` into `app/src/components/studio/ChatPanel.tsx`: render live steps during `sending`; for past assistant messages with a `runId`, show a collapsed "Show working (N steps, M iterations)" toggle (label from `stepCount`/`iterations`, no fetch) that issues `GET …/chat/runs/{runId}` on expand and renders the returned steps (contract §5). Depends on T017, T018, T019.
- [x] T021 [US2] Render the live working trace on the creation page `app/src/app/(dashboard)/projects/new/page.tsx` by mounting the shared `WorkingTrace` component for the first generation's stream, so every turn shows its trace (SC-002; Clarification 2026-07-09). Depends on T019.

**Checkpoint**: US1 + US2 both work — the loop runs and its working trace is live, persisted, on-demand, and accessible.

---

## Phase 5: User Story 3 - Bounded, controllable loops (Priority: P3)

**Goal**: Make loops safe to run and stop — graceful best-effort labeling at budget exhaustion, and a user-initiated stop that leaves the project unlocked and immediately retryable.

**Independent Test**: Send a contradictory prompt → loop stops at the 3-iteration cap, returns a best-effort result explicitly naming unmet capabilities, thread stays usable; separately, click Stop mid-run → run halts, project unlocked, immediate retry succeeds (quickstart Scenarios 3 & 4).

### Tests for User Story 3

- [x] T022 [P] [US3] Unit tests for stop handling in `app/tests/agent-loop.test.ts` (extend): `stopRequested` honored at the next phase boundary, in-flight fetch aborted, nothing persisted beyond the last completed phase, status reset to `idle` and flag cleared.

### Implementation for User Story 3

- [x] T023 [P] [US3] Implement `POST /api/projects/[id]/chat/stop/route.ts` (owner-gated, same guard as messages POST): `202 {"stopping":true}` when generating, `409` otherwise; sets `conversation.stopRequested` (FR-009; contract §2).
- [x] T024 [US3] Add stop enforcement in `app/src/lib/generate/agent-loop.ts`: read `stopRequested` at each phase boundary (fast Mongo read), abort in-flight LLM fetches via `AbortController`, emit the `stopped` terminal event, persist the partial run + a "stopped" assistant message referencing it, reset status `idle`, clear the flag (FR-009; research R5). Depends on T011, T023.
- [x] T025 [US3] Emit the best-effort/graceful-degrade terminal as a `result` (not `error`) with `converged:false` and reply text naming unmet capabilities, in `app/src/app/api/projects/[id]/chat/messages/route.ts` (FR-004; US3/AC1; contract §2). Depends on T013, T016.
- [x] T026 [US3] Add the Stop control to `app/src/components/studio/ChatPanel.tsx`: visible while `sending`, POSTs `/stop`, disables on click, awaits the terminal stream event, and re-enables input immediately for retry (FR-009, SC-006; contract §5). Depends on T020, T023.

**Checkpoint**: All three user stories are independently functional; loops are bounded and controllable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regression safety, gates, and end-to-end validation.

- [x] T027 [P] Run the full 001/002/003 regression suites (`cd app; npm test`) and confirm zero regressions (SC-005): cost override via chat, inline override + reset, attach-dedup, MCP-failure degradation (quickstart Scenario 5).
- [x] T028 [P] Run the build gates: `cd app; npx tsc --noEmit; npm run lint; npm run build` (constitution Principle V; must pass compile + TypeScript + prerender).
- [x] T029 Execute all quickstart scenarios end-to-end (Scenarios 1–7: refinement, live+persist, budget exhaustion, stop, regression, edit scoping, accessibility) and record outcomes in the PR description.
- [x] T030 [P] Accessibility audit of `WorkingTrace.tsx` / `ChatPanel.tsx` against SC-007: reduced-motion produces zero step animations, all trace controls keyboard-reachable with visible focus, aria-live limited to boundaries/failures/completion, trace scrolls within chat at mobile width.
- [x] T031 Update the spec Status to reflect delivery and cross-link the run artifacts; verify no [NEEDS CLARIFICATION] remains.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phase 3–5)**: all depend on Foundational. US1 is the MVP; US2 depends on US1's loop + emitter wiring (T013) for real steps to render/persist; US3's stop (T024) depends on US1's loop (T011) and its own endpoint (T023).
- **Polish (Phase 6)**: depends on the desired stories being complete.

### Story Dependencies

- **US1 (P1)**: independent — testable via the NDJSON stream alone.
- **US2 (P2)**: builds on US1 (needs emitted steps + persisted run). Independently testable once US1 exists.
- **US3 (P3)**: stop endpoint (T023) is independent; loop enforcement (T024) needs US1; the Stop button (T026) needs US2's ChatPanel integration.

### Within Each Story

- Tests before implementation where practical (T006/T007 before T011; T015 before T016; T022 before T024).
- Models/helpers before consumers: T008/T009/T010 before T011; T003/T004/T005 before persistence (T016).
- Endpoints before the UI that calls them: T017/T018 before T020; T023 before T026.

### Parallel Opportunities

- **Setup**: T001 ∥ T002 (different files).
- **Foundational**: T003 ∥ T004 (different model files); T005 after (uses the step types).
- **US1**: T006 ∥ T007 (tests); T009 ∥ T010 (different new files) can run alongside T008; T011 joins them.
- **US2**: T017 ∥ T018 ∥ T019 (endpoint, thread route, component — different files); T020 integrates them.
- **US3**: T022 ∥ T023; then T024/T025/T026.
- **Polish**: T027 ∥ T028 ∥ T030.

---

## Parallel Example: User Story 1

```bash
# Tests first (different files):
Task: "Unit tests for the loop controller in app/tests/agent-loop.test.ts"       # T006
Task: "Unit tests for sanitizeVerdict() in app/tests/reviewer.test.ts"           # T007

# Independent new modules in parallel, alongside the orchestrator refactor:
Task: "Implement validateArchitecture() in app/src/lib/generate/validate.ts"     # T009
Task: "Implement reviewer + sanitizeVerdict in app/src/lib/generate/reviewer.ts" # T010
# Then T011 composes T008/T009/T010 into the loop controller.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (model + emitter).
2. Phase 3 US1 — the agentic loop.
3. **STOP and VALIDATE**: quickstart Scenario 1 via the stream (multi-capability prompt → refined, terminating architecture). This alone delivers the core value (SC-001).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate via stream → the quality win ships (MVP).
3. US2 → live/persisted/accessible trace → the transparency UX ships.
4. US3 → bounded + stoppable → the safety rails ship.
5. Polish → regression gate (SC-005), build gates, full quickstart.

### Parallel Team Strategy

After Foundational: one developer takes US1 (critical path); once T013 lands, a second can start US2 (UI + persistence) and a third US3's stop endpoint (T023) in parallel, converging on ChatPanel for T020/T026.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` labels map tasks to spec user stories for traceability; Setup/Foundational/Polish carry none.
- Tests are included per the plan's vitest scope; the 001/002/003 suites are the SC-005 regression gate (T027).
- Persist the trace **separately** (`GenerationRun`), never embedded in the thread read — Clarification Q3 / FR-006.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
