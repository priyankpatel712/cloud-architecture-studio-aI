# Contract: Generation Reliability (FR-001–FR-003)

Extends `specs/001-mvp-baseline/contracts/generation.md` — same endpoint
(`POST /api/projects/[id]/chat/messages`), same request/response envelope. This contract documents
only what's new or tightened for reliability (User Story 1).

## Failure response shape (tightened)

`502` failure body gains a `step` field so the client can render a specific message instead of a
generic one:

```
{
  error: string,
  retryable: boolean,
  step: 'architecture' | 'cost',
}
```

- `step: 'architecture'` — the AWS MCP call or the LLM edit-plan call failed. No architecture or cost
  change is persisted (unchanged behavior — the throw happens before any write, research R1).
- `step: 'cost'` — the architecture phase succeeded and **was already persisted**, but the cost phase
  (re-pricing, or the new cost-orchestrator step, research R8) failed. The client must show the
  updated diagram immediately and separately report the cost failure with its own retry, rather than
  hiding the successful architecture update behind the cost error.

`retryable: false` is reserved for configuration-cause failures (`AWS_MCP_COMMAND`/`LLM_API_KEY` not
set, `LlmError` with `retryable: false`) — the client MUST NOT offer a retry button for these; it
shows the reason and stops, since a retry is guaranteed to repeat it (research R1).

## Retry semantics (unchanged shape, restated as a hard guarantee)

Retry is just resending the identical `POST` body (`text`, `attachedTools`) the client already
cached (`ChatPanel.tsx`'s `retryText`). Because the architecture/cost phases only ever write
(`Architecture.updateOne` / `CostEstimate.create` / `CostEstimateOverride` upsert) **after** their
respective external calls succeed, a retry after a `step: 'architecture'` failure starts from
whatever was last successfully persisted — it cannot produce a duplicate or partial node/edge/cost
line (FR-003, SC-002). This must be covered by a driven test that forces a failure then a success and
asserts no duplicates, not just re-read from the code.

**Acceptance mapping**: US1/AC1–3, FR-001, FR-002, FR-003, SC-001, SC-002.
