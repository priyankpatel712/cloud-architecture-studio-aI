# Implementation Plan: Lucidchart-Grade Studio Diagramming

**Branch**: `002-lucid-style-studio` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-lucid-style-studio/spec.md`

## Summary

Raise the studio canvas to the Lucidchart benchmark: orthogonal auto-routed connections with
per-edge geometry choice, snap-to-grid + live alignment guides, align/distribute, typed
cloud-boundary containers (region/VPC/subnet/AZ/cluster) with nesting and AI authority, marquee
multi-select, copy/paste/modifier-drag duplicate, full keyboard shortcuts + context menus,
edge labels/styles, display names, annotations, minimap/find/fit navigation, and container-aware
auto-arrange. Technically this is a **frontend-heavy extension of the existing React Flow studio**
plus a backward-compatible extension of the Architecture document (containers, annotations, edge
style/waypoints, display names) that flows through feature 001's persistence, pricing, chat-context
sync, and export pipelines. Canvas capabilities build on official React Flow features (subflows,
snap grid, MiniMap/Controls, custom edges); auto-arrange uses elkjs (justified community dep — no
official layout engine exists); routing and alignment guides are small in-house utilities.

**Dependency**: this feature extends feature 001's studio persistence, pricing, chat, and export
(001 tasks T027–T032, T019–T026, T045–T047). Plan assumes 001 lands first; anything not yet built
from 001 blocks the corresponding story here.

## Technical Context

**Language/Version**: TypeScript 5, React 19, Next.js 16 (App Router); Node runtime for route handlers

**Primary Dependencies**: `@xyflow/react` (React Flow — canvas, subflows/parent nodes, snapToGrid,
MiniMap, Controls, custom edges); **elkjs** (auto-layout; community dep justified below); existing
Mongoose models + zod validation from 001. No other new dependencies: orthogonal routing, alignment
guides, clipboard, and shortcuts are in-house utilities on official React Flow APIs.

**Storage**: MongoDB via Mongoose — extends the feature 001 `Architecture` document (embedded
containers, annotations, edge style/waypoints, node display names). No new collections.

**Testing**: `next build` baseline gate; unit tests for pure logic (routing helper, alignment-guide
math, layout adapter, clipboard offsets, export serializers); driven UI flows via headless
screenshots at desktop + mobile per Constitution V.

**Target Platform**: Responsive web (desktop + mobile browsers); canvas interactions degrade
gracefully on touch (tap-select, toolbar equivalents for hover-only actions).

**Project Type**: Web application — single Next.js app under `app/` (same as 001).

**Performance Goals**: Instant interaction feedback at ≥100 service nodes + 20 containers (SC-004);
connector re-route without manual fix-up in ≥95% of moves (SC-002).

**Constraints**: Every new edit type flows through 001's save/version (optimistic concurrency),
cost re-estimation, and AI-chat context sync (FR-017); keyboard path + visible focus for every
operation (FR-016, constitution a11y floor); reduced motion respected.

**Scale/Scope**: 6 user stories, 18 FRs; touches ~1 screen (studio) deeply plus export pipeline and
chat orchestrator contract; extends 1 persisted document type.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Official Integrations First | Canvas features built on official React Flow capabilities; one community dep (elkjs) where no official option exists, justified in Complexity Tracking + research.md R4 | PASS (with justified exception) |
| II. Plugin-Based, Extensible Providers | Container types (region/VPC/subnet/AZ/cluster) are declared per provider plugin catalog, not hard-coded in core canvas code | PASS — container-type registry lives with providers |
| III. API-First & Secure by Default | All persistence via existing authed route handlers; no new client-side data paths; annotations/containers validated server-side with zod | PASS |
| IV. Spec-Driven Delivery | Plan derives from clarified spec 002; tasks will trace FR/SC/US ids | PASS |
| V. Verify Before Done | Each story gated on `next build` + driven canvas flow (screenshots) per quickstart.md | PASS |

Post-design re-check (after Phase 1): no new violations introduced; elkjs remains the single
justified exception.

## Project Structure

### Documentation (this feature)

```text
specs/002-lucid-style-studio/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — Architecture document extensions
├── quickstart.md        # Phase 1 output — validation scenarios per story
├── contracts/           # Phase 1 output
│   ├── architecture-extensions.md   # extended save/load payload (001 PUT/GET architecture)
│   ├── canvas-interactions.md       # UI contract: shortcuts, context menus, guides, a11y paths
│   └── export-fidelity.md           # per-format fidelity tiers (SC-005)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing single Next.js app; no new top-level areas.

```text
app/
├── src/
│   ├── app/
│   │   └── api/projects/[id]/architecture/   # EXTEND — accepts containers/annotations/edge style (001 T031)
│   ├── components/studio/
│   │   ├── Canvas.tsx                # EXTEND — selection, snap, guides, containers, context menu
│   │   ├── ContainerNode.tsx         # NEW — typed boundary rendering (label, type badge, nesting)
│   │   ├── AnnotationNode.tsx        # NEW — text note + sticky rendering/editing
│   │   ├── OrthogonalEdge.tsx        # NEW — custom edge: orthogonal default, straight/curved variants, labels, waypoints
│   │   ├── AlignmentGuides.tsx       # NEW — live guide overlay during drag/resize
│   │   ├── CanvasContextMenu.tsx     # NEW — per-element-type actions
│   │   ├── MiniMapPanel.tsx          # NEW — official MiniMap + find box + fit/zoom controls
│   │   └── ShortcutsHelp.tsx         # NEW — in-app shortcut reference
│   ├── lib/
│   │   ├── canvas/                   # NEW — pure logic (unit-testable)
│   │   │   ├── routing.ts            # orthogonal path computation + waypoint preservation
│   │   │   ├── guides.ts             # alignment-guide + snap math
│   │   │   ├── align.ts              # align/distribute transforms
│   │   │   ├── clipboard.ts          # project-scoped copy/paste/duplicate with offsets
│   │   │   └── layout.ts             # elkjs adapter: container-aware auto-arrange
│   │   ├── export/serialize.ts       # EXTEND — containers as Mermaid subgraphs; JSON round-trip (001 T045)
│   │   └── providers/*/catalog.ts    # EXTEND — provider-declared container types
└── (models: Architecture schema extended in app/src/lib/models/Architecture.ts — 001 T008)
```

**Structure Decision**: Same single-app structure as 001. New canvas logic is isolated in
`lib/canvas/` as pure, unit-testable modules with thin React Flow bindings in
`components/studio/`, so behavior (routing, guides, align, layout, clipboard) is testable without
a browser. Container **types** are declared by provider plugins (Constitution II) — the canvas
renders whatever types the registry exposes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Community dependency: `elkjs` (Eclipse Layout Kernel, EPL-2.0) for auto-arrange (FR-018) | No official React Flow layout engine exists; ELK is the only maintained engine with first-class hierarchical (container-aware) layout, and React Flow's own docs document ELK integration as the reference approach | Hand-rolled layout (weeks of graph-drawing work, worse results); dagre (unmaintained since 2018, no container hierarchy support); no auto-arrange (fails FR-018/US6) |
