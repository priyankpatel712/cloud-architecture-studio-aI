# Phase 0 Research — Lucidchart-Grade Studio Diagramming

Decisions resolving the technical choices for feature 002. Constitution Principle I (official
integrations first) governs; the single community dependency is justified in R4 and plan.md.

## R1. Orthogonal auto-routed connections (FR-001, FR-002)

- **Decision**: A custom React Flow edge component (`OrthogonalEdge`) with an in-house routing
  utility (`lib/canvas/routing.ts`): orthogonal path computation that avoids node bounding boxes
  where a clear channel exists, degrades to a best-effort path when none does (spec edge case),
  and re-computes on endpoint move. Manual waypoints are stored on the edge and respected during
  re-route where geometrically possible. Straight/curved variants map to React Flow's official
  straight/bezier paths. Default geometry: orthogonal (Clarification 2026-07-06).
- **Rationale**: React Flow officially supports custom edges and ships step/smoothstep primitives,
  but no obstacle-avoiding router; the routing math is small, pure, and unit-testable in-house.
- **Alternatives rejected**: `react-flow-smart-edge` community package (unmaintained, violates I
  without necessity); plain smoothstep only (fails "avoid shapes" in FR-001); libavoid/WASM
  routers (heavyweight for MVP scale).

## R2. Containers as React Flow subflows (FR-005–007)

- **Decision**: Containers are React Flow **parent nodes** (official subflow support: `parentId`,
  `extent: 'parent'`) rendered by a `ContainerNode` component with label + type badge. Nesting =
  parent chains; drag-in/out updates `parentId`; moving a parent moves children (official
  behavior). Cycle prevention enforced in the drop handler (spec edge case). Delete prompts
  keep/delete members; "keep" re-parents to the enclosing container or canvas root.
- **Rationale**: Subflows are first-class official React Flow functionality — no new dependency.
- **Alternatives rejected**: Custom grouping layer outside React Flow's node tree (fights the
  library, breaks move-with-contents); visual-only rectangles (no membership semantics, fails
  FR-007's structure-for-AI requirement).

## R3. Snap, alignment guides, align/distribute (FR-003, FR-004)

- **Decision**: Grid snapping via React Flow's official `snapToGrid`/`snapGrid` (toggleable,
  default on). Live alignment guides via an in-house `lib/canvas/guides.ts` (edge/center proximity
  math against sibling nodes, rendered by an `AlignmentGuides` overlay on `onNodeDrag`).
  Align/distribute are pure transforms in `lib/canvas/align.ts` applied as one undoable step.
- **Rationale**: snapToGrid is official; helper-lines is an official React Flow example pattern —
  small, pure math implemented in-house rather than a dependency.
- **Alternatives rejected**: Guide/snap libraries (unnecessary dependency for ~150 lines of math).

## R4. Auto-arrange via elkjs (FR-018) — justified community dependency

- **Decision**: `elkjs` (Eclipse Layout Kernel, EPL-2.0) behind an adapter
  (`lib/canvas/layout.ts`) mapping nodes/edges/containers to an ELK hierarchical graph
  (`elk.layered`) and back. Whole-diagram or selection scope; container members stay inside their
  containers; applied as a single undoable step. Runs client-side (web worker if needed for
  SC-004).
- **Rationale**: FR-018 requires container-aware automatic layout. No official React Flow layout
  engine exists; ELK is the maintained standard for hierarchical graph layout and React Flow's
  own documentation uses it as the reference integration. Constitution I permits a community
  dependency when no official option exists, justified here and in plan.md Complexity Tracking.
- **Alternatives rejected**: dagre (unmaintained, no container hierarchy); hand-rolled layered
  layout (large effort, worse quality); server-side layout (adds latency + server CPU for a
  purely visual operation).

## R5. Minimap, zoom controls, find (FR-015)

- **Decision**: Official React Flow `MiniMap` + `Controls` (fit-view), plus an in-house find box
  filtering nodes by display/catalog name and centering via the official `fitView`/`setCenter`
  APIs. Zoom-to-selection via `fitView({ nodes: selection })`.
