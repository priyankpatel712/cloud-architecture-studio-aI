# Data Model: Agentic Architecture Generation (Feature 004)

Extends the 001/003 data model. One new collection (`GenerationRun`) holds each turn's full trace; `AIConversation` messages gain a lightweight `runId` reference plus run-summary fields, and the conversation gains a `stopRequested` flag (research R5, Clarification 2026-07-09 Q3).

## TraceStep (new — stored in `GenerationRun.steps[]`, not on the message)

One observable unit of work inside a generation run (spec: Trace Step entity).

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable within the run (e.g. `lookup:aws@2`); used by the client to upsert live step state. |
| `kind` | enum | `understand \| lookup \| draft \| review \| refine \| layout \| price \| validate \| persist \| cost` |
| `label` | string | Human-readable ("Consulting official AWS MCP", "Reviewing draft against your request"). |
| `detail` | string (optional, ≤300 chars) | Short specifics: source consulted, verdict summary ("2 capabilities unmet: WAF, multi-region DR"), refinement summary. |
| `iteration` | int ≥ 1 | Loop iteration the step belongs to; backbone phases before the loop are iteration 1. |
| `status` | enum | `done \| failed` when persisted (`running` exists only on the live stream). |
| `startedAt` / `endedAt` | Date | For duration display; `endedAt` optional on failure. |

## ReviewVerdict (transient loop state — persisted only as the review step's `detail`)

Structured outcome of one self-review (spec: Review Verdict entity). Held in memory to drive the loop; **not** persisted as a separate field (Clarification 2026-07-09). Its reasons are captured for audit as the review `TraceStep.detail` (pass/fail, unmet capabilities, what changed).

| Field | Type | Rules |
|---|---|---|
| `pass` | boolean | Loop exits on first `true`. |
| `unmetCapabilities` | string[] | Plain-language capability names; includes auto-appended structural-validation failures (research R6). |
| `refinementInstructions` | string | Fed to the next planner call; empty when `pass`. |

Verdicts are untrusted LLM output → coerced by a `sanitizeVerdict()` (same philosophy as `sanitizePlan`): non-boolean `pass` → `false`; non-string entries dropped; instructions truncated.

## GenerationRun (new collection)

The spec's **Generation Run** entity, realized as its own document so the frequently-read conversation thread never carries trace weight (research R5, Clarification Q3). One document per assistant generation turn; holds the full ordered trace, fetched on demand.

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Referenced by the assistant message's `runId`. |
| `conversationId` | ObjectId → AIConversation | Owning thread. |
| `projectId` | ObjectId → Project | For the read access check on the on-demand fetch (mirrors thread read access). |
| `ownerId` | ObjectId → User | Denormalized for authorization/retention. |
| `iterations` | int ≥ 1 | Total loop iterations executed. |
| `converged` | boolean | Reviewer passed within budget. |
| `stopped` | boolean | User-initiated stop ended the run. |
| `terminalStatus` | enum | `converged \| best_effort \| failed \| stopped`. |
| `startedAt` / `endedAt` | Date | Turn wall-clock (SC-004 measurement window). |
| `steps` | TraceStep[] | The full ordered trace; returned only by the on-demand fetch. Retained in full under the loop budget — no truncation (Clarification Q3). |

**Validation / access rules**
- The run is written once, server-side, at turn end (success, best-effort, failure, and stop paths all persist what ran) — the live stream and the persisted run come from a single emitter.
- Read via `GET /api/projects/[id]/chat/runs/{runId}`, gated by project read access (any viewer — FR-006/SC-003); returns `steps` for on-demand expansion.
- Deleted with its conversation/project (same lifecycle as the thread; runs are not copied on project duplication, like the thread itself).

## AIConversation (extended)

```text
conversation
├── status: 'idle' | 'generating' | 'failed'        (unchanged)
├── stopRequested: boolean (default false)          NEW — set by POST /chat/stop; cleared at turn end
└── messages[]
    ├── ...existing fields (role, text, mcpCalls, editsApplied, indicative, error, createdAt)
    └── run summary (assistant messages only) — lightweight, so thread reads never load the trace:
        runId: ObjectId → GenerationRun             NEW — reference to the separate run doc; absent on pre-004 messages
        iterations: int                              NEW — total loop iterations executed
        converged: boolean                           NEW — reviewer passed within budget
        stopped: boolean                             NEW — user-initiated stop ended the run
        stepCount: int                               NEW — trace step count; drives the "Show working (N steps)" label without a fetch
```

**Validation rules**
- The summary fields and `runId` are set once, server-side, at turn end alongside the `GenerationRun` write.
- Messages created before 004 have no `runId` → UI hides the "Show working" affordance (spec assumption).
- `stopRequested` is only honored while `status === 'generating'`; cleared on every terminal path.

## State transitions

```text
idle ──POST message──▶ generating ──loop phases──▶ idle        (success / unsatisfiable / best-effort)
                        │  ▲                        └ failed    (architecture-phase error, unchanged 003 contract)
                        │  └── stale-lock guard (>90s) clears corpses (unchanged)
                        └──POST stop──▶ stopRequested=true ──checked between phases──▶ idle (stopped message + partial trace)
```

## Unchanged models

`Architecture`, `CostEstimate`, `CostEstimateOverride`, `Project`, `Export` — untouched (FR-007). The cost phase still runs after the loop converges, exactly as in 003.
