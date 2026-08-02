# Phase 1 Data Model — Lucidchart-Grade Studio Diagramming

All changes are **backward-compatible extensions of feature 001's `Architecture` embedded
document** (`app/src/lib/models/Architecture.ts`). No new collections; the single-document save
keeps 001's optimistic `version` concurrency and chat-context sync boundaries intact (FR-017).
Documents saved before this feature load unchanged — every new field is optional with a default.

## Architecture (extended)

| Field | Type | Notes |
|-------|------|-------|
| nodes | ServiceNode[] | extended below |
| edges | ServiceEdge[] | extended below |
| **containers** | Container[] | **NEW** — typed boundaries (FR-005–007) |
| **annotations** | Annotation[] | **NEW** — notes/stickies (FR-014) |
| guidance, version, projectId, generatedFrom | — | unchanged from 001 |

### Container *(new, embedded)*

| Field | Type | Notes |
|-------|------|-------|
| containerId | string | unique within architecture |
| type | 'group' \| provider-declared type id | typed boundaries (region, vpc, subnet, az, cluster) come from the **provider plugin catalog** (Constitution II), 'group' is generic |
| label | string | user-editable |
| position | { x, y } | canvas coordinates |
| size | { width, height } | resizable |
| parentContainerId | string \| null | nesting; cycles rejected at validation (edge case) |

Rules: deleting a container prompts keep/delete members; "keep" re-parents members to
`parentContainerId` (or canvas root). A container carries **no cost** and is never sent to
providers as a service. The AI assistant may create/modify/restructure containers (R8,
Clarification 2026-07-06) under 001's preserve-user-work rule.

### Annotation *(new, embedded)*

| Field | Type | Notes |
|-------|------|-------|
| annotationId | string | unique within architecture |
| kind | 'text' \| 'sticky' | |
| content | string | plain text |
| position / size | { x, y } / { width, height } | |
| style | { color?: token } | constrained token set, no arbitrary CSS |

Rules: excluded from cost totals and provider semantics (FR-014); serialized to the chat context
as user notes, clearly non-service (R8).

### ServiceNode (extended)

| New Field | Type | Notes |
|-----------|------|-------|
| displayName | string? | shown on diagram; catalog service + pricing unchanged (FR-013) |
| containerId | string? | membership; kept consistent with container tree on save |

### ServiceEdge (extended)

| New Field | Type | Notes |
|-----------|------|-------|
| label | string? | edge label (FR-012) |
| style.geometry | 'orthogonal' \| 'straight' \| 'curved' | default 'orthogonal' (Clarification) |
| style.pattern | 'solid' \| 'dashed' | default 'solid' |
| style.arrowheads | 'none' \| 'end' \| 'both' | default 'end' |
| style.color | token | constrained palette token, not raw color |
| waypoints | { x, y }[]? | manual path adjustments, preserved where possible (FR-002) |

## Validation (server-side, zod — extends 001 R10)

- Container tree: `parentContainerId` must reference an existing container; **no cycles**;
  `nodes[].containerId` must reference an existing container or be absent.
- Style values restricted to the enumerated tokens above (no free-form styling).
- Annotations/containers accepted only within the same size/count sanity bounds as nodes
  (guards SC-004 scale).

## State & sync notes

- Every mutation (container membership, annotation edit, style change, auto-arrange result) is one
  more `PUT /api/projects/[id]/architecture` save: version bump, cost re-estimate (service changes
  only), system message appended to the project thread (001 FR-016a / 002 FR-017).
- Undo/redo and clipboard are session-scoped client state; the persisted document is always the
  post-operation result.
