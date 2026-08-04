# Phase 0 Research: Reliable AWS-MCP Generation with Attachable Services and Editable Cost Estimation

**Feature**: [spec.md](./spec.md) | **Branch**: `003-editable-cost-estimation`

This feature is brownfield: features 001 (MVP baseline) and 002 (Lucid-style studio) already
implement the chat orchestrator, official AWS MCP/cost-MCP adapters, and the canvas. Research here
is grounded in reading that actual code (`app/src/lib/generate/orchestrator.ts`,
`app/src/lib/providers/aws/*`, `app/src/app/api/projects/[id]/**`), not greenfield assumptions.

## R1: Root cause of "the AI chat is not working properly"

**Finding**: The orchestrator (`app/src/lib/generate/orchestrator.ts`) already has the structural
shape US1 asks for: per-provider MCP failures are caught and reported distinctly without failing
the whole turn (lines 348–361), and a hard LLM failure throws *before* any Architecture/CostEstimate
write, so a client retry cannot currently produce duplicate/partial output — FR-003 is already true
by construction, not something to newly build. The chat route already returns `{ error, retryable }`
on failure (`messages/route.ts` lines 81–98) and `ChatPanel.tsx` already has retry-button plumbing
(`retryText` state, lines 65/119/120/171-173).

Two things nonetheless point at real, live breakage, not just missing polish:
- `orchestrator.ts` carries multiple `console.log`/`console.error` debug traces around the LLM call
  (lines 367, 370, 405, 407, 409, 417) — the signature of an unresolved bug someone was actively
  chasing, left in place.
- The route does not distinguish a **configuration** failure (`AWS_MCP_COMMAND` /
  `LLM_API_KEY` unset → `McpUnavailableError` / non-retryable `LlmError`) from a **transient**
  failure (rate limit, network blip). Today both can surface as "retryable", so a user retries a
  failure that will deterministically repeat because a required env var is simply missing —
  this reads exactly like "the chat is not working."

**Decision**: Treat US1 as hardening + diagnosis, not a rewrite:
1. Remove the stray `console.log` debug statements and replace them with a single structured
   failure record per turn (see R2) so the next failure is diagnosable without ad-hoc logging.
2. Make the retryable/non-retryable distinction do real work end-to-end: a configuration-cause
   failure (`LlmError.retryable === false`, `McpUnavailableError`) must tell the user *why* in terms
   they can act on ("AWS generation isn't configured for this environment") instead of a generic
   "please retry" that will fail again identically.
3. Confirm empirically during implementation (via a driven test with a deliberately-broken
   `LLM_API_KEY`/`AWS_MCP_COMMAND`) that no duplicate architecture/cost documents are created across
   a fail→retry→succeed sequence — this is asserted by the current code path but must be verified,
   not just re-asserted in the spec.

**Alternatives considered**: A full rewrite of the orchestrator's failure handling was considered
and rejected — the existing shape (catch-before-persist, per-provider isolation) is already correct;
rebuilding it would violate the constitution's YAGNI/complexity guidance for no behavioral gain.

## R2: Modeling `GenerationAttempt` (spec Key Entity)

**Decision**: Do **not** add a new top-level `GenerationAttempt` collection. `AIConversation`
already tracks turn-level state (`status: 'idle'|'generating'|'failed'`) and each message already
records `mcpCalls[].status`. Extend the (assistant) message subdocument with an optional
`error?: { step: 'architecture'|'cost', retryable: boolean }` field. This satisfies the spec's
`GenerationAttempt` behavior (status, which step failed, retry-ability) without a parallel
collection to keep in sync — a data-model mapping choice, not a scope reduction.

**Rationale**: `AIConversation.messages` is already the durable, per-turn record of what happened;
adding a sibling collection would duplicate it. Constitution: "complexity must earn its place."

**Alternatives considered**: A dedicated `GenerationAttempt` collection (spec's literal entity name)
— rejected as redundant persistence for data `AIConversation` already owns.

## R3: Attach-duplicate merge rule (FR-005)

**Finding**: `orchestrator.ts`'s plan-application step (`validAdds` → `keptNodes.push(...)`, lines
520–541) always creates a new node for every planned add; it never checks whether a node with the
same `serviceId` already exists. The AWS catalog (`app/src/lib/providers/aws/catalog.ts`) already
gives several services a quantity-shaped config field (e.g. EC2's `count`, default 2, `min: 1`,
consumed by the pricing formula `rate * HOURS * num(c.count, 1)`), but not every service has one
(e.g. serverless services have no natural "quantity").

