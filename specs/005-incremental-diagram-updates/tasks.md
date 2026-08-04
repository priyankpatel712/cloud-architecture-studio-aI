# Tasks: Incremental Diagram Build-Up During Generation

**Input**: Design documents from `/specs/005-incremental-diagram-updates/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/incremental-generation.md](./contracts/incremental-generation.md), [quickstart.md](./quickstart.md)

**Tests**: Included, following this codebase's established convention (every `lib/generate/*` module has a paired vitest suite) and constitution Principle V ("Verify Before Done"). Not explicitly requested by the spec, but consistent with prior features (001–004).

**Organization**: Tasks are grouped by user story (US1→US3, priority order). This feature **extends the existing 004 agentic loop** — most tasks modify existing files rather than create from scratch. US1 (P1) is deliberately deliverable with **zero change to LLM call count** (pure code-side slicing of one existing plan response) so it ships as a self-contained MVP; US2 (P2) then upgrades the mechanism to genuine multi-round chunked planning, reusing US1's slicing logic as its defensive backstop.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish carry no story label)
- All paths are repository-relative; the app lives under `app/`.

## Path Conventions

Existing Next.js single project. Source under `app/src/`, tests under `app/tests/`. Key touch-points (from plan.md Structure):
- `app/src/lib/generate/` — `orchestrator.ts`, `agent-loop.ts`, `loop-config.ts`, `trace-emitter.ts` (all extend existing 004 files)
- `app/src/lib/models/GenerationRun.ts` (extend — additive field)
- `app/src/app/api/projects/[id]/chat/messages/route.ts` (extend — forward new stream event)
- `app/src/components/studio/ChatPanel.tsx`, `WorkingTrace.tsx`, `app/src/app/(dashboard)/projects/new/page.tsx` (extend)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration prerequisites for chunking. No new runtime dependencies.

- [X] T001 [P] Add `CHUNK_SIZE` (max new services/containers per chunk), `CHUNK_RENDER_DELAY_MS` (pause between rendering slice-groups from one response), and `CHUNK_PLAN_DELAY_MS` (pause between separate chunk-planning LLM calls) constants to `app/src/lib/generate/loop-config.ts`, tunable via env using the existing `intEnv()` pattern, with defaults chosen per research.md §§2-3 (FR-008).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared schema/transport plumbing that MUST be complete before either user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add an optional `chunk: Number` field to `traceStepSchema` in `app/src/lib/models/GenerationRun.ts` (data-model.md — additive, no migration).
- [X] T003 [P] Add `moreNeeded: boolean` (required) and `chunkLabel: string` (optional) fields to `PLAN_SCHEMA` in `app/src/lib/generate/orchestrator.ts`, and update `sanitizePlan()` to coerce/default them (`moreNeeded` defaults `false` if missing/non-boolean; `chunkLabel` dropped if non-string) — research.md §5; contracts/incremental-generation.md.
- [X] T004 [P] Extend `TraceEmitter` in `app/src/lib/generate/trace-emitter.ts`: `step()` gains an optional `chunk?: number` parameter forwarded into the emitted step event; add a `diagram(nodes, edges, containers, iteration, chunk)` method emitting `{type:'diagram', nodes, edges, containers, iteration, chunk}` (contracts/incremental-generation.md §1).
- [X] T005 Wire `app/src/app/api/projects/[id]/chat/messages/route.ts` to forward `emitter.diagram()` emissions straight into the NDJSON response stream, the same additive passthrough already used for step events. Depends on T004.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Watch the architecture build up piece by piece (Priority: P1) 🎯 MVP

**Goal**: A single plan response's new services/containers are applied and streamed to the canvas in small groups, each rendered before the next — no change yet to how many LLM calls a turn makes.

**Independent Test**: Send a 5+ service prompt; verify at least 3 `diagram` events with strictly growing node counts arrive before the terminal `result`, and every edge in a `diagram` event resolves to a node present in that same event.

### Tests for User Story 1 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T006 [P] [US1] Unit tests for the slicing backstop in `app/tests/chunking.test.ts`: a plan with 6 new services + edges among them splits into ordered groups of at most `CHUNK_SIZE`; an edge referencing a node only present in a later group is deferred to that group (never included early); a plan with ≤ `CHUNK_SIZE` adds produces exactly one group; a plan with only `update`/`remove` (no `add`) produces exactly one group carrying all of them.

### Implementation for User Story 1

- [X] T007 [US1] Implement `sliceIntoChunks(plan, currentState)` in `app/src/lib/generate/orchestrator.ts`: groups `plan.add` (with their dependent `edges`, `containers.add`, `containers.assignMembers`) into ordered batches of at most `CHUNK_SIZE`, reusing/adapting the existing `decideAdds`/`resolveRef` index-resolution so a group never references a not-yet-applied index (research.md §2); non-add operations (`update`, `remove`, container ops with no new-index dependency) attach to the first group. Depends on T001.
- [X] T008 [US1] In `draftAndApply()` (`app/src/lib/generate/orchestrator.ts`), after the plan is fetched and sanitized, run it through `sliceIntoChunks()` and apply each group to the working state in order, calling `emitter.step()` (with the group's 1-based index as `chunk`) and `emitter.diagram()` after each group, awaiting `CHUNK_RENDER_DELAY_MS` between groups. Depends on T004, T005, T007.
- [X] T009 [US1] Update `WorkingTrace.tsx` (`app/src/components/studio/WorkingTrace.tsx`) to show a `chunk` field on a `kind:'draft'` step in its label (e.g. "part 2") when present, unchanged when absent. Depends on T004.
- [X] T010 [P] [US1] Update `ChatPanel.tsx` (`app/src/components/studio/ChatPanel.tsx`) to handle the new `diagram` stream event: apply its `nodes`/`edges`/`containers` to the live canvas immediately via the same architecture-apply path already used for the terminal `result` event. Depends on T005.
- [X] T011 [P] [US1] Update the creation page `app/src/app/(dashboard)/projects/new/page.tsx` with the same `diagram` event handling as T010, so the first generation also shows progressive build-up (mirrors feature 004's "every streaming surface" guarantee). Depends on T005.

**Checkpoint**: User Story 1 is fully functional and independently testable — a multi-service generation visibly builds up on the canvas piece by piece, with zero change to LLM call count.

---

## Phase 4: User Story 2 - Smaller, paced AI planning steps (Priority: P2)

**Goal**: Replace "one call then slice" with genuine multi-round chunk planning — each round's LLM call plans only the next portion, aware of everything applied by prior rounds, terminating via `moreNeeded`, paced by `CHUNK_PLAN_DELAY_MS` between rounds.

**Independent Test**: Send a request needing more than `CHUNK_SIZE` services; verify the trace shows multiple separate `draft` LLM calls (not one), each round's context includes what prior rounds applied, and the loop terminates on `moreNeeded:false`. Send a 1-2 service request; verify it terminates after exactly one round.

### Tests for User Story 2 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T012 [P] [US2] Unit tests for the chunk-round loop in `app/tests/agent-loop.test.ts` (extended): mock a sequence of `llmJson` responses (`moreNeeded:true` then `moreNeeded:false`); assert the second round's prompt/context reflects everything the first round applied; assert the loop stops on `moreNeeded:false`; assert a total-rounds safety cap is enforced even if the model never sets `moreNeeded:false`; assert a single response with `moreNeeded:false` produces exactly one round with no added delay wait.

### Implementation for User Story 2

- [X] T013 [US2] Add the chunked-planning instruction to `draftAndApply()`'s system prompt in `app/src/lib/generate/orchestrator.ts`: plan at most `CHUNK_SIZE` new services/containers this round; set `moreNeeded` accordingly; optionally set `chunkLabel`; the model will be called again with the updated architecture if more is needed (research.md §1). Depends on T003.
- [X] T014 [US2] Extract a `planOneChunk(input, roundState)` primitive from `draftAndApply()`'s current single-call body in `app/src/lib/generate/orchestrator.ts`: one LLM call + `sanitizePlan` + `sliceIntoChunks`-backed apply-in-place (T007 stays the defensive backstop for an oversized individual round) + step/diagram emission for that round; returns the updated state plus the round's `moreNeeded`. Depends on T007, T008, T013.
- [X] T015 [US2] In `agent-loop.ts`'s draft phase, replace the single `draftAndApply()` call with a loop over `planOneChunk()`: pass the accumulated state into each subsequent round (FR-004); stop when a round returns `moreNeeded:false` or a total-rounds safety cap is reached; await `CHUNK_PLAN_DELAY_MS` between rounds; continue to honor the existing `isStopRequested()`/`timeRemaining()` checks between rounds (FR-006/FR-007). Depends on T014.
- [X] T016 [US2] Ensure a chunk-round failure (`LlmError`/`LlmAbortError` from any round after the first) preserves every prior round's applied state and surfaces the same way an iteration failure does today — never rolling back already-applied chunks (FR-010) — in `app/src/lib/generate/agent-loop.ts`. Depends on T015.

**Checkpoint**: User Stories 1 AND 2 both work — the canvas builds up progressively AND the underlying planning happens as multiple smaller, paced AI calls instead of one large one.

---

## Phase 5: User Story 3 - Existing trust and transparency guarantees carry over (Priority: P3)

**Goal**: Verify every feature-004 guarantee — accessibility floor, preserve-user-work, cost/persist correctness, stop control — holds unchanged with chunked generation.

**Independent Test**: Re-run feature 004's existing quickstart scenarios (trace, a11y, stop, cost/attach-dedup/MCP-degradation, edit scoping) against the chunked flow; all must pass unmodified.

- [X] T017 [P] [US3] Verify `WorkingTrace.tsx`'s existing `aria-live` announcement policy (iteration-boundary/failure/completion only) does not fire an extra announcement per chunk/round; add a regression assertion (new or extended test near `app/tests/trace-emitter.test.ts`) confirming a multi-chunk iteration produces the same announcement count as a single-chunk one. Depends on T009.
- [X] T018 [US3] Verify `protectedViolations()` (preserve-user-work, `app/src/lib/generate/agent-loop.ts`) runs against the fully-assembled iteration result after all of that iteration's chunks/rounds are applied, not per chunk; adjust/add a test in `app/tests/agent-loop.test.ts` covering a multi-chunk iteration. Depends on T015.
- [X] T019 [US3] Verify `priceArchitecture()` and `validateArchitecture()` still run exactly once per iteration, after all chunks/rounds of that iteration are applied — not once per chunk; cover with an assertion in `app/tests/agent-loop.test.ts`. Depends on T015.
- [X] T020 [US3] Re-run feature 004's quickstart Scenarios 2, 3, 5, 6, 7 (`specs/004-agentic-generation/quickstart.md`) end-to-end against the chunked flow on a live dev server and confirm each still passes; record results in this feature's [quickstart.md](./quickstart.md) Scenario 6.

**Checkpoint**: All user stories independently functional; no feature-004 regression.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T021 Run `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build` in `app/` (constitution Principle V gate); fix any issue surfaced by the new chunking code.
- [X] T022 Run this feature's [quickstart.md](./quickstart.md) Scenarios 1-5 end-to-end against a live dev server with a real (or, where noted, mocked) LLM provider, and record actual results.
- [X] T023 Update [spec.md](./spec.md)'s Status line to "Implemented" once every task above is checked off, per the convention set by feature 004.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001) completion — BLOCKS both user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2). No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) **and** on User Story 1's `sliceIntoChunks`/apply-and-emit machinery (T007, T008) — it reuses that logic as its per-round backstop rather than duplicating it. Cannot be built independently of US1's implementation, though it is independently *testable* once built (its Independent Test does not require US1's UI tasks T009-T011).
- **User Story 3 (Phase 5)**: Depends on User Story 2 (verifies the fully-chunked loop's non-regression).
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests written and failing before implementation (T006 before T007; T012 before T013).
- Backstop/model layer before route/UI wiring (T007→T008; T008→T009/T010/T011).
- Prompt/schema changes before the loop that depends on them (T013→T014→T015→T016).

### Parallel Opportunities

- Phase 2: T002, T003, T004 touch different files and have no dependency on each other — run in parallel; T005 follows T004.
- Phase 3: T010 and T011 touch different files (`ChatPanel.tsx` vs. `projects/new/page.tsx`) and share the same single dependency (T005) — run in parallel.
- T006 (US1 tests) and T012 (US2 tests) touch different files and can be drafted in parallel, though T012 cannot be *implemented against* until T007/T008 land (US2 depends on US1's mechanism).

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all foundational schema/emitter tasks together:
Task: "Add optional chunk field to traceStepSchema in app/src/lib/models/GenerationRun.ts"
Task: "Add moreNeeded/chunkLabel to PLAN_SCHEMA + sanitizePlan in app/src/lib/generate/orchestrator.ts"
Task: "Extend TraceEmitter with chunk param + diagram() in app/src/lib/generate/trace-emitter.ts"
```

## Parallel Example: User Story 1 UI wiring

```bash
# Once T005 (route forwards diagram events) is done:
Task: "Handle diagram stream event in ChatPanel.tsx"
Task: "Handle diagram stream event in projects/new/page.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks both stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart.md Scenario 1 — confirm progressive canvas build-up with zero change to LLM call count.
5. Ship — this alone delivers the visible value the feature was requested for.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add User Story 1 → validate independently → ship (MVP: progressive reveal, same request count as today).
3. Add User Story 2 → validate independently → ship (adds: genuinely paced, smaller AI calls — the rate-limit mitigation).
4. Add User Story 3 → validate independently → ship (confirms zero regression to feature 004's guarantees).
5. Polish.

---

## Notes

- [P] tasks = different files, no unfinished dependency.
- [Story] label maps task to specific user story for traceability.
- US2 depends on US1's implementation (not just its foundation) — this is a deliberate, documented exception to "stories should be independent," because US2 is specifically an upgrade to US1's mechanism (research.md §1: slicing is kept as the defensive backstop under genuine chunked planning), not a separate feature area.
- Commit after each task or logical group.
- Stop at either checkpoint (end of Phase 3, end of Phase 4) to validate and ship independently.
- Avoid: vague tasks, same-file conflicts marked [P], cross-story dependencies beyond the documented US2→US1 exception above.
