# Contract: Editable Cost Estimation (FR-007–FR-016)

Follows the conventions in `specs/001-mvp-baseline/contracts/README.md` (session auth, `{ "error" }`
on failure, zod validation at the boundary, `runtime = 'nodejs'`). Overrides are edit-access-only
(FR-014) — `getProjectForWrite` + `canEditProject` (owner-only today, research R10) gate every write
below; read-only shared users get `403` on write endpoints and see override state on the existing
read endpoints.

## `PATCH /api/projects/[id]/cost-overrides`

Set or clear an inline override on one cost line item (User Story 3, AC1–3, AC6).

Body:
```
{
  nodeId: string,
  quantityOverride?: number,   // > 0; omit/null with clear:false to leave unchanged
  totalCostOverride?: number,  // >= 0; omit/null with clear:false to leave unchanged
  clear?: boolean,             // true = delete the override for this nodeId (reset, FR-009)
}
```

Rules:
- `nodeId` must reference a node in the project's current `Architecture`; unknown `nodeId` → `404`.
- `quantityOverride` is only accepted for services whose catalog definition declares a
  `quantityField` (data-model.md); otherwise `422 { error: "this service has no overridable quantity" }`.
- Invalid numeric input (negative, non-numeric, zero for quantity) → `400` with a field-specific
  message (FR-011); the existing override, if any, is left untouched.
- On success: upserts `CostEstimateOverride`, sets `configSnapshot` to the node's current `config`
  (clearing the stale flag — FR-012), recomputes the project's `CostEstimate` (merging all overrides,
  research R5) and returns it.
- `clear: true` deletes the `CostEstimateOverride` document for that `nodeId` and recomputes.

→ `200 { estimate: { monthly, annual, perService: [{ nodeId, serviceId, cost, basis, overridden, stale }] } }`

**Acceptance mapping**: US3/AC1–3/AC6, FR-008, FR-009, FR-010, FR-011, FR-014.

## Chat-driven overrides — extension of `POST /api/projects/[id]/chat/messages`

No new endpoint; the existing chat-turn endpoint (`specs/001-mvp-baseline/contracts/generation.md`)
gains a second internal phase (research R4/R8), unconditionally run after the architecture phase on
every turn:

1. **Architecture phase** (existing, unchanged): official AWS MCP → LLM edit plan → apply → price.
2. **Cost phase** (new): a narrow LLM call (`lib/generate/cost-orchestrator.ts`) given the
   just-priced architecture and the same user message, may emit `{ overrides: [{ nodeRef, field,
   value }], clarificationNeeded, clarificationQuestion }`. `nodeRef` resolves against existing
   `nodeId`s and this turn's `new:<index>` adds, exactly like the architecture phase's edge
   resolution — so "add an EC2 instance and set its cost to $200/month" resolves in one turn.
   - Each resolved override is written the same way the PATCH endpoint above would (same validation,
     same `source: 'chat'`).
   - If `clarificationNeeded`, no override is written this turn and the assistant's reply is the
     `clarificationQuestion` (Edge Case: ambiguous chat cost-change instruction) instead of a normal
     summary.
   - This phase **only** ever calls the override read/merge/write path — it has no access to
     `Architecture`'s update path (research R6).

Response shape is unchanged (`{ message, architecture, estimate, conversation }`); `estimate.perService`
now includes `overridden`/`stale` per line, same as the PATCH endpoint.

**Acceptance mapping**: US3/AC7, FR-008a; Edge Case "ambiguous chat cost-change instruction".

## Attach-merge dedup — extension of the architecture phase (FR-004–FR-006)

Also within `POST /api/projects/[id]/chat/messages` and the direct-catalog path
(`PUT /api/projects/[id]/architecture`, unchanged endpoint): before a planned `add` becomes a new
node, the orchestrator checks for an existing node with the same `serviceId`/`provider` (research
R3). If found: increments that node's `quantityField` (if the service declares one) or applies the
plan's `config` in place (if it doesn't), rather than pushing a new node — satisfying FR-005/SC-003
without a new endpoint.

**Acceptance mapping**: US2/AC1–3, FR-004, FR-005, FR-006.
