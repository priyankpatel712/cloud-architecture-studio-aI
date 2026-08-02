# Feature Specification: Lucidchart-Grade Studio Diagramming

**Feature Branch**: `002-lucid-style-studio`

**Created**: 2026-07-06

**Status**: Draft

**Input**: User description: "Studio should be like https://lucid.co/lucidchart — research Lucidchart
and use it as the benchmark for the studio editing experience."

## Overview

The studio canvas today supports basic add/connect/configure editing. This feature raises it to the
editing bar set by leading diagramming tools (benchmark: Lucidchart): connectors that route
themselves and stay attached as shapes move; snap-to-grid and live alignment guides; align and
distribute commands; labeled, typed **containers** for cloud boundaries (region, VPC, subnet,
availability zone, cluster) that move with their contents; fast multi-select editing with
copy/paste, modifier-drag duplicate, and a full keyboard-shortcut set; styling and annotation;
minimap and find-based navigation; and one-command auto-arrange. Everything remains a first-class
part of the existing architecture: edits keep flowing into live cost estimation, the AI chat
context, persistence, and exports (feature 001).

## Clarifications

### Session 2026-07-06

- Q: What routing geometry should connections use? → A: Orthogonal + per-edge choice — right-angle auto-routed lines by default (Lucidchart-style); each connection's style panel can switch it to straight or curved.
- Q: May the AI assistant create, modify, and place containers during chat generation? → A: Full container authority — generation can create typed containers, place services into them, and restructure boundaries on follow-ups, under feature 001's preserve-user-work rule.
- Q: What fidelity must each export format guarantee for the new elements? → A: Tiered fidelity — PNG/PDF pixel-faithful to the canvas; JSON complete and round-trippable (all elements, positions, styles); Mermaid structure-faithful (containers as subgraphs, node/edge labels; geometry and visual styling best-effort).
- Q: Can elements be copied in one project and pasted into another? → A: Same project only — copy/paste and duplicate work within the current project's canvas; cross-project reuse is future work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Precise layout without fiddling (Priority: P1)

A user moves and resizes services on the canvas while connections re-route themselves
automatically and stay attached; while dragging, the canvas snaps to a grid and shows live
alignment guides against neighboring shapes; selected shapes can be aligned and distributed with
one command.

**Why this priority**: Connector fiddling and pixel-nudging are the biggest polish gap between the
current studio and the Lucidchart benchmark; this is the foundation every other editing action
sits on.

**Independent Test**: Place five services, connect them, then drag shapes around: connections
re-route without manual fixes, guides appear when edges/centers align, and align/distribute
commands arrange a multi-selection correctly. Delivers a visibly professional canvas on its own.

**Acceptance Scenarios**:

1. **Given** two connected services, **When** the user drags one to the other side of the canvas,
   **Then** the connection re-routes automatically around intervening shapes and stays attached.
2. **Given** a shape being dragged near others, **When** its edge or center comes within snapping
   range of a neighbor's edge or center, **Then** a live alignment guide appears and the shape
   snaps to it; grid snapping applies otherwise.
3. **Given** three or more selected shapes, **When** the user invokes align (left/center/right/
   top/middle/bottom) or distribute (horizontal/vertical), **Then** the shapes arrange accordingly
   in a single undoable step.
4. **Given** a connection whose path the user has manually adjusted, **When** the connected shapes
   move slightly, **Then** the manual adjustment is respected where possible rather than discarded.

---

### User Story 2 - Organize with cloud boundary containers (Priority: P1)

A user draws labeled containers on the canvas — generic groups or typed cloud boundaries (region,
VPC, subnet, availability zone, cluster) — drags services in and out, nests containers, and moves
a container with all of its contents. Containers persist with the design, appear in exports, and
are visible to the AI assistant.

**Why this priority**: Cloud architectures are defined by their boundaries; without containers the
diagram cannot honestly represent network topology, and this is the most-requested structure in
architecture diagramming.

**Independent Test**: Create a VPC container with two subnet containers inside, drag services into
each subnet, move the VPC — everything moves together; export and confirm the containers appear;
ask the assistant a follow-up and confirm it sees the grouping. Delivers honest topology diagrams
on its own.

**Acceptance Scenarios**:

