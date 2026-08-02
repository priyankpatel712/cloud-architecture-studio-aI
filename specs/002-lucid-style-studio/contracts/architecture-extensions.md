# Contract: Architecture Payload Extensions (FR-005–007, FR-012–014, FR-017)

Extends feature 001's [projects contract](../../001-mvp-baseline/contracts/projects.md)
`PUT/GET /api/projects/[id]/architecture`. **No new endpoints** — the payload grows, backward
compatibly.

## `GET /api/projects/[id]/architecture` (via project load)

→ `200 { project, architecture: { nodes, edges, containers, annotations, guidance, version } }`

- `containers[]`: `{ containerId, type, label, position, size, parentContainerId }`
- `annotations[]`: `{ annotationId, kind, content, position, size, style }`
- `nodes[]` additionally carry `displayName?`, `containerId?`
- `edges[]` additionally carry `label?`, `style { geometry, pattern, arrowheads, color }`,
  `waypoints?[]`
- Pre-002 documents return `containers: []`, `annotations: []`, default edge styles.

## `PUT /api/projects/[id]/architecture`

Body: full extended document + `version` (001 optimistic concurrency unchanged).

- Validation (zod, server-side): container tree acyclic; membership references valid; style
  values from the enumerated token sets; sanity bounds on element counts/sizes.
  → `400 { error, details }` on violation.
- `409 { error: "conflict", currentVersion }` on stale version (unchanged from 001).
- On success: version bump; cost re-estimated **from service nodes only** (containers/annotations
  are cost-free); a `system` message summarizing the edit (including container/annotation changes)
  is appended to the project's chat thread (001 FR-016a).

## Chat orchestrator contract delta (R8)

The architecture context serialized for the 001 conversation orchestrator now includes
`containers` (typed structure) and `annotations` (non-service user notes). The orchestrator's
edit vocabulary gains container operations — create, set type/label, move membership,
restructure — recorded in the assistant message's `editsApplied`. Preserve-user-work (001
FR-014d) applies to container placement and memberships exactly as to nodes.

**Acceptance mapping**: US2/AC1–3, FR-005–007, FR-013–014, FR-017; edge cases "deleting a
container", "container cycle".
