---
description: "Task list for Lucidchart-Grade Studio Diagramming"
---

# Tasks: Lucidchart-Grade Studio Diagramming

**Input**: Design documents from `specs/002-lucid-style-studio/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/. **Feature 001 must be
implemented first** — this feature extends 001's studio persistence (001 T027–T032), chat
orchestrator (001 T019–T026), and export pipeline (001 T045–T047); tasks below that touch those
areas are gated on them.

**Tests**: Not TDD-mandated; unit tests for the pure `lib/canvas/*` logic and export round-trip are
Polish tasks. Flow verification per Constitution V is the primary gate (quickstart.md).

**Organization**: Grouped by user story. All paths are under `app/` (single Next.js project).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add `elkjs` to `app/package.json` (auto-layout; the justified community dependency per plan.md Complexity Tracking / research.md R4). No other new dependencies.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Blocks all user stories. Extends 001's model, validation, and studio load/save.

- [X] T002 Extend the `Architecture` schema in `app/src/lib/models/Architecture.ts` per data-model.md: embedded `containers[]` (containerId, type, label, position, size, parentContainerId), `annotations[]` (annotationId, kind, content, position, size, style), `ServiceEdge` + `label?`/`style{geometry,pattern,arrowheads,color}`/`waypoints?[]`, `ServiceNode` + `displayName?`/`containerId?` — all optional with defaults (backward compatible).
- [X] T003 Extend the zod schemas + `PUT /api/projects/[id]/architecture` validation in `app/src/app/api/projects/[id]/architecture/route.ts` per contracts/architecture-extensions.md: acyclic container tree, valid membership references, enumerated style tokens, element-count sanity bounds; cost re-estimation reads **service nodes only**.
- [X] T004 [P] Declare provider container types in the plugin catalogs (`app/src/lib/providers/aws/catalog.ts`: region, vpc, subnet, az; `app/src/lib/providers/mongodb/catalog.ts`: cluster) and expose them via `app/src/lib/providers/registry.ts` so core canvas code reads types from the registry (Constitution II).
- [X] T005 [P] Create shared canvas model utilities `app/src/lib/canvas/model.ts`: typed mapping between the extended Architecture document and React Flow nodes/edges (containers → parent nodes, annotations → annotation nodes, edge style/waypoints), used by studio load/save.

**Checkpoint**: Extended document persists round-trip through 001's save/version pipeline.

---

## Phase 3: User Story 1 - Precise layout without fiddling (Priority: P1) 🎯 MVP

**Goal**: Orthogonal auto-routing, snap + live guides, align/distribute. **Independent Test**:
drag connected shapes — edges re-route and stay attached; guides appear and snap; align/distribute
work as single undo steps (quickstart US1).

- [X] T006 [P] [US1] Orthogonal routing utility `app/src/lib/canvas/routing.ts` — right-angle path computation avoiding node bounds where a clear channel exists, best-effort otherwise (never disappears), waypoint preservation on endpoint moves (FR-001, FR-002; research R1).
- [X] T007 [P] [US1] Alignment/snap math `app/src/lib/canvas/guides.ts` — edge/center proximity guides against sibling nodes + snap thresholds (FR-003; research R3).
- [X] T008 [P] [US1] Align/distribute transforms `app/src/lib/canvas/align.ts` — align left/center/right/top/middle/bottom (≥2), distribute horizontal/vertical (≥3), pure functions (FR-004).
- [X] T009 [US1] Custom edge component `app/src/components/studio/OrthogonalEdge.tsx` — renders orthogonal (default) / straight / curved geometry from `style.geometry`, draggable segments producing waypoints, uses `routing.ts` (FR-001, FR-002; Clarification: orthogonal default with per-edge choice).
- [X] T010 [US1] Wire snap + guides into the canvas: `snapToGrid` toggle (default on) and `app/src/components/studio/AlignmentGuides.tsx` overlay driven by `guides.ts` on node drag/resize in `app/src/components/studio/Canvas.tsx` (FR-003).
- [X] T011 [US1] Align/distribute UI on the studio toolbar in `app/src/components/studio/Canvas.tsx` (selection-aware buttons), each applied as one undoable step (FR-004, FR-016).

**Checkpoint**: The canvas feels professional: routed edges, guides, one-command alignment.

---

## Phase 4: User Story 2 - Cloud boundary containers (Priority: P1)

**Goal**: Typed, nestable containers that persist, export, and are visible to the AI.
**Independent Test**: build region→VPC→subnets, drag services in, move/delete containers, export,
chat about the grouping (quickstart US2).

- [X] T012 [P] [US2] Container node component `app/src/components/studio/ContainerNode.tsx` — labeled boundary with type badge (types from the provider registry per T004), resizable, nesting-aware rendering (FR-005).
- [X] T013 [US2] Container interactions in `app/src/components/studio/Canvas.tsx` — create/draw container, drag-in/drag-out membership via React Flow parent nodes (`parentId`, `extent`), move-with-contents, nesting, cycle prevention on drop (FR-005, FR-006; research R2; edge case "container into own descendant").
- [X] T014 [US2] Container deletion flow — prompt "delete contents too / keep contents"; keep re-parents members to the enclosing container or canvas root; single undoable step (FR-006; edge case).
- [X] T015 [US2] Chat-context + orchestrator container authority: include `containers`/`annotations` in the serialized architecture context and add container operations (create, set type/label, move membership, restructure) to the orchestrator's edit vocabulary in `app/src/lib/generate/orchestrator.ts`, recorded in `editsApplied`, under 001's preserve-user-work rule (FR-007; research R8; Clarification). *Gated on 001 T022.*
- [X] T016 [US2] Export extensions in `app/src/lib/export/serialize.ts` — Mermaid: containers as nested `subgraph` blocks with node/edge labels; JSON: full round-trippable extended document per contracts/export-fidelity.md (FR-007, SC-005). *Gated on 001 T045.*

**Checkpoint**: Honest topology diagrams — persisted, exported, AI-aware.

---

## Phase 5: User Story 3 - Fast editing interactions (Priority: P2)

**Goal**: Multi-select, copy/paste/duplicate, shortcuts, context menus. **Independent Test**:
duplicate a configured service via keyboard and modifier-drag, nudge, delete, open shortcut help
(quickstart US3).

- [X] T017 [P] [US3] Project-scoped clipboard `app/src/lib/canvas/clipboard.ts` — deep-copy selected nodes/edges/containers with new ids + paste offset; duplicate = copy+paste; copies keep configuration and trigger cost re-estimation (FR-009; research R6; Clarification: same project only).
- [X] T018 [US3] Multi-select + modifier-drag duplicate in `app/src/components/studio/Canvas.tsx` — marquee and shift-click selection operating as a unit (move/delete/duplicate/style/align); Alt/Option-drag duplicates via `clipboard.ts` (FR-008, FR-009).
- [X] T019 [US3] Keyboard shortcuts per contracts/canvas-interactions.md — delete, arrow nudge (+Shift large step), select-all, copy/paste/duplicate, undo/redo, zoom in/out, fit, spacebar-hold pan + scroll zoom — plus `app/src/components/studio/ShortcutsHelp.tsx` in-app reference opened with `?` (FR-010).
- [X] T020 [US3] Context menu `app/src/components/studio/CanvasContextMenu.tsx` — per-element-type actions (canvas / service / connection / container / annotation) per contracts/canvas-interactions.md (FR-011).

**Checkpoint**: Editing speed matches the benchmark.

---

## Phase 6: User Story 4 - Style and annotate (Priority: P2)

**Goal**: Edge labels/styles, display names, notes/stickies — zero cost impact. **Independent
Test**: label + dash a connection, rename a node, add a sticky; totals unchanged; all persists and
undoes (quickstart US4).

- [X] T021 [P] [US4] Annotation component `app/src/components/studio/AnnotationNode.tsx` — text note + sticky variants, inline editing, constrained style tokens, movable/resizable (FR-014).
- [X] T022 [US4] Connection label + style controls — label editing and style panel (pattern solid/dashed, arrowheads, color token, geometry orthogonal/straight/curved) rendered by `OrthogonalEdge.tsx` and wired to the studio inspector in `app/src/components/studio/Canvas.tsx` (FR-012).
- [X] T023 [US4] Service display names — rename via inspector/double-click in `app/src/components/studio/Canvas.tsx`, stored as `displayName` with catalog identity and pricing untouched; find/search (T026) matches both names (FR-013).
- [X] T024 [US4] Cost-neutrality guard — assert containers/annotations never enter pricing requests or provider MCP payloads (server check in `app/src/app/api/pricing/route.ts` + orchestrator serialization), and their edits are recorded as system messages (FR-014, FR-017).

**Checkpoint**: Presentable, self-explanatory diagrams.

---

## Phase 7: User Story 5 - Navigate large diagrams (Priority: P3)

**Goal**: Minimap, fit, zoom-to-selection, find. **Independent Test**: on a 40+ node diagram,
navigate via minimap, fit, and find-by-partial-name (quickstart US5).

- [X] T025 [P] [US5] Navigation panel `app/src/components/studio/MiniMapPanel.tsx` — official React Flow MiniMap (toggleable, viewport indicator, click-to-navigate) + Controls with fit-to-view and zoom-to-selection (FR-015; research R5).
- [X] T026 [US5] Find box in `app/src/components/studio/MiniMapPanel.tsx` — partial-match search over display + catalog names, result list, Enter centers and highlights the node via `setCenter` (FR-015).

**Checkpoint**: Large generated architectures stay manageable.

---

## Phase 8: User Story 6 - Auto-arrange (Priority: P3)

**Goal**: One-command container-aware tidy. **Independent Test**: auto-arrange a messy generated
diagram — clean, container-respecting, one undo step; selection-scoped variant (quickstart US6).

- [X] T027 [P] [US6] elkjs layout adapter `app/src/lib/canvas/layout.ts` — map nodes/edges/containers to `elk.layered` hierarchical graph and back; whole-diagram or selection scope; members stay inside containers; run in a web worker if main-thread time exceeds ~50ms (FR-018; research R4, R10).
- [X] T028 [US6] Auto-arrange UI — toolbar button + context-menu entry in `app/src/components/studio/Canvas.tsx`, applied as a single undoable step; selection-scoped when a selection exists (FR-018; edge case "auto-arrange vs preserved work" — explicit user action, one undo).

**Checkpoint**: Post-generation cleanup is one click.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T029 [P] Unit tests for pure logic in `app/src/lib/canvas/` (routing, guides, align, clipboard, layout adapter) and export serializers — including the JSON round-trip property and Mermaid subgraph nesting (SC-005).
- [X] T030 [P] Accessibility + touch pass per contracts/canvas-interactions.md — keyboard path for every pointer operation (tab/arrow element navigation, Enter for actions), visible focus, reduced motion, toolbar equivalents for hover-only actions on mobile widths (FR-016, SC-006).
- [X] T031 Performance pass — memoized nodes/edges, re-route only moved edges, viewport-scoped guide computation, `onlyRenderVisibleElements` for large diagrams; verify instant feedback at 100 nodes + 20 containers (SC-004; research R10).
- [X] T032 Run `specs/002-lucid-style-studio/quickstart.md` validation including the feature 001 regression scenario (SC-007); `npm run build` + `npm run lint` green (Constitution V).

---

## Dependencies & Execution Order

- **Feature 001 first**: T002/T003 extend 001's model + architecture API (001 T008/T031); T015 is
  gated on 001's orchestrator (001 T022); T016 on 001's export serializer (001 T045).
- **Setup (P1) → Foundational (P2)** blocks all stories.
- **US1** is independent after Foundational. **US2** independent of US1 (containers don't need
  routing), but T013 and T009 both touch `Canvas.tsx` — coordinate merges.
- **US3** builds on US1/US2 elements existing (context menu actions target them) but is testable
  after Foundational + US1.
- **US4** depends on `OrthogonalEdge.tsx` (T009) for edge style rendering; T024 pairs with T003.
- **US5** independent after Foundational. **US6** depends on containers (US2) for
  container-aware layout.
- **Polish** last.

## Parallel Opportunities

- T004/T005 in parallel after T002/T003.
- US1 pure-logic trio T006/T007/T008 in parallel; T012 parallel with any US1 task.
- T017 (clipboard), T021 (annotations), T025 (minimap), T027 (elk adapter) are each
  parallel-safe pure/new-file work streamable alongside their phase peers.
- After Foundational: US1, US2, and US5 can be staffed in parallel (watch shared `Canvas.tsx`).

## Implementation Strategy

**MVP first**: Setup + Foundational, then **US1 (layout assists)** — that alone makes the studio
feel professional and is the demoable core of this feature. Then US2 (containers) to unlock
honest topology + AI authority, US3/US4 for speed and polish, US5/US6 last. Validate each story
with `npm run build` + its quickstart scenario before moving on (Constitution V). Re-run the 001
regression scenario (SC-007) after US2 and again at Polish.