**Decision**: Before pushing a planned `add`, check for an existing node with the same `serviceId`
(same provider) not targeted by an explicit `remove`/`update` in this turn. If found and the service
declares a quantity field, increment that field by the requested amount (default 1) on the existing
node instead of creating a new one; if the service has no quantity field, treat a repeat "attach" of
an already-present service as a no-op update-in-place (apply any new `config` from the plan) rather
than a duplicate node. This requires each AWS catalog service definition to optionally declare which
config key is its quantity dimension (new `quantityField?: string` on the service definition) so
this merge logic and the cost-override quantity path (R9) share one source of truth.

**Alternatives considered**: Leaving dedup entirely to LLM prompting ("don't duplicate services") —
rejected; it already has "preserve user work" instructions and still has no deterministic dedup
check, so it cannot guarantee FR-005/SC-003 the way a code-level check can.

## R4: Two-phase turn ordering (FR-001, FR-006, Clarification 3)

**Finding**: The orchestrator already runs architecture-then-price sequentially in one function call
(MCP recommend → LLM plan → apply edits → `priceNodes`, lines 341–577) and the architecture
PUT route (`architecture/route.ts`) already re-prices synchronously on every direct edit. The
sequencing this feature's Clarification 3 asks for already exists at the code level for the
*existing* generate/edit paths.

**Decision**: Keep the existing single-request, two-internal-step shape (no separate async job/queue
for the "cost step") for both the initial generation and attach actions — it already matches the
clarified sequencing and avoids adding an async/eventing layer the spec's success criteria (SC-004:
sub-1-second override updates) don't require. What changes is what runs *inside* the cost step: it
gains override-instruction parsing (R8) and override-merge (R5) beyond plain re-pricing.

**Alternatives considered**: Splitting generation and pricing into two client-visible round trips
(diagram appears, then a follow-up request prices it) — rejected as unnecessary complexity; the
spec's own performance target (SC-004, ≤1s) and the constitution's 30s generation target are both
satisfied by the current synchronous-within-one-request shape.

## R5: Override persistence & precedence

**Decision**: Add a new `CostEstimateOverride` collection, one document per `(projectId, nodeId)`
(unique compound index), holding both `quantityOverride` and `totalCostOverride` independently (per
Clarification 2, both may be set; quantity wins). This is **not** folded into the existing
`CostEstimate` collection, because `CostEstimate` is an append-only per-turn snapshot log (a new
document is `create()`d on every generation/edit — see `messages/route.ts` line 137 and
`architecture/route.ts` line 109) with no unique-per-project document to durably hold state on. A
snapshot log cannot be the source of truth for something that must survive and be *reapplied* across
every future snapshot (FR-013). `CostEstimateOverride` is read and merged into the freshly computed
`perService` list every time a `CostEstimate` snapshot is produced, immediately before persisting
that snapshot and before denormalizing `Project.currentEstimateMonthly`.

**Alternatives considered**: Embedding overrides as a field on `Architecture.nodes[]` — rejected,
it would re-couple the cost layer to the diagram document that Clarification 1 explicitly decoupled
it from (FR-015); a service's diagram node must stay untouched by a cost-only action.

## R6: Diagram/cost decoupling enforcement (FR-015)

**Decision**: Enforce decoupling structurally, not just by convention: no code path that writes a
`CostEstimateOverride` may also call `Architecture.updateOne`/`.save()`, and vice versa. The merge
step (R5) only ever produces an in-memory adjusted `perService` array and a `CostEstimate` snapshot;
it never touches `ServiceNode.config`. This is enforced by keeping override-merge in its own pure
function (`lib/generate/overrides.ts`) that takes priced nodes + overrides and returns priced nodes —
it has no reference to the `Architecture` model at all, so it cannot accidentally write to it.

## R7: Standalone estimate export (FR-016, User Story 4)

**Finding**: `export/route.ts` already serializes `mermaid`/`json` server-side and treats `png`/`pdf`
as client-rendered-from-canvas with a server-side audit record only (`ExportRecord.create`). There is
no diagram-independent code path today — every existing export reads `Architecture`.