1. **Given** the canvas, **When** the user draws a container and assigns it a type and label,
   **Then** the container renders as a labeled boundary and persists with the architecture.
2. **Given** a container with services inside, **When** the user moves or deletes the container,
   **Then** moving carries its members along, and deleting asks whether to delete or keep the
   members (keeping re-parents them to the enclosing container or canvas).
3. **Given** nested containers (subnet inside VPC inside region), **When** a service is dragged
   across boundaries, **Then** its membership updates to the container it is dropped into and the
   change is recorded as an edit (undoable, versioned, reflected in the chat context).
4. **Given** an architecture with containers, **When** it is exported (image, document, diagram
   code, data), **Then** the containers and memberships are represented at each format's fidelity
   tier (see SC-005).

---

### User Story 3 - Fast editing interactions (Priority: P2)

A user selects several elements with a marquee or shift-click, copies/pastes or modifier-drags to
duplicate, nudges with arrow keys, pans with the spacebar, zooms with the scroll wheel, deletes
with the keyboard, and reaches common actions from a right-click context menu — with a
discoverable in-app shortcut reference.

**Why this priority**: Editing speed is the second half of the Lucidchart feel; it multiplies the
value of US1/US2 but the canvas is usable without it.

**Independent Test**: Using only mouse+keyboard interactions (no toolbar), duplicate a configured
service, nudge it into place, connect it, and delete a stray element; open the shortcut reference.
Delivers measurably faster editing.

**Acceptance Scenarios**:

1. **Given** the canvas, **When** the user drags a marquee or shift-clicks elements, **Then** a
   multi-selection forms that can be moved, styled, duplicated, or deleted as a unit.
2. **Given** a selected service with custom configuration, **When** the user copies and pastes it
   or drags it with the duplicate modifier held, **Then** an offset copy appears with the same
   configuration and the cost estimate updates.
3. **Given** a selection, **When** the user presses arrow keys (with and without the large-step
   modifier), **Then** the selection nudges by the small/large step respectively.
4. **Given** any canvas element, **When** the user right-clicks it, **Then** a context menu offers
   the common actions for that element type (e.g. duplicate, delete, align, edit label, configure).

---

### User Story 4 - Style and annotate the diagram (Priority: P2)

A user labels connections, renames services with display names, changes connection style (solid/
dashed, arrowheads, color), and adds free-text notes and sticky annotations that document the
design without affecting cost or provider semantics.

**Why this priority**: Communication polish — labels and notes are how a diagram explains itself
to stakeholders — but the topology is expressible without it.

**Independent Test**: Label a connection "HTTPS", restyle it dashed, rename a service node, add a
sticky note; confirm cost totals are unchanged, everything persists and exports, and undo reverts
each step. Delivers presentable, self-explanatory diagrams.

**Acceptance Scenarios**:

1. **Given** a connection, **When** the user adds/edits its label or changes its line style,
   **Then** the change renders immediately, persists, and appears in exports.
2. **Given** a service node, **When** the user sets a display name, **Then** the diagram shows the
   display name while the underlying catalog service and its pricing stay unchanged.
3. **Given** the canvas, **When** the user adds a text note or sticky annotation, **Then** it can
   be placed, edited, styled, and moved like any element, is excluded from cost totals and provider
   recommendations, and persists with the design.

---

### User Story 5 - Navigate large diagrams (Priority: P3)

A user working on a large architecture uses a minimap, fit-to-view, zoom-to-selection, and a find
box that matches services by name and centers the canvas on the result.

**Why this priority**: Only matters once diagrams grow, but without it large generated
architectures become unmanageable.

**Independent Test**: On a 40+ node architecture, locate a named service via find, jump to it,
fit the whole diagram, and orient with the minimap. Delivers manageable large diagrams.

**Acceptance Scenarios**:

1. **Given** a large diagram, **When** the user toggles the minimap, **Then** it shows the whole
   architecture with the current viewport indicated and supports click-to-navigate.
2. **Given** any diagram, **When** the user invokes fit-to-view or zoom-to-selection, **Then** the
   viewport adjusts to frame the diagram or selection.
3. **Given** a service name (full or partial), **When** the user searches it in the find box,
   **Then** matching nodes are listed and choosing one centers and highlights it.

---