- **Rationale**: Entirely official APIs.
- **Alternatives rejected**: none needed.

## R6. Clipboard, duplicate, shortcuts, context menu (FR-008–011)

- **Decision**: In-house `lib/canvas/clipboard.ts` — an in-memory, **project-scoped** clipboard
  (Clarification 2026-07-06: same project only) that deep-copies selected nodes/edges/containers
  with new ids and a paste offset; duplicate = copy+paste in one step; modifier-drag duplicate on
  React Flow's drag events. Shortcuts registered in the studio (delete, nudge/±large step,
  select-all, copy/paste/duplicate, undo/redo, zoom in/out, fit, spacebar-pan + scroll zoom) with
  an in-app `ShortcutsHelp` reference. Context menu is a positioned panel keyed by element type.
- **Rationale**: All achievable on official React Flow selection/drag APIs; OS clipboard is
  deliberately not used (avoids permission prompts and cross-project semantics ruled out by the
  clarification).
- **Alternatives rejected**: OS clipboard integration (cross-project scope explicitly deferred);
  hotkey libraries (native listeners suffice).

## R7. Architecture document extensions (FR-005–007, FR-012–014, Key Entities)

- **Decision**: Extend the feature 001 `Architecture` embedded schema, backward compatibly:
  `containers[]` (id, type, label, position, size, parentContainerId), `annotations[]` (id, kind
  text|sticky, content, position, size, style), `ServiceEdge` gains `label?`, `style?` (geometry
  orthogonal|straight|curved, pattern solid|dashed, arrowheads, color token), `waypoints?[]`;
  `ServiceNode` gains `displayName?` and `containerId?`. Documents without the new fields load
  unchanged (defaults). Same optimistic `version` concurrency; zod schemas extended server-side.
- **Rationale**: One document keeps save/version/conflict semantics from 001 intact (FR-017).
- **Alternatives rejected**: Separate collections for containers/annotations (splits the version
  boundary, breaks single-save conflict semantics).

## R8. Chat-context + AI container authority (FR-007, Clarification)

- **Decision**: The serialized architecture context sent to the 001 chat orchestrator now includes
  containers (typed structure) and annotations (as user notes, clearly non-service); the
  orchestrator's edit vocabulary gains container operations (create/type/label/move-membership/
  restructure) under 001's preserve-user-work rule. Generated container placements go through the
  same layout defaults, and `editsApplied` records container changes.
- **Rationale**: Clarification granted full container authority; containers are the visual form of
  the network topology the assistant already designs (001 FR-014).
- **Alternatives rejected**: Read-only containers for AI (rejected in clarification).

## R9. Export pipeline extensions (SC-005 tiers)

- **Decision**: PNG/PDF remain canvas captures — pixel-faithful automatically. JSON serializer
  emits the full extended document (round-trippable). Mermaid serializer emits containers as
  nested `subgraph` blocks with node/edge labels; waypoints/colors/positions are not encoded
  (structure-faithful tier per Clarification 2026-07-06).
- **Rationale**: Matches the tiered-fidelity clarification and each format's actual capability.
- **Alternatives rejected**: Failing Mermaid export when styling present (hostile); encoding
  style comments in Mermaid (noise with no renderer support).

## R10. Performance at SC-004 scale (100 nodes / 20 containers)

- **Decision**: Memoized custom nodes/edges; routing recomputed only for edges whose endpoints
  moved; guides computed against viewport-visible siblings only; elkjs in a web worker if
  main-thread runs exceed ~50ms; React Flow's `onlyRenderVisibleElements` for large diagrams.
- **Rationale**: Standard React Flow scaling practice; keeps SC-004's "instant feedback" testable.
- **Alternatives rejected**: Canvas-rendering rewrite (out of proportion for the target scale).

All NEEDS CLARIFICATION from Technical Context are resolved above.