**Decision**: Add a new format value `estimate` to the existing `FORMATS` tuple and route. Unlike
`png`/`pdf` (client-rendered from the canvas), `estimate` is server-serialized like `mermaid`/`json`
today: it reads `CostEstimateOverride` + the latest `CostEstimate` snapshot (not `Architecture` at
all) and returns a JSON document (line items, overridden vs computed marking, stale flags, totals)
that the existing client export flow can hand to the same PDF-rendering path used for other formats,
producing a client-facing proposal document that never touches diagram data. This reuses the existing
export audit trail (`ExportRecord`) and route shape rather than introducing a parallel export
subsystem.

**Alternatives considered**: A wholly separate "proposal" feature/route — rejected; feature 001
already established one export endpoint with a format switch, and `estimate` is a natural addition
to it, not a new subsystem (FR-016 explicitly frames this as extending FR-024).

## R8: Chat-driven cost overrides (FR-008a)

**Decision**: Add a second, small, cost-only LLM step (`lib/generate/cost-orchestrator.ts`) that runs
*after* the existing architecture step, only against the resulting priced architecture — never given
write access to nodes/edges/containers. Its schema is narrow: `{ overrides: [{ nodeRef, field:
'quantity'|'totalCost', value }], clarificationNeeded: boolean, clarificationQuestion?: string }`.
This runs unconditionally as part of the same `POST /chat/messages` turn (immediately after
`priceNodes`), so a single user message can attach a service AND request a cost change in one turn,
consistent with Clarification 3's "both steps can be independently modified via chat" — but its
output can only ever produce `CostEstimateOverride` writes, never `Architecture` writes, keeping R6's
decoupling intact even under LLM control. `nodeRef` resolves the same way `add`/`edges` resolve today
(existing `nodeId`, or `new:<index>` into this turn's newly-added nodes) so a single message like
"add an EC2 instance and set its cost to $200/month" works in one turn.

If `clarificationNeeded` is true (ambiguous target/field), the turn's reply uses the assistant's
`clarificationQuestion` and **no** override is written that turn (Edge Case: ambiguous chat
cost-change instruction).

**Alternatives considered**: Folding cost-override intent into the existing architecture
`PLAN_SCHEMA` — rejected; it would let one LLM call produce both diagram edits and cost overrides
from the same JSON object, making the code-level decoupling guarantee (R6) dependent on careful
field-by-field discipline in one large schema instead of two schemas that are structurally incapable
of touching each other's data.

## R9: Quantity override target field

**Decision**: A quantity override targets the catalog service definition's declared quantity field
(new `quantityField?: string` on `AWS_SERVICES` entries, e.g. `'count'` for `aws-ec2`; introduced in
R3). Services with no declared quantity field only support the flat total-cost override; the
inline-edit UI and the chat cost-orchestrator both hide/reject a quantity override for such services
(validation error, FR-011). This keeps "quantity" meaningful (it recomputes through the same pricing
formula the service already uses) instead of introducing a second, disconnected notion of quantity.

## R10: Permission model for overrides (FR-014)

**Finding**: The codebase has no "edit-access collaborator" tier today — `Project.canEditProject`
(`app/src/lib/models/Project.ts`) is owner-only; every `sharedWith` user is read-only. This is
simpler than the spec's Assumptions section anticipated ("owner and any collaborator granted edit
access").

**Decision**: Reuse `canEditProject` unchanged as the override permission gate. "Edit access" in
FR-014 resolves to "the project owner" today; if a future feature introduces a distinct
editor-collaborator tier, override permission inherits it automatically since it delegates to the
same function everything else already uses for diagram writes. No new permission tier is introduced
by this feature.

## R11: Stale-override flagging (FR-012)

**Decision**: An override is flagged stale by comparing a hash/snapshot of the relevant config fields
(the node's full `config` object, since any field could affect the official price) at override-set
time against the current `config` at read time; store `configSnapshot: Record<string, string|number>`
on `CostEstimateOverride` for this comparison. Recomputed on every read (cost-panel load, chat turn,
export), not persisted as a boolean that could drift — a boolean flag would need its own
invalidation logic; a snapshot comparison is self-correcting.
