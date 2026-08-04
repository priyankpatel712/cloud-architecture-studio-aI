# Contract: Guided Generation Flow Protocol

**Feature**: 006-guided-generation-flow | **Date**: 2026-07-09

Extends the existing chat turn protocol (feature 004 NDJSON stream, feature 005 `diagram`
events) **additively**. Anything not listed here is unchanged. Entity shapes referenced below
are defined in [data-model.md](../data-model.md).

## 1. `POST /api/projects/[id]/chat/messages` — request body (additive)

```jsonc
{
  "text": "string",                    // as today; may be empty when interactionResponse present
  "tools": ["aws", "mongodb"],         // unchanged
  "interactionResponse": {             // NEW, optional
    "interactionId": "string",         // must match conversation.flow.openInteractionId
    "answers": [                       // per-question resolutions (clarify / cost_questions)
      { "questionId": "string", "optionId": "string" },   // select / service_choice answer
      { "questionId": "string", "text": "string" },       // free-text answer
      { "questionId": "string", "skipped": true }          // per-question skip
    ],
    "skipAll": false,                  // "use defaults & build" (FR-004)
    "selectedOptionId": "cheapest"     // cost_options round only: 'cheapest'|'best_practice'
  }
}
```

**Skip encoding for the `cost_options` round**: `skipAll: true` (with the open round's
`interactionId`) skips the options — finalize proceeds, `selectedOptionId` stays null, the
current configuration is kept. A `cost_options` response with neither `skipAll` nor a valid
`selectedOptionId` is a `422`.

**Server validation** (pre-stream, plain JSON error statuses as today):
- `interactionResponse.interactionId` ≠ open interaction ⇒ `409` (round closed or superseded —
  client refetches thread).
- Unknown `questionId`/`optionId` ⇒ `422`.
- `interactionResponse` while `flow.awaiting` is null ⇒ `409`.
- Free `text` alone while a round is open is **valid** — routed through interpretation
  (research D8); it may resolve the round, or supersede it on a material request change.

## 2. Turn routing (server-side, single route)

| `flow.awaiting` | Request contains | Turn executed |
|---|---|---|
| null | new/major request (classifier) | **Analyze turn**; if no applicable questions, continues into **build** in the same stream |
| null | small_edit (classifier) | **Legacy turn** (existing 004/005 loop, no interaction) |
| `clarify` | answers / skipAll / interpretable text | **Build turn** (brief-fed loop); ends emitting cost questions, or continues into **cost turn** in-stream when none apply |
| `clarify` | material request change | Supersede round → **Analyze turn** (fresh round) |
| `cost_questions` | answers / skip / text | **Cost turn** (generate + price both options) |
| `cost_options` | `selectedOptionId` / skip / text | **Apply + finalize turn** |
| null (flow complete) | switch-option intent in text | **Switch turn**: re-apply stored other option, recompute estimate; no regeneration |

Concurrency lock (`status='generating'`, 409 + stale-lock guard), stop route polling, and
`maxDuration = 120` apply identically to every turn type.

## 3. NDJSON stream — event additions (additive)

New step kinds ride the existing `{type:'step'}` event: `kind: 'analyze' | 'options' | 'finalize'`
(union extension; clients render unknown kinds with the default step chrome, as 005 established
for `chunk`).

**Terminal `{type:'result'}` payload gains**:

```jsonc
{
  "type": "result",
  "payload": {
    // ...existing fields (reply, nodes/edges summary, mcpCalls, indicative, runId, ...)
    "interaction": { /* Interaction, status:'open' */ },   // NEW, present when a round opened
    "flow": {                                              // NEW, always present on guided turns
      "awaiting": "clarify" | "cost_questions" | "cost_options" | null,
      "selectedOptionId": "cheapest" | "best_practice" | null
    }
  }
}
```

**Guarantees**:
- An analyze turn emits **zero `{type:'diagram'}` events** and performs **zero architecture
  persistence** (FR-005 — canvas untouched until clarification resolves).
- `{type:'stopped'}`/`{type:'error'}` semantics unchanged; on analyze/cost turns they leave
  `flow.awaiting` as it was before the turn.

## 4. `GET /api/projects/[id]/chat` — response (additive)

```jsonc
{
  // ...existing: status, activeTools, canPost, messages[]
  "flow": {                                  // NEW, null for legacy threads
    "awaiting": "clarify" | "cost_questions" | "cost_options" | null,
    "openInteractionId": "string|null",
    "selectedOptionId": "string|null"
  }
}
```

Message DTOs gain the optional `interaction` field verbatim (data-model §2). Thread resume =
re-render the last open interaction; no other client state needed.

## 5. UI contract (ChatPanel interaction blocks)

- **QuestionRoundCard** (`clarify` / `cost_questions`): renders each `ValidationQuestion`;
  select/service-choice options as buttons showing `label`, `detail`, and a "Recommended" badge;
  free-text input for `text` questions; per-question Skip; round-level **"Use defaults & build"**
  (⇒ `skipAll`). Submitting posts one `interactionResponse`. Card becomes read-only once
  `status` ≠ `open`, showing the recorded resolutions (FR-006).
- **PricingOptionsCard** (`cost_options`): side-by-side options with `label`, `monthly`
  (+ indicative badge when `indicative`), itemized `perService`, `summary` trade-offs; a Select
  button per option and a round-level Skip ("keep current configuration"). After completion the
  card shows which option is active; a Switch affordance posts a plain-text switch turn.
- **Accessibility floor** (constitution): all controls keyboard-operable with visible focus;
  no animated reveals under reduced-motion; one polite `aria-live` announcement per arriving
  interaction ("The assistant has N questions" / "Two pricing options are ready") — boundary-only
  policy preserved, no per-option announcements.
- Composer stays enabled while a round is open (free text is a first-class answer path).

## 6. Backward compatibility

- Legacy threads (no `flow`) and small-edit turns produce byte-compatible streams with today's
  protocol (no `interaction`, `flow` null/absent).
- All schema changes are optional fields; `GenerationRun.flowPhase` absent on old runs; old
  clients ignoring unknown result-payload fields keep working (additive-only rule from 005
  carried forward).
