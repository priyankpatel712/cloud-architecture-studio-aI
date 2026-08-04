# Data Model: Guided Diagram Generation Flow

**Feature**: 006-guided-generation-flow | **Date**: 2026-07-09

All changes are **additive optional fields on existing collections** — no new collection, no
migration. Legacy documents (no `flow`, no `interaction`) remain valid and behave as
non-guided threads. Names below are the canonical vocabulary for contracts, tasks, and code.

## 1. AIConversation — new `flow` subdocument (conversation-level state machine)

Single source of truth for "where is this thread in the guided sequence".

```text
flow?: {
  awaiting: 'clarify' | 'cost_questions' | 'cost_options' | null
                                  // null = no open round; turns run per router rules
  brief: RequirementBrief         // consolidated analysis + resolved answers (below)
  openInteractionId: string|null  // id of the interaction awaiting a response
  preservedNodes: [{ nodeId, x, y, containerId }]
                                  // position snapshot of nodes present BEFORE the guided
                                  // build — the finalize pass restores these (when container
                                  // membership is unchanged) so user-arranged work keeps its
                                  // exact placement (FR-012 / US3-S3)
  pricingOptions: PricingOption[] // filled by the cost turn; retained for switching
  selectedOptionId: string|null   // 'cheapest' | 'best_practice' | null (skipped)
  updatedAt: Date
}
```

Existing fields untouched: `status: 'idle'|'generating'|'failed'` still guards turn concurrency
(a phase turn holds `generating` exactly like any turn today); `stopRequested`, `activeTools`
unchanged.

### RequirementBrief (embedded)

The single input the build turn plans from (FR-006). Never derived from stale analysis: any
material request change supersedes and rebuilds it (research D8).

```text
RequirementBrief {
  requestText: string                       // latest analyzed request wording
  requestClass: 'new' | 'major_revision' | 'small_edit'
  capabilities: [{ id: string, text: string, source: 'stated'|'inferred' }]
  scaleAssumptions: [{ key: string, value: string, source: 'stated'|'answered'|'defaulted' }]
  constraints: string[]
  changeScope: string[]                     // existing nodeIds the request targets
                                            // (preserve-user-work scope, fed to the loop)
  selections: [{ questionId: string, need: string, serviceId: string }]
                                            // explicit service choices — build MUSTs (FR-008)
  defaultsApplied: string[]                 // human-readable, disclosed in reply (FR-004)
}
```

Traceability to spec Key Entities: the spec's **Service Choice** entity is realized as
`ValidationQuestion(kind='service_choice')` plus the resulting `brief.selections` entry; the
spec's **Guided Turn** is realized as `conversation.flow` plus the per-turn
`GenerationRun.flowPhase` (research D10) — neither is a separate collection.

**Validation rules**: `selections[].serviceId` must resolve via the catalog
(`serviceById`/`resolveServiceDef`); `capabilities` non-empty for `new`/`major_revision` briefs;
`requestClass` defaults to `major_revision` on classifier failure (research D4).

## 2. AIConversation message — new optional `interaction` subdocument

A structured round attached to an assistant message. The thread itself is the durable Q&A record
(FR-006); `flow` only mirrors the *open* round for fast routing.

```text
interaction?: {
  id: string                                // referenced by interactionResponse
  kind: 'clarify' | 'cost_questions' | 'cost_options'
  status: 'open' | 'answered' | 'skipped' | 'superseded'
  questions?: ValidationQuestion[]          // kinds 'clarify' | 'cost_questions'
  options?: PricingOption[]                 // kind 'cost_options' (display copy)
}
```

### ValidationQuestion (embedded)

```text
ValidationQuestion {
  id: string
  prompt: string                            // the question as shown
  why: string                               // which gap it closes (FR-002 rationale)
  kind: 'text' | 'single_select' | 'service_choice'
  need?: string                             // service_choice only: the capability it resolves
  options?: [{                              // single_select & service_choice
    id: string
    label: string
    detail: string                          // one-line trade-off (FR-003)
    serviceId?: string                      // service_choice only, catalog-validated
    recommended: boolean                    // exactly one true per service_choice
  }]
  skippable: true                           // always true (FR-004)
  resolution?: { kind: 'answered'|'skipped', optionId?: string, text?: string }
}
```