### User Story 6 - Tidy the diagram automatically (Priority: P3)

After AI generation or heavy editing, a user invokes a single auto-arrange command that lays out
the diagram (or a selection) cleanly, respecting container boundaries, as one undoable step.

**Why this priority**: A strong finisher — especially after chat-generated changes — but manual
layout plus US1's assists suffice without it.

**Independent Test**: Generate an architecture via chat, invoke auto-arrange, confirm a clean,
non-overlapping, container-respecting layout appears and a single undo restores the previous
positions.

**Acceptance Scenarios**:

1. **Given** a messy diagram, **When** the user invokes auto-arrange, **Then** shapes are laid out
   without overlaps, connections are untangled, container members stay within their containers,
   and the whole operation is one undo step.
2. **Given** a selection, **When** the user invokes auto-arrange on it, **Then** only the selected
   elements are re-arranged; everything else keeps its position.

---

### Edge Cases

- **Auto-routing has no clear path** (dense/overlapping shapes): the connection renders along a
  best-effort path and never disappears; moving shapes recovers routing.
- **Deleting a container**: the user chooses "delete contents too" or "keep contents"; keeping
  re-parents members to the enclosing container or canvas. Never silently deletes services.
- **Dragging a container into its own descendant** (cycle): refused with feedback.
- **Auto-arrange vs preserved user work**: auto-arrange is an explicit user action, so it may move
  manually placed shapes — but only as a single undoable step; AI generation continues to preserve
  manual positions per feature 001 (FR-014d).
- **Paste with nothing copied / paste of elements whose source was deleted**: paste is disabled or
  produces the last valid clipboard content; never a broken element.
- **Annotations and cost**: text notes, stickies, and containers never contribute to cost totals
  and are never sent to providers as services; they are recorded in the chat context as structure,
  not services.
- **Very large diagrams**: beyond the supported scale (see SC-004) the canvas remains functional;
  minimap and find remain responsive even if rendering degrades gracefully.
- **Keyboard-only users**: every pointer-only interaction above has a keyboard path (see FR-016);
  focus is always visible.

## Requirements *(mandatory)*

### Functional Requirements

**Connectors & layout assists**

- **FR-001**: Connections MUST auto-route between shapes (avoiding shapes where a clear path
  exists), stay attached to their endpoints, and re-route dynamically as shapes move or resize.
  Default geometry is **orthogonal** (right-angle); each connection may be switched to straight or
  curved via its style settings.
- **FR-002**: Users MUST be able to manually adjust a connection's path; manual adjustments are
  preserved where possible when endpoints move.
- **FR-003**: The canvas MUST provide snap-to-grid and live alignment guides (edges and centers
  against neighboring shapes) during drag and resize; snapping MUST be toggleable.
- **FR-004**: Users MUST be able to align a multi-selection (left/center/right/top/middle/bottom)
  and distribute three or more shapes evenly (horizontally/vertically), each as one undoable step.

**Containers & grouping**

- **FR-005**: Users MUST be able to create labeled containers, either generic or typed as cloud
  boundaries (region, VPC, subnet, availability zone, cluster), with nesting support.
- **FR-006**: Container membership MUST be managed by drag-in/drag-out; moving a container moves
  its members; deleting a container asks whether members are deleted or kept (re-parented).
- **FR-007**: Containers and memberships MUST persist with the architecture, be included in all
  export formats, and be visible to the AI assistant's context as structure (not as costed
  services). The assistant has **full container authority**: chat generation may create typed
  containers, place services into them, and restructure boundaries on follow-up messages, subject
  to feature 001's preserve-user-work rule (FR-014d).

**Editing interactions**

- **FR-008**: Users MUST be able to multi-select via marquee and shift-click and operate on the
  selection as a unit (move, delete, duplicate, style, align).
- **FR-009**: Users MUST be able to copy, paste, and duplicate elements (including modifier-drag
  duplicate); copies keep configuration, are offset from the source, and trigger cost
  re-estimation. The clipboard is scoped to the **current project** — cross-project paste is out
  of scope (future work).
- **FR-010**: The studio MUST provide keyboard shortcuts covering at minimum: delete, arrow-key
  nudge (small and large step), select-all, copy/paste/duplicate, undo/redo, zoom in/out,
  fit-to-view, and spacebar-hold panning with scroll-wheel zoom — plus an in-app shortcut
  reference.
