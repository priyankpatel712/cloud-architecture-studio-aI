# Quickstart & Validation — Lucidchart-Grade Studio Diagramming

How to validate feature 002 end-to-end. Builds on feature 001's app and
[quickstart](../001-mvp-baseline/quickstart.md); 001's studio persistence must be working first.

## Prerequisites

- Feature 001 running per its quickstart (`cd app && npm run dev`), a signed-in verified user,
  and at least one project with a saved architecture.

## Validation scenarios (map to user stories)

- **US1 Layout assists**: place 5 services, connect them; drag a shape — connections re-route
  orthogonally and stay attached; drag near a neighbor — alignment guide appears and snaps;
  select 3 shapes → align top, distribute horizontally — one undo reverts each.
- **US2 Containers**: create a region container, a VPC inside it, two subnets inside the VPC; drag
  services into each subnet; move the VPC — everything moves; delete a subnet choosing "keep
  contents" — services re-parent to the VPC; export JSON + Mermaid — containers appear (nested
  subgraphs); send a chat follow-up — the assistant references the grouping.
- **US3 Fast editing**: marquee-select, Ctrl/Cmd+D a configured service — copy carries config and
  cost updates; Alt-drag duplicate; arrow-nudge (+Shift); right-click each element type — correct
  context menu; open the shortcut reference with ?.
- **US4 Style & annotate**: label a connection "HTTPS", set dashed + geometry straight; rename a
  node's display name — pricing unchanged; add a sticky note — totals unchanged; undo each step.
- **US5 Navigation**: on a 40+ node diagram (generate via chat), toggle minimap, click-to-navigate,
  fit-to-view, find a service by partial name → centered + highlighted.
- **US6 Auto-arrange**: after a chat generation, invoke auto-arrange — non-overlapping,
  container-respecting layout in one undo step; select a subset → arrange selection only.
- **Regression (SC-007)**: run feature 001's US2/US3 validation scenarios unchanged — direct edits
  still re-price and sync the chat context; version conflict UX still works with the extended
  payload.

## Gates (Constitution V — verify before done)

1. `npm run build` + `npm run lint` green.
2. Unit tests green for `lib/canvas/*` (routing, guides, align, clipboard, layout adapter) and the
   extended export serializers (JSON round-trip property; Mermaid subgraph nesting).
3. Each story's scenario above driven and observed (headless screenshots, desktop + mobile widths).
4. Keyboard-only pass: US3's core flow completed without a pointer; focus visible throughout
   (SC-006); reduced-motion respected.
5. Scale check: 100 nodes + 20 containers interact with no perceptible lag (SC-004).
