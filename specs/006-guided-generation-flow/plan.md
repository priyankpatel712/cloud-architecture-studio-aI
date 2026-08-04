# Implementation Plan: Guided Diagram Generation Flow

**Branch**: `006-guided-generation-flow` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-guided-generation-flow/spec.md`

## Summary

Re-sequence AI diagram generation into the constitution v1.4.0 guided flow: analyze → clarify
→ build → cost dialogue → finalize. Today's pipeline (features 004/005) is a fully autonomous
one-shot NDJSON turn (`understand → gather → [draft/validate/layout/price/review/refine]* →
persist → cost`) that never yields to the user. This feature converts it into a **multi-turn
phase state machine** persisted on the conversation: an analyze turn surfaces the assistant's
understanding and asks request-specific validation questions (including selectable service
choices) as a structured `interaction` attached to the assistant message; the user's answers
arrive as the next message and trigger the build turn (the existing agentic loop, fed by the
consolidated requirement brief); the build turn ends with cost questions; the cost turn
generates and prices a **cheapest** and a **best-practice** configuration variant of the built
architecture; applying the chosen option triggers the finalize turn (scoped ELK re-layout +
overlap audit). Small in-place edits bypass the sequence entirely via a request classifier.
No blocking waits: every active phase is its own short streamed turn inside the existing
120-second envelope, so unbounded user think-time between phases costs nothing (FR-015).

## Technical Context

**Language/Version**: TypeScript 5.x, Next.js 16 (App Router) — unchanged, no new stack element.

**Primary Dependencies**: None new. Reuses `@/lib/llm` (`llmJson` structured output), the NDJSON
streaming route (`app/src/app/api/projects/[id]/chat/messages/route.ts`), the agentic loop
(`@/lib/generate/agent-loop.ts`, `@/lib/generate/orchestrator.ts`, `trace-emitter.ts`),
the pricing engine (`@/lib/pricing.ts` `priceNodes`, `@/lib/cost-estimate.ts`
`recomputeProjectEstimate`), the service catalog (`@/lib/catalog.ts`, provider catalogs), and
ELK auto-layout (`@/lib/canvas/layout.ts` `layoutWithElk`).

**Storage**: MongoDB via Mongoose — additive only. New `flow` subdocument on `AIConversation`
(phase state + requirement brief + pricing options), new optional `interaction` field on the
message subdocument, new optional `flowPhase` on `GenerationRun`. No new collection, no migration
(all fields optional; legacy documents remain valid).

**Testing**: Vitest, existing LLM-mocked pattern (`app/tests/agent-loop.test.ts`) — new tests for
the analyze schema/sanitizer, phase router transitions, candidate-service validation, pricing
option generation/application, and the finalize overlap audit.

**Target Platform**: Same — Next.js web app, Node-runtime route handlers, React Flow canvas.

**Project Type**: Web service (existing single Next.js app under `app/`) — not a new project.

**Performance Goals**: SC-003 (clarification round ≤5 questions, answerable <2 min); SC-007
(small edits: zero added interaction steps, no added latency); SC-008 (each active phase within
the existing 90s p90 / 120s hard-cap envelope, user wait time excluded by construction).

**Constraints**: Route `maxDuration = 120` applies per turn (per active phase). The feature-005
provider rate pacing (`CHUNK_PLAN_DELAY_MS`) is untouched; the new analyze/cost turns add 1–2
LLM calls each, far below the provider's request-rate cap. Canvas MUST NOT change before the
clarification round resolves (FR-005) — the analyze turn emits no `diagram` events and performs
no persistence. Accessibility floor applies to all new interaction UI (keyboard-operable option
cards, visible focus, polite live-region announcement when a question round or options arrive).

**Scale/Scope**: One conversation flow state machine, ~4 new server modules, 1 route rework
(phase router inside the existing messages route), 2 new message-level UI blocks (question round
card, pricing options card), architectures at today's scale (single- to low-double-digit nodes).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Official Integrations First | No new external dependency. Candidate services and pricing options are grounded in the existing provider catalogs and priced via the existing official-source pricing adapters (indicative fallback unchanged). PASS. |
| II. Plugin-Based, Extensible Providers | Candidate service sets are derived from the registered providers' catalogs at runtime (no hard-coded provider service lists in core); pricing options price through `getProvider(...).pricing`. A future provider's services automatically become candidates. PASS. |
| III. API-First & Secure by Default | No new credential path. Interactions ride the existing authenticated messages route; answers are validated server-side (question/option IDs checked against the stored open round, owner/editor gate unchanged). PASS. |
| IV. Spec-Driven Delivery | Constitution v1.4.0 → spec 006 → this plan → `/speckit-tasks` → `/speckit-implement`. PASS. |
| V. Verify Before Done | quickstart.md defines runnable end-to-end scenarios for every phase plus the bypass and non-regression paths; `next build` gate unchanged. PASS. |
| Diagram Generation Flow (v1.4.0) | This feature IS the implementation of that section; the plan maps each numbered constitutional step to a phase (analyze→FR-001, clarify→FR-002..006, build→FR-007..008, cost→FR-009..011, finalize→FR-012) and preserves the "conversational ordering only — budgets unchanged" clause via the per-turn state machine. PASS. |
| Tech constraint — Performance | Each active phase is its own turn under the existing 90s p90 / 120s cap; the build turn is unchanged from 004/005. User think-time between turns is structurally excluded. PASS — re-verify empirically in quickstart Scenario 8. |
| Tech constraint — Cost realism (v1.3.0) | Strengthened: skipped questions fall back to MVP-scale defaults and the applied defaults are disclosed in the reply (FR-004); both pricing options are clamped via `clampToFieldBounds` before pricing. PASS. |
| Tech constraint — Accessibility floor | Question round and pricing option cards: keyboard-operable, visible focus, reduced-motion safe (no animated reveals), one polite live-region announcement per arriving interaction (boundary-only policy from 004 preserved). PASS. |

**Result**: No violations. No Complexity Tracking entries needed.

**Post-design re-check (after Phase 1)**: The data model adds only additive optional fields to
existing collections; the contract adds one request field, one message field, and extends the
`result` payload additively — no principle newly implicated. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/006-guided-generation-flow/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── guided-flow-protocol.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created by /speckit-plan)
```

