# Phase 1 Data Model: Reliable AWS-MCP Generation with Attachable Services and Editable Cost Estimation

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

This extends the existing MongoDB/Mongoose models from `001-mvp-baseline` and
`002-lucid-style-studio` (`app/src/lib/models/*`). Only genuinely new or changed shapes are shown;
everything else (User, Connection, Export) is unchanged.

## CostEstimateOverride (new collection)

`app/src/lib/models/CostEstimateOverride.ts`

One document per overridden cost line item. Read and merged into every freshly computed
`perService` list before it becomes a `CostEstimate` snapshot (research R5); never referenced by, or
referencing, `Architecture` beyond the plain `nodeId` string (research R6 — decoupling).

| Field | Type | Notes |
|---|---|---|
| `projectId` | ObjectId (ref Project) | Indexed; scopes the override, per constitution ("every user-owned entity is scoped"). |
| `ownerId` | ObjectId (ref User) | Denormalized owner, for server-side access checks without a Project lookup. |
| `nodeId` | string | The `ServiceNode.nodeId` this override targets. Compound-unique with `projectId`. |
| `quantityOverride` | number \| null | Overrides the service's quantity-shaped config field (research R9). `null` = not set. |
| `totalCostOverride` | number \| null | Fixed monthly cost for this line item. `null` = not set. Precedence: `quantityOverride` wins when both are set (Clarification 2). |
| `configSnapshot` | Mixed (`Record<string,string\|number>`) | The node's `config` at the moment the override was last set/confirmed; compared against current `config` to derive the "possibly outdated" flag (research R11, FR-012) — computed on read, not stored as a boolean. |
| `source` | enum `'inline' \| 'chat'` | How the override was set (FR-008a) — surfaced in the UI/export, not behavior-affecting. |
| `setBy` | ObjectId (ref User) | Who set the current value (FR-014 — edit-access users only). |
| `setAt` | Date | For display and audit; not used for precedence. |

Validation (FR-011, enforced at the API boundary via `zod`, mirroring `schemas.ts` conventions):
- `quantityOverride`, when present, must be a finite number `> 0`.
- `totalCostOverride`, when present, must be a finite number `>= 0`.
- At least one of `quantityOverride`/`totalCostOverride` must be non-null on create; clearing both
  is expressed as deleting the document (reset to system-computed, FR-009), not as a doc with both
  null.

Lifecycle:
- Created/updated by the inline override endpoint or the chat cost-orchestrator (research R8).
- Deleted when the user resets the line item (FR-009), or automatically when the referenced node is
  removed from the architecture (FR-013, edge case "overridden line item's service is later
  removed") — enforced by deleting any `CostEstimateOverride` whose `nodeId` is no longer present in
  `Architecture.nodes` whenever nodes are removed (attach-merge, direct edit, or chat edit).

## GenerationAttempt (conceptual — mapped onto AIConversation, not a new collection)

Per research R2, the spec's `GenerationAttempt` entity is realized as an extension of the existing
`AIConversation` message subdocument (`app/src/lib/models/AIConversation.ts`), not a new collection:

```
messageSchema += {
  error?: {
    step: 'architecture' | 'cost',   // which phase failed (FR-002)
    retryable: boolean,              // config failure (false) vs transient (true) — research R1
  }
}
```

`AIConversation.status` (`'idle' | 'generating' | 'failed'`) already carries the attempt-level state
machine; `messages[].mcpCalls[].status` already carries per-provider MCP success/failure. The new
`error` field is the only addition, populated only on assistant messages produced by a failed turn.

## AWS service catalog (extended)

`app/src/lib/providers/aws/catalog.ts` — each service definition gains an optional field (research
R3/R9):

```
quantityField?: string   // e.g. 'count' for aws-ec2; absent = no quantity dimension
```

Used by: (a) the attach-merge dedup check (increment this field instead of creating a duplicate
node, FR-005), and (b) the quantity-override path (only offered/accepted for services that declare
one, FR-008/FR-011).

## CostEstimate (unchanged shape, changed write path)

`app/src/lib/models/CostEstimate.ts` keeps its existing shape (it's an append-only per-turn
snapshot). What changes is that its `perService[]` values are now the *post-override* merged values
(computed cost overridden where a `CostEstimateOverride` exists), and each `perService` entry gains
two optional passthrough fields for the UI/export to render override state without a second query:

```
perServiceSchema += {
  overridden: { type: Boolean, default: false },
  stale: { type: Boolean, default: false },
}
```

`basis` continues to reflect provider pricing exactness (`exact`/`indicative`) and is unaffected by
whether a line is overridden — an overridden line's `basis` reports what the value *would have been*
computed from, so a reset always has a sensible number to revert to.

## Architecture (unchanged)

No schema change. Per FR-015/research R6, `ServiceNode.config`/`cost`/`costBasis` are never written
by an override — they continue to reflect the system-computed design exactly as feature 001/002 left
them.

## Project (unchanged)

`canEditProject` (owner-only, per research R10) is reused unchanged as the override permission gate.

## Relationships

```
Project 1──1 Architecture         (unchanged)
Project 1──1 AIConversation        (unchanged; messages[].error is new)
Project 1──N CostEstimate          (unchanged; append-only snapshots)
Project 1──N CostEstimateOverride  (NEW; one per overridden ServiceNode.nodeId)
Architecture.nodes[].nodeId ──── CostEstimateOverride.nodeId   (loose reference by string id,
                                                                 never a populated ref — R6)
```