- **FR-011**: The studio MUST provide a right-click context menu with the common actions for the
  clicked element type (canvas, service, connection, container, annotation).

**Styling & annotation**

- **FR-012**: Users MUST be able to label connections and set per-connection style (solid/dashed,
  arrowhead style, color) from a constrained style set.
- **FR-013**: Users MUST be able to give services a display name shown on the diagram without
  altering the underlying catalog service, configuration, or pricing.
- **FR-014**: Users MUST be able to add, edit, style, and move text notes and sticky annotations;
  annotations are excluded from cost totals and provider semantics.

**Navigation**

- **FR-015**: The studio MUST provide a toggleable minimap with viewport indication and
  click-to-navigate, fit-to-view, zoom-to-selection, and a find box that matches services by name
  (full or partial) and centers/highlights the chosen result.

**Cross-cutting**

- **FR-016**: Every operation introduced by this feature MUST be undoable/redoable and MUST have a
  keyboard-accessible path (extends feature 001 FR-016 and the accessibility floor).
- **FR-017**: Every edit introduced by this feature MUST flow through the existing save/version,
  cost re-estimation, and AI-chat context sync (feature 001 FR-016a); only service changes affect
  cost.
- **FR-018**: Auto-arrange MUST be available for the whole diagram or a selection, respect
  container boundaries, produce a non-overlapping layout, and apply as a single undoable step.

### Key Entities *(include if feature involves data)*

- **Container**: a labeled, optionally typed boundary (generic, region, VPC, subnet, availability
  zone, cluster) with position/size, an optional parent container, and member services/containers.
  Persists with the Architecture; carries no cost.
- **Annotation**: a text note or sticky element with content, position, and style. Persists with
  the Architecture; carries no cost and no provider meaning.
- **ServiceEdge (extended)**: gains an optional label, style (line pattern, arrowheads, color from
  the constrained set), and preserved manual waypoints.
- **ServiceNode (extended)**: gains an optional display name distinct from its catalog service
  name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can assemble a 10-service architecture organized into 3 containers, with
  labeled connections, in under 8 minutes without assistance.
- **SC-002**: After moving a connected shape, no manual connector fix-up is needed in at least 95%
  of moves on diagrams up to the supported scale.
- **SC-003**: Any two shapes can be aligned, and any three distributed, in at most 2 user actions.
- **SC-004**: Canvas interactions (drag, pan, zoom, select) give instant feedback with no
  perceptible lag on diagrams of at least 100 services and 20 containers.
- **SC-005**: Exports meet their format's fidelity tier in 100% of cases: PNG/PDF are
  pixel-faithful to the canvas; JSON is complete and round-trippable (all elements, positions,
  styles); Mermaid is structure-faithful (containers as subgraphs, node and edge labels present).
- **SC-006**: 100% of the editing operations in this feature are achievable keyboard-only, with
  visible focus throughout.
- **SC-007**: Existing behavior is preserved: direct edits (including all new edit types) continue
  to re-estimate cost and sync the AI chat context with no regression to feature 001 acceptance
  scenarios.

## Assumptions

- **Builds on feature 001** (`specs/001-mvp-baseline`): same studio canvas, persistence with
  optimistic versioning, cost engine, AI chat sync, and export pipeline; this feature extends them
  rather than replacing them.
- **Lucidchart is the UX benchmark, not a parity checklist**: the scope is the diagramming-editor
  capabilities above. Explicitly **out of scope** (future work): real-time multi-user co-editing,
  comments/discussions, revision history UI, data-linking/conditional formatting from
  spreadsheets, template galleries, presentation mode, and Lucid-style AI canvas generation
  (feature 001's chat already covers generation).
- **Layers** (Lucid's visibility layers) are out of scope for this feature; containers cover the
  structural need for cloud diagrams.
- **Snap and grid default on**, toggleable per user preference within the editing session.
- **Container types are presentation and structure semantics** for the MVP: they group and label;
  they do not validate cloud correctness (e.g. a subnet outside a VPC is allowed but may be
  flagged by the assistant in chat guidance).
- **Undo/redo and clipboard remain session-scoped**, consistent with feature 001's assumption.