### Source Code (repository root)

Existing single Next.js app under `app/`; new modules slot into the established
`lib/generate` layout. No new top-level directory, no new API route (the messages route becomes
a phase router; GET chat and stop routes gain additive fields only).

```text
app/src/lib/generate/
├── analyze.ts            # NEW — ANALYZE_SCHEMA + analyzeRequest(): user-facing analysis,
│                         #   request classifier (new|major_revision|small_edit), validation
│                         #   questions, catalog-grounded candidate service sets; sanitizers
├── flow.ts               # NEW — guided-flow state machine: resolve interaction responses
│                         #   (incl. free-text interpretation), build/merge RequirementBrief,
│                         #   compute next phase, supersede stale rounds
├── cost-options.ts       # NEW — generate cheapest + best-practice config variants (LLM patch
│                         #   plan → clampToFieldBounds → priceNodes), apply selected option,
│                         #   switch-option support without regeneration
├── finalize.ts           # NEW — final alignment pass: scoped layoutWithElk (changed subgraph
│                         #   only in revision case), AABB overlap audit + nudge, honest-limit
│                         #   reporting
├── agent-loop.ts         # runAgentLoop accepts a RequirementBrief: confirmed capabilities and
│                         #   selected services replace the internal understand output; reviewer
│                         #   gains "selected services present" gate
├── orchestrator.ts       # planner prompt gains brief context (selections are MUSTs; defaulted
│                         #   assumptions restated); no structural change to chunk rounds
├── loop-config.ts        # + QUESTION_LIMIT (default 5), COST_QUESTION_LIMIT (default 3),
│                         #   OPTION_COUNT floor (2) — env-overridable via intEnv()
├── trace-emitter.ts      # StepKind += 'analyze' | 'options' | 'finalize'
└── cost-orchestrator.ts  # unchanged detection path; switch-option intent recognized and routed
                          #   to cost-options.ts apply

app/src/lib/models/
├── AIConversation.ts     # + flow subdoc (awaiting, brief, questions, pricingOptions,
│                         #   selectedOptionId); messageSchema + optional interaction subdoc
└── GenerationRun.ts      # + optional flowPhase: 'analyze'|'build'|'cost'|'finalize'

app/src/app/api/projects/[id]/chat/
├── messages/route.ts     # phase router: classify → analyze turn | build turn | cost turn |
│                         #   apply+finalize turn | legacy small-edit turn; request body gains
│                         #   optional interactionResponse; result payload gains interaction/flow
├── route.ts              # GET returns conversation.flow summary (resume support)
└── runs/[runId]/route.ts # unchanged (flowPhase rides the existing document)

app/src/components/studio/
├── ChatPanel.tsx          # renders interaction blocks: QuestionRoundCard (text / single-select /
│                          #   service-choice with recommended badge + trade-offs, per-question
│                          #   skip, "Use defaults & build"), PricingOptionsCard (side-by-side
│                          #   itemized estimates + trade-offs, select/switch); submits
│                          #   interactionResponse; live-region announcement on arrival
├── WorkingTrace.tsx       # labels for the new step kinds
└── (studio/page.tsx, projects/new/page.tsx) — pass-through wiring: first-generation surface
                           #   lands in the studio with the open clarification round intact

app/tests/
├── analyze.test.ts        # NEW — schema sanitize, classifier boundaries, candidate validation
├── flow.test.ts           # NEW — state machine transitions, answer resolution, supersede,
│                          #   free-text interpretation fallback
├── cost-options.test.ts   # NEW — variant generation, clamping, pricing merge, apply/switch
├── finalize.test.ts       # NEW — overlap audit, scoped layout preservation
└── agent-loop.test.ts     # extended — brief-fed loop honors selections (FR-008)
```

**Structure Decision**: Extend the feature 004/005 module layout in place. The messages route
remains the single entry point for all turns — a phase router at its top inspects
`conversation.flow.awaiting`, the request's `interactionResponse`, and the analyze classifier
to pick the turn body; each turn body reuses the existing stream/emit/persist scaffolding.
This keeps the one-generation-at-a-time lock, stop polling, stale-lock guard, and NDJSON error
contract identical across all phases.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.*