**Validation rules**: ≤ `QUESTION_LIMIT` (5) questions per clarify round, ≤ `COST_QUESTION_LIMIT`
(3) per cost round; `service_choice` requires 2–4 catalog-valid options after server validation —
fewer collapses to a confirmation sentence in the reply instead of a question (research D3);
exactly one `recommended` per choice.

### PricingOption (embedded — on `flow.pricingOptions` and displayed via `interaction.options`)

```text
PricingOption {
  id: 'cheapest' | 'best_practice'          // extensible; these two are mandatory (FR-010)
  label: string                             // display name
  summary: string                           // plain-language trade-offs
  monthly: number                           // priced by the engine, never by the LLM
  indicative: boolean                       // pricing-source availability flag
  perService: [{ nodeId, serviceId, cost, basis: 'exact'|'indicative' }]
  patches: [{ nodeId: string, config: object }]   // full replacement config per touched node,
                                            // clamped via clampToFieldBounds pre-pricing
  degraded: boolean                         // true when rule-based fallback produced it (D5)
}
```

**Invariants**: patches never add/remove nodes or edges (capability preservation by
construction); both mandatory options always present, even when cost questions were skipped;
`monthly`/`perService` come from `priceNodes()` on the patched configs.

## 3. GenerationRun — new optional `flowPhase`

```text
flowPhase?: 'analyze' | 'build' | 'cost' | 'finalize'   // absent on legacy/small-edit runs
```

One run per turn is preserved (research D10). `StepKind` union in the trace gains
`'analyze' | 'options' | 'finalize'` (additive, mirrors `trace-emitter.ts` and
`traceStepSchema`). `terminalStatus` semantics for non-build phase turns: `converged` on
success, `failed`/`stopped` as today (`best_effort` remains a build-loop outcome).

## 4. State transitions (`flow.awaiting`)

```text
                    ┌────────────────────────────────────────────────────────┐
                    │ (no flow / null)                                       │
                    └────────────────────────────────────────────────────────┘
  user msg → analyze turn:                                       small_edit ⇒ legacy
    questions found        no questions (spec US1-S5)            turn, awaiting stays null
        │                        │
        ▼                        ▼
  awaiting='clarify' ──────► build turn (same stream continues)
        │  answers/skip-all/free-text-interpreted
        ▼
  build turn (existing loop, brief-fed) → cost questions emitted
        │ cost questions exist            │ none applicable
        ▼                                 ▼
  awaiting='cost_questions'         cost turn runs in-stream
        │ answers/skip                    │
        ▼                                 ▼
  cost turn (options generated+priced) ──► awaiting='cost_options'
        │ selectedOptionId (or explicit skip)
        ▼
  apply+finalize turn (configs written, recompute, scoped layout, overlap audit)
        ▼
  awaiting=null, flow complete (selectedOptionId retained for later switching)
```

**Transition rules**:
- A material request change while any round is open ⇒ open interaction `status='superseded'`,
  re-analyze, new round (D8). Superseded rounds are never resolvable afterwards.
- Stop during a phase turn: analyze/cost turns discard in-flight work, `awaiting` unchanged;
  build turn keeps existing 004/005 stop semantics (applied chunks kept, no cost phase).
- "Switch to <other option>" after completion: cost-orchestrator intent path re-applies the
  stored other `PricingOption` + `recomputeProjectEstimate`; no `awaiting` change, no
  regeneration (FR-011).
- Legacy threads / small edits never set `awaiting`; every existing behavior is reachable
  unchanged (FR-013/FR-014).

## 5. Untouched models (explicitly)

`Architecture` (nodes/edges/containers/annotations/version), `CostEstimate`,
`CostEstimateOverride`, `Project`, auth/user models — no schema change. The apply step writes
node `config` values through the existing architecture persistence path and recomputes via the
existing `recomputeProjectEstimate`, preserving override merge semantics ("manual" lines stay
manual, becoming `stale` if their config changed — existing behavior).
