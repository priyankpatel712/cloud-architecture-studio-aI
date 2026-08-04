---

description: "Task list for Reliable AWS-MCP Generation with Attachable Services and Editable Cost Estimation"
---

# Tasks: Reliable AWS-MCP Generation with Attachable Services and Editable Cost Estimation

**Input**: Design documents from `specs/003-editable-cost-estimation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested as TDD in the spec; verification is via driven scenarios
(Constitution V) plus the specific unit tests plan.md commits to for the new pure logic modules.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and
testing of each story. This is a brownfield feature — all referenced files already exist except
where marked "create".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to its user story (US1–US4)
- All descriptions include exact file paths, relative to the repository root

## Path Conventions

Single existing Next.js app under `app/` (see plan.md Project Structure) — no new project/option.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before touching shared orchestrator/pricing code.

- [X] T001 Confirm `npm run build` and `npm run lint` pass cleanly on `003-editable-cost-estimation`
      before starting (run from `app/`) — establishes the baseline this feature must not regress,
      since US1 modifies shared orchestrator code every other story also depends on.

**Checkpoint**: Baseline confirmed clean. No new dependencies are required (plan.md Technical Context).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data shapes and pure logic every user story below builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add `quantityField?: string` to AWS service definitions in
      `app/src/lib/providers/aws/catalog.ts` (research.md R3/R9) — set it to `'count'` for
      `aws-ec2` (and any other service whose config already has a count-like field); leave it
      undefined for services with no natural quantity dimension.
- [X] T003 [P] Create the `CostEstimateOverride` model in
      `app/src/lib/models/CostEstimateOverride.ts` per data-model.md: `projectId` + `ownerId` +
      unique-compound `(projectId, nodeId)` + `quantityOverride` + `totalCostOverride` +
      `configSnapshot` (Mixed) + `source` (`'inline'|'chat'`) + `setBy` + `setAt`.
- [X] T004 [P] Extend the `CostEstimate` model's `perServiceSchema` in
      `app/src/lib/models/CostEstimate.ts` with `overridden: Boolean` and `stale: Boolean`
      (data-model.md).
- [X] T005 [P] Extend the message subdocument in `app/src/lib/models/AIConversation.ts` with an
      optional `error: { step: 'architecture'|'cost', retryable: Boolean }` field (data-model.md,
      research.md R2 — this is how the spec's `GenerationAttempt` entity is realized, not as a new
      collection).
- [X] T006 [P] Add `costOverridePatchSchema` (zod) to `app/src/lib/schemas.ts`: `{ nodeId: string,
      quantityOverride?: number (>0), totalCostOverride?: number (>=0), clear?: boolean }` per
      contracts/cost-overrides.md.
- [X] T007 Create the pure override merge/precedence/stale module
      `app/src/lib/generate/overrides.ts` (research.md R5/R6/R11; depends on T003, T004 for shapes):
      given a project's priced `perService` list and its `CostEstimateOverride[]`, return the
      adjusted `perService` list where a `quantityOverride` recomputes the line through the
      service's existing pricing formula and takes precedence over any `totalCostOverride` on the
      same line (Clarification 2), each entry gains `overridden`/`stale` (stale = current node
      `config` differs from the override's stored `configSnapshot`). **This module MUST NOT import
      `app/src/lib/models/Architecture`** — decoupling (FR-015) is enforced structurally, not just
      documented.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Dependable architecture generation via AWS MCP (Priority: P1) 🎯 MVP

**Goal**: Generation failures are diagnosable, retries are safe (no duplicate/partial output), and a
non-retryable configuration failure is never presented as something a retry can fix.

**Independent Test**: Send a well-formed prompt with the AWS tool attached and confirm a costed,
editable architecture returns; separately break `LLM_API_KEY`/`AWS_MCP_COMMAND`, confirm a specific
error with no retry offered, restore it, retry, and confirm no duplicate/partial output.

- [X] T008 [US1] Remove the leftover debug `console.log`/`console.error` traces around the LLM call
      in `app/src/lib/generate/orchestrator.ts` (research.md R1) and replace them with the single
      structured failure capture consumed by T010.
- [X] T009 [US1] Distinguish non-retryable configuration failures from retryable transient ones:
      ensure a config-cause failure (`McpUnavailableError` from an unset `AWS_MCP_COMMAND`, or
      `LlmError` with `retryable: false` from `app/src/lib/llm.ts`) always carries an actionable,
      specific message (e.g. "AWS generation isn't configured for this environment") distinct from a
      transient failure's message, in `app/src/lib/generate/orchestrator.ts`.
- [X] T010 [US1] Add `step: 'architecture' | 'cost'` to the failure response of
      `POST /api/projects/[id]/chat/messages` in
      `app/src/app/api/projects/[id]/chat/messages/route.ts` (contracts/generation-reliability.md);
      persist the same `step`/`retryable` onto the failed assistant message's `error` field (T005).
- [X] T011 [US1] Update `app/src/components/studio/ChatPanel.tsx` to render a step-aware failure
      message and to suppress the retry button when `retryable === false`, showing the
      configuration-failure explanation instead of a generic "please retry" (contracts/generation-
      reliability.md).
- [X] T012 [US1] Driven verification (quickstart.md US1): with a deliberately broken
      `LLM_API_KEY`/`AWS_MCP_COMMAND`, confirm no retry is offered and the reason is specific;
      restore the env var, retry the identical prompt, and confirm no duplicate
      `Architecture.nodes`/`edges` or extra `CostEstimate` documents result from the failed attempt.

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Attach additional services to an existing architecture (Priority: P1)

**Goal**: Attaching a service (via chat or catalog) extends the architecture in place; attaching an
already-present service merges into it instead of duplicating it.

**Independent Test**: Generate a base architecture, attach one service via chat and one via the
catalog, confirm both merge in without disturbing existing services/positions/connections, and
attach an already-present service to confirm it merges (quantity increments) rather than duplicates.

- [X] T013 [US2] Implement attach-duplicate merge in the plan-application step of
      `app/src/lib/generate/orchestrator.ts` (research.md R3): before pushing a planned `add`, check
      for an existing node with the same `serviceId`/`provider` not already targeted by this turn's
      `remove`/`update`; if found and the service declares `quantityField` (T002), increment that
      config field on the existing node instead of creating a new node; if the service has no
      quantity field, apply the plan's `config` to the existing node in place (FR-005).
- [X] T014 [US2] Apply the same duplicate-merge rule to direct catalog additions — **implemented in
      the client's catalog-add path (`app/src/components/studio/Canvas.tsx` `addService`) instead of
      the PUT route**: the PUT receives the whole node list and cannot distinguish a catalog attach
      from feature 002's sanctioned copy/paste/duplicate (FR-009), so a server-side merge would
      silently collapse legitimate duplicates. The catalog click/drop path is exactly the "adds a
      service directly from the catalog" action US2/AC2 names, and intent is known there. Merge
      applies to quantity-bearing services (increment count); no-quantity services keep the
      long-standing add-a-node canvas behavior to preserve 002 workflows (FR-004, FR-005).
- [X] T015 [US2] Driven verification (quickstart.md US2): attach an already-present service via chat
      (confirm quantity increments, no duplicate node) and a new service via the catalog panel
      (confirm it merges into the same architecture without moving/reconfiguring unrelated nodes).

**Checkpoint**: User Stories 1 and 2 are both independently functional.

---

## Phase 5: User Story 3 - Edit the generated cost estimate (Priority: P1)

**Goal**: A user with edit access can override a line item's quantity and/or fixed total cost —
inline or via chat — with immediate recalculation, correct precedence, stale-flagging, validation,
and read-only enforcement for shared collaborators.

**Independent Test**: Override one service's quantity and another's total cost, confirm immediate
recalculation and manual marking; reset one; override via chat; change a configured service
afterward and confirm the stale flag; submit an invalid value and confirm rejection; confirm a
read-only collaborator cannot edit.

- [X] T016 [P] [US3] Create `PATCH /api/projects/[id]/cost-overrides` in
      `app/src/app/api/projects/[id]/cost-overrides/route.ts` per contracts/cost-overrides.md:
      validate with `costOverridePatchSchema` (T006), enforce `canEditProject` (owner-only today,
      research.md R10; `403` otherwise), upsert or delete the `CostEstimateOverride` (T003),
      recompute the estimate via `overrides.ts` (T007), and return it.
- [X] T017 [P] [US3] Create the chat cost-orchestrator `app/src/lib/generate/cost-orchestrator.ts`
      per research.md R8 and contracts/cost-overrides.md: a narrow LLM call producing
      `{ overrides: [{ nodeRef, field: 'quantity'|'totalCost', value }], clarificationNeeded,
      clarificationQuestion? }`; `nodeRef` resolves against existing `nodeId`s and this turn's
      `new:<index>` adds, same convention as the architecture phase's edge resolution. This module
      writes only through the `CostEstimateOverride` path (T003/T007) and must not import or write
      `Architecture`.
- [X] T018 [US3] Wire the cost-orchestrator (T017) into
      `app/src/app/api/projects/[id]/chat/messages/route.ts` as the second phase run after the
      architecture phase on every turn (FR-008a); on `clarificationNeeded`, the reply is the
      `clarificationQuestion` and no override is written that turn (Edge Case: ambiguous chat
      cost-change instruction).
- [X] T019 [US3] Merge overrides (via T007) into the `estimate` computed in both
      `app/src/app/api/projects/[id]/chat/messages/route.ts` and
      `app/src/app/api/projects/[id]/architecture/route.ts` (PUT), so every recomputation —
      chat-driven, attach-driven, or direct-edit-driven — reflects current overrides and
      recomputes each line's stale flag against its live `config` (FR-010, FR-012).
- [X] T020 [US3] Auto-discard orphaned overrides: in the same three write paths touched by T014/T018/
      T019, delete a node's `CostEstimateOverride` document when that node is removed from the
      architecture (FR-013, edge case "overridden line item's service is later removed").
- [X] T021 [P] [US3] Build the inline cost-override UI — extend
      `app/src/components/studio/Inspector.tsx` (or add a sibling `CostPanel.tsx` alongside it):
      per-line quantity/total-cost input, "manual" badge, stale-flag indicator, reset action; inputs
      disabled (view-only) for collaborators without edit access (FR-008, FR-009, FR-011, FR-014).
- [X] T022 [US3] Driven verification (quickstart.md US3): inline-override a quantity and a total
      cost, confirm immediate recalculation and manual marking; reset one; via chat say "set the EC2
      cost to $200/month"; change that service's instance type afterward and confirm the stale flag
      appears; submit a negative value and confirm rejection with no total change; confirm a
      read-only collaborator sees but cannot edit overrides.

**Checkpoint**: User Stories 1, 2, and 3 are all independently functional — the core
editable-estimate capability is complete.

---

## Phase 6: User Story 4 - Export the cost estimate as a client-ready proposal (Priority: P2)

**Goal**: The cost estimate (with overrides, clearly marked) can be exported on its own, without the
architecture diagram, as a client-facing document.

**Independent Test**: Price an architecture with one overridden line item, export the estimate
alone, and confirm every line item (computed and overridden, marked) and the total appear without
diagram data; confirm diagram exports still work independently.

- [X] T023 [US4] Add `'estimate'` to the `FORMATS` tuple and implement its server-side serialization
      in `app/src/app/api/projects/[id]/export/route.ts` per contracts/export.md — reads the latest
      `CostEstimate` snapshot and current `CostEstimateOverride`s only, never `Architecture`.
- [X] T024 [US4] Wire the existing export trigger in `app/src/app/(dashboard)/studio/page.tsx` (and
      its shared PDF-rendering path used today for `png`/`pdf`) with a new "Export cost estimate"
      option that calls `format=estimate` and renders the resulting JSON into a client-facing
      document, independent of the diagram export path.
- [X] T025 [US4] Driven verification (quickstart.md US4): with an override in place, export
      `format=estimate` and confirm all line items (computed, overridden, stale) and totals appear
      with no diagram data required; separately export `png`/`pdf`/`mermaid`/`json` and confirm they
      still succeed independently.

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T026 [P] Unit tests for the pure precedence/stale logic in
      `app/src/lib/generate/overrides.ts` (quantity-override-wins-over-total-override; stale
      detection via `configSnapshot` diff; no-override passthrough) per plan.md Testing.
- [X] T027 [P] Unit tests for the attach-dedup merge logic added to
      `app/src/lib/generate/orchestrator.ts` in T013 (quantity-field increment path,
      config-only-merge path for services with no quantity field, and the ordinary new-node-add path
      when no existing match exists).
- [X] T028 Full `npm run build` + `npm run lint` pass, and a complete run of every quickstart.md
      scenario end-to-end (Constitution V — verify before done).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–6)**: All depend on Foundational completion.
  - US1, US2, US3 are all Priority P1 and are mutually independent in code (different concerns
    within shared files) but are listed in spec order; US4 (P2) only needs the `overrides.ts`
    module from Foundational, not US3's endpoints, so it can proceed in parallel with US3 if staffed.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### User Story Dependencies

- **US1 (P1)**: No dependency on US2/US3/US4 — touches `orchestrator.ts`'s failure path,
  `messages/route.ts`'s error response, and `ChatPanel.tsx`.
- **US2 (P1)**: No dependency on US1/US3/US4 — touches `orchestrator.ts`'s plan-application path and
  the architecture PUT route. Shares files with US1 (`orchestrator.ts`) — implement sequentially if
  one person, or coordinate if parallel.
- **US3 (P1)**: Depends on Foundational only (T003/T004/T006/T007); does not require US1 or US2 to
  be done first, though it touches the same `messages/route.ts` and `architecture/route.ts` files —
  sequence after US1/US2 if a single implementer to avoid merge conflicts in those files.
- **US4 (P2)**: Depends on Foundational's `overrides.ts` (T007) and, for a meaningful demo, on US3
  having produced at least one override — but its own code (export route) has no hard dependency on
  US3's endpoints existing.

### Within Each User Story

- Foundational shapes before story logic; story logic before UI wiring; UI wiring before driven
  verification.
- Each story's checkpoint task (the last, non-[P] "Driven verification" task) confirms independent
  testability before moving to the next story.

### Parallel Opportunities

- All Foundational tasks marked [P] (T002–T006) can run in parallel; T007 waits on T003/T004.
- Within US3: T016 and T017 are different files and can run in parallel; both feed T018/T019.
- US4 (T023–T025) can proceed in parallel with US3 once Foundational is done, since it only needs
  `overrides.ts`, not US3's endpoints.
- T026/T027 (Polish unit tests) can run in parallel with each other.

---

## Parallel Example: Foundational Phase

```bash
# Launch these together once Setup is confirmed:
Task: "Add quantityField to app/src/lib/providers/aws/catalog.ts"
Task: "Create CostEstimateOverride model in app/src/lib/models/CostEstimateOverride.ts"
Task: "Extend CostEstimate.perServiceSchema with overridden/stale in app/src/lib/models/CostEstimate.ts"
Task: "Extend AIConversation message schema with error{step,retryable} in app/src/lib/models/AIConversation.ts"
Task: "Add costOverridePatchSchema to app/src/lib/schemas.ts"
```

## Parallel Example: User Story 3

```bash
# Once Foundational is complete, launch together:
Task: "Create PATCH /api/projects/[id]/cost-overrides route"
Task: "Create app/src/lib/generate/cost-orchestrator.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything).
3. Complete Phase 3: User Story 1 — this alone fixes the reported "chat is not working properly"
   complaint and is independently shippable.
4. **STOP and VALIDATE**: run US1's driven verification (T012).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → ship (fixes the reliability complaint).
3. US2 → validate → ship (attach without losing work).
4. US3 → validate → ship (the editable-estimate capability the request centers on).
5. US4 → validate → ship (client-proposal export).

### Parallel Team Strategy

Once Foundational is done: one developer on US1+US2 (both touch `orchestrator.ts` — keep together to
avoid conflicts), a second on US3, a third on US4 (only needs `overrides.ts` from Foundational).

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps each task to its user story for traceability.
- This is a brownfield feature: "create" tasks add new files; all others extend existing files
  named explicitly in plan.md's Project Structure.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
