# Tasks: Guided Diagram Generation Flow

**Input**: Design documents from `/specs/006-guided-generation-flow/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/guided-flow-protocol.md](./contracts/guided-flow-protocol.md), [quickstart.md](./quickstart.md)

**Tests**: Included — the plan's Testing context and quickstart Scenario 8 gate on the new Vitest suites (existing LLM-mocked pattern from `app/tests/agent-loop.test.ts`).

**Organization**: Tasks are grouped by user story so each story is an independently testable increment. All paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = analyze & clarify, US2 = cost dialogue, US3 = finalize pass, US4 = small-edit bypass

## Phase 1: Setup

**Purpose**: Configuration groundwork (existing app — no project init needed)

- [x] T001 Add guided-flow config knobs `QUESTION_LIMIT` (5), `COST_QUESTION_LIMIT` (3), `OPTION_COUNT` floor (2) via the existing `intEnv()` pattern in app/src/lib/generate/loop-config.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, shared types, protocol plumbing every story builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Extend `AIConversation`: optional `flow` subdocument (`awaiting`, `brief`, `openInteractionId`, `pricingOptions`, `selectedOptionId`, `updatedAt`) and optional message `interaction` subdocument per [data-model.md](./data-model.md) §1–2, all additive/optional so legacy docs stay valid, in app/src/lib/models/AIConversation.ts
- [x] T003 [P] Extend `StepKind` union with `'analyze' | 'options' | 'finalize'` in app/src/lib/generate/trace-emitter.ts
- [x] T004 [P] Add optional `flowPhase: 'analyze'|'build'|'cost'|'finalize'` to the `GenerationRun` schema and exported type in app/src/lib/models/GenerationRun.ts
- [x] T005 Create the guided-flow domain module: exported types (`RequirementBrief`, `Interaction`, `ValidationQuestion`, `PricingOption`), interaction lifecycle helpers (open/resolve/skip/supersede), and next-phase computation per [data-model.md](./data-model.md) §4, in app/src/lib/generate/flow.ts (depends on T002 types)
- [x] T006 Phase-router scaffold in the messages route: parse and validate `interactionResponse` pre-stream (409 closed/superseded round, 422 unknown questionId/optionId, 409 response-without-round per [contracts/guided-flow-protocol.md](./contracts/guided-flow-protocol.md) §1), routing table per contracts §2 with the legacy turn path preserved byte-compatible, in app/src/app/api/projects/[id]/chat/messages/route.ts (depends on T002, T005)
- [x] T007 [P] Return the `flow` summary and message `interaction` DTOs from the thread read route per contracts §4 in app/src/app/api/projects/[id]/chat/route.ts (depends on T002)
- [x] T008 [P] ChatPanel protocol plumbing: consume `result.payload.interaction`/`flow` fields, add a message-level interaction rendering slot, and an `interactionResponse` submit helper posting to the messages route, in app/src/components/studio/ChatPanel.tsx (depends on T002 DTO shapes)

**Checkpoint**: Schema + protocol in place; legacy turns still behave exactly as today

---

## Phase 3: User Story 1 - Analyze and clarify before anything is drawn (Priority: P1) 🎯 MVP

**Goal**: Every new/major request gets a visible analysis and a request-specific question round (with selectable service candidates); nothing is drawn until the round resolves; the build then honors every answer and selection.

**Independent Test**: Quickstart Scenarios 1–3 — ambiguous request yields analysis + ≤5 questions incl. a service choice with a Recommended badge, canvas untouched; answering (picking a non-recommended candidate) starts the live build containing that exact service; skip-all and fully-specified paths behave per spec.

### Implementation for User Story 1

- [x] T009 [US1] Create `ANALYZE_SCHEMA` + `analyzeRequest()` (capabilities, scale signals, constraints, gaps, `requestClass`, ≤`QUESTION_LIMIT` questions, candidate service sets) with `sanitizeAnalysis()` and catalog validation of candidates (resolve via `serviceById`/`resolveServiceDef`, drop unknowns, dedupe, require 2–4 candidates with exactly one `recommended`, collapse to confirmation below 2) per research D2–D4, in app/src/lib/generate/analyze.ts
- [x] T010 [US1] Clarify resolution in the flow module: merge structured answers into the `RequirementBrief`, skip-all → MVP-scale defaults with `defaultsApplied` disclosure (FR-004), free-text interpretation (map to answers / skip intent / material-change ⇒ supersede + re-analyze per research D8), and conflicting-answers detection raising ONE targeted follow-up question instead of a silent pick, in app/src/lib/generate/flow.ts (pure resolution/merge helpers; the LLM interpretation half lives in app/src/lib/generate/analyze.ts `interpretResponse`) (depends on T009)
- [x] T011 [P] [US1] Brief-fed loop: `runAgentLoop` accepts a `RequirementBrief` replacing the internal understand phase, and the reviewer gains a selected-services-present gate (FR-008), in app/src/lib/generate/agent-loop.ts and app/src/lib/generate/reviewer.ts
- [x] T012 [P] [US1] Planner prompt gains brief context: explicit selections become MUSTs, defaulted assumptions restated, in app/src/lib/generate/orchestrator.ts
- [x] T013 [US1] Wire the analyze and build turns in the messages route: analyze turn emits the analysis reply + open `clarify` interaction, sets `flow.awaiting='clarify'`, performs zero `diagram` events and zero architecture persistence (FR-005); no-questions case continues into the build in the same stream (spec US1-S5); supersede path re-analyzes; each turn persists its `GenerationRun` with `flowPhase`, in app/src/app/api/projects/[id]/chat/messages/route.ts (depends on T009–T012)
- [x] T014 [US1] Build `QuestionRoundCard` in ChatPanel: text / single_select / service_choice rendering with Recommended badge and trade-off detail, per-question Skip, round-level "Use defaults & build" (skipAll), read-only resolved state showing recorded answers, one polite live-region announcement on arrival, keyboard-operable with visible focus and reduced-motion safety per contracts §5, in app/src/components/studio/ChatPanel.tsx (depends on T008)
- [x] T015 [P] [US1] Add display labels for the `analyze` step kind in app/src/components/studio/WorkingTrace.tsx
- [x] T016 [US1] First-generation surface joins the guided flow (research D9): the creation flow's first turn is an analyze turn and the user lands in the studio with the open round rendered from thread state, in app/src/app/(dashboard)/projects/new/page.tsx and app/src/app/(dashboard)/studio/page.tsx (depends on T013, T014)
- [x] T017 [P] [US1] Unit tests: analyze sanitizer, candidate catalog-validation (unknown/dupe/collapse), classifier defaults on failure, in app/tests/analyze.test.ts
- [x] T018 [P] [US1] Unit tests: state transitions per data-model §4, answer resolution, skip-all defaults disclosure, supersede, free-text interpretation routing, in app/tests/flow.test.ts
- [x] T019 [P] [US1] Extend loop tests: brief-fed loop plans every confirmed capability and every explicit selection (FR-008), in app/tests/agent-loop.test.ts

**Checkpoint**: Quickstart Scenarios 1–3 pass — guided clarify-then-build works end to end (MVP)

---

## Phase 4: User Story 2 - Cost dialogue with budget and best-practice options (Priority: P2)

**Goal**: After the draft builds, the assistant asks ≤3 applicable cost questions, then presents engine-priced **cheapest** and **best-practice** config variants; selecting one applies it; switching later re-applies without regeneration.

**Independent Test**: Quickstart Scenario 4 — complete a build, answer/skip cost questions, see two itemized options, select cheapest (configs + estimate update, structure unchanged), then "switch to best practice" re-applies from stored options in a fast turn with no draft steps.

### Implementation for User Story 2

- [x] T020 [US2] Create the cost-options module: applicable cost-question generation (≤`COST_QUESTION_LIMIT`), `OPTIONS_SCHEMA` planning both variants as per-node config patches (never structural), `clampToFieldBounds` on every patch, deterministic itemized pricing via `priceNodes()`, rule-based degraded fallback (`cheapest` = catalog minimums, `best_practice` = catalog defaults, `degraded: true`) per research D5, in app/src/lib/generate/cost-options.ts
- [x] T021 [US2] Apply and switch paths: write the chosen option's configs through the existing architecture persistence, run `recomputeProjectEstimate`, store both options + `selectedOptionId` on `flow`; recognize switch-option intent and re-apply the stored other option without regeneration (FR-011), in app/src/lib/generate/cost-options.ts and app/src/lib/generate/cost-orchestrator.ts (depends on T020)
- [x] T022 [US2] Cost-turn routing in the messages route: build turn ends by emitting the `cost_questions` interaction (or continues in-stream to options when none apply), cost turn generates + prices options → `awaiting='cost_options'`, apply turn triggers on `selectedOptionId`/skip, `options` trace steps + `flowPhase='cost'`, in app/src/app/api/projects/[id]/chat/messages/route.ts (depends on T020, T021)
- [x] T023 [US2] Build `PricingOptionsCard` in ChatPanel: side-by-side options with monthly totals, indicative badges, itemized `perService` breakdowns, trade-off summaries, Select per option + round-level Skip, active-option state with a Switch affordance after completion, accessibility floor per contracts §5, in app/src/components/studio/ChatPanel.tsx (depends on T008)
- [x] T024 [P] [US2] Unit tests: variant generation and clamping, capability-preservation invariant (no structural patches), pricing merge, apply/switch, degraded fallback labelling, in app/tests/cost-options.test.ts

**Checkpoint**: Quickstart Scenario 4 passes on top of US1; US1 behavior unchanged

---

## Phase 5: User Story 3 - Final alignment and flow pass (Priority: P3)

**Goal**: After the pricing option applies (or is skipped), a finishing pass delivers a consistent left-to-right flow, sensible grouping, and zero overlaps — preserving user-arranged positions.

**Independent Test**: Quickstart Scenario 5 — an 8+ service guided generation ends with no overlapping nodes/containers and a consistent flow direction; in the revision variant, hand-placed untouched nodes keep their exact positions.

### Implementation for User Story 3

- [x] T025 [US3] Create the finalize module: `layoutWithElk` scoped to the changed subgraph in the revision case (full canvas for fresh builds), deterministic AABB overlap audit using the established `NODE_W`/`NODE_H` geometry with bounded axis-nudge resolution, honest residual-overlap note for the reply per research D6, in app/src/lib/generate/finalize.ts
- [x] T026 [US3] Wire finalize into the apply turn after option apply/skip: emit the `finalize` trace step, persist with `flowPhase='finalize'`, close the flow (`awaiting=null`), preserve user-arranged positions (FR-012), in app/src/app/api/projects/[id]/chat/messages/route.ts (depends on T025; builds on T022)
- [x] T027 [P] [US3] Unit tests: overlap detection and nudge convergence, residual-overlap reporting, scoped-layout position preservation, in app/tests/finalize.test.ts

**Checkpoint**: Full guided sequence (analyze → clarify → build → cost → finalize) works end to end

---

## Phase 6: User Story 4 - Small edits stay fast (Priority: P4)

**Goal**: Small in-place edits bypass the guided sequence entirely — zero interaction steps, today's latency — with safe classifier backstops.

**Independent Test**: Quickstart Scenario 6 — rename and add-a-cache requests apply directly with no cards; "redesign for multi-region DR" engages the full sequence.

### Implementation for User Story 4

- [x] T028 [US4] Small-edit bypass in the messages route + classifier guidance: `requestClass='small_edit'` routes to the legacy turn with zero interaction, code backstops (empty canvas ⇒ `new`; classifier failure ⇒ `major_revision`), at most one follow-up question for an ambiguous small edit (FR-013), in app/src/app/api/projects/[id]/chat/messages/route.ts and app/src/lib/generate/analyze.ts (depends on T009, T013)
- [x] T029 [P] [US4] Tests: classifier boundary cases (rename/config vs redesign/multi-service), empty-canvas backstop, legacy-path compatibility (no interaction fields emitted, stop semantics preserved per FR-014), in app/tests/analyze.test.ts and app/tests/flow.test.ts

**Checkpoint**: All four stories independently verifiable; non-guided behavior byte-compatible

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T030 [P] Accessibility pass over `QuestionRoundCard` and `PricingOptionsCard` against the constitution floor: keyboard-only operation, visible focus, reduced-motion (no animated reveals), single boundary live-region announcement per interaction, in app/src/components/studio/ChatPanel.tsx
- [ ] T031 Run quickstart Scenarios 1–7 end to end and record evidence against the sign-off checklist in specs/006-guided-generation-flow/quickstart.md — **partially verified 2026-07-10 at the API level against the live dev server + NVIDIA LLM**: Scenario 1 (analysis + clarify round, service choices with recommended badge, zero canvas changes pre-resolution), Scenario 2 (skip-all defaults → build), Scenario 4 (cost questions → cheapest $15.12/mo vs best-practice $36.70/mo itemized options → apply → text-driven switch), Scenario 5 core (finalize step, laid-out non-overlapping positions). Remaining: browser/UI walkthrough (cards rendering, keyboard/a11y spot-check), Scenario 3, 6, 7 variants
- [x] T032 Quality gates (quickstart Scenario 8): `npm run test`, `npm run lint`, `npm run build` all green in app/

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: after T001; **blocks all stories**. Internal order: T002 → (T003, T004, T005, T007, T008 in parallel) → T006
- **US1 (Phase 3)**: after Phase 2 — the MVP; no dependency on other stories
- **US2 (Phase 4)**: after Phase 2; integrates at US1's build-turn end (T013) — implement after US1
- **US3 (Phase 5)**: after Phase 2; triggers from US2's apply turn (T022) — implement after US2 (falls back to running after build when the cost round is skipped)
- **US4 (Phase 6)**: after US1's classifier (T009) and route wiring (T013)
- **Polish (Phase 7)**: after all desired stories

### Within-story order

- US1: T009 → T010 → (T011, T012 in parallel) → T013 → T014 → T016; T015/T017/T018/T019 parallel once their targets exist
- US2: T020 → T021 → T022 → T023; T024 parallel after T021
- US3: T025 → T026; T027 parallel after T025
- US4: T028 → T029

### Parallel Opportunities

- Phase 2: T003, T004, T007, T008 run in parallel after T002
- US1: T011 + T012 in parallel; the three test suites T017/T018/T019 in parallel
- Route-file tasks (T006, T013, T022, T026, T028) all touch `messages/route.ts` — **never parallel with each other**
- ChatPanel tasks (T008, T014, T023, T030) share a file — sequential

## Parallel Example: User Story 1

```text
# After T010 completes, launch together:
Task: T011 — brief-fed loop in app/src/lib/generate/agent-loop.ts + reviewer.ts
Task: T012 — planner prompt brief context in app/src/lib/generate/orchestrator.ts

# After T013/T014, launch the test suites together:
Task: T017 — app/tests/analyze.test.ts
Task: T018 — app/tests/flow.test.ts
Task: T019 — app/tests/agent-loop.test.ts
```

## Implementation Strategy

**MVP first (US1 only)**: Phases 1–3 deliver the constitutionally mandated clarify-before-build behavior — analysis, question round with service choices, canvas untouched until resolution, brief-fed build. Stop, run quickstart Scenarios 1–3, demo.

**Incremental delivery**: add US2 (cost dialogue) → Scenario 4; US3 (finalize) → Scenario 5; US4 (bypass) → Scenario 6; then Polish (T030–T032) before calling the feature done per Principle V.

**Solo-developer note**: the route file is the integration spine — T006, T013, T022, T026, T028 modify it in that order; everything else can interleave freely per the parallel markers.
