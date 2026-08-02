# Contract: Canvas Interaction & Accessibility (FR-001–004, FR-008–011, FR-015–016, FR-018)

The studio's user-facing interaction contract. Every behavior below must hold on desktop; on
touch/mobile, hover-only affordances have toolbar equivalents.

## Selection & editing

- Marquee drag on empty canvas and shift-click both build a multi-selection; the selection moves,
  deletes, duplicates, aligns, and styles as a unit (FR-008).
- Copy/paste/duplicate: selection-scoped, **project-scoped clipboard**; pasted copies keep
  configuration, get new ids and a visible offset, and trigger cost re-estimation (FR-009).
  Modifier-drag (Alt/Option) duplicates.
- Context menu (right-click / long-press) per element type: canvas (paste, select all, fit,
  auto-arrange), service (configure, rename, duplicate, delete, align), connection (label, style,
  geometry, delete), container (rename, type, delete → keep/delete members), annotation (edit,
  style, delete) (FR-011).

## Keyboard contract (FR-010, FR-016)

| Action | Binding |
|--------|---------|
| Delete selection | Delete / Backspace |
| Nudge / large nudge | Arrows / Shift+Arrows |
| Select all | Ctrl/Cmd+A |
| Copy / Paste / Duplicate | Ctrl/Cmd+C / Ctrl/Cmd+V / Ctrl/Cmd+D |
| Undo / Redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Zoom in / out / fit | Ctrl/Cmd+= / Ctrl/Cmd+- / Ctrl/Cmd+0 |
| Pan | Space (hold) + drag; scroll-wheel zoom |
| Shortcut reference | ? (and a visible help entry point) |

Every pointer operation has a keyboard path (tab/arrow navigation of elements, Enter to open the
element's actions). Focus is always visible; reduced-motion preference disables animated
transitions. An in-app shortcut reference lists all bindings (FR-010).

## Layout assists

- Snap-to-grid default on, toggleable; live alignment guides appear when a dragged/resized shape's
  edge or center aligns with a sibling's within threshold (FR-003).
- Align left/center/right/top/middle/bottom on ≥2 selected; distribute horizontal/vertical on ≥3;
  each one undoable step (FR-004).
- Auto-arrange (toolbar + context menu): whole diagram or selection; container members stay inside
  containers; non-overlapping result; one undo step (FR-018).

## Connections

- New/moved connections auto-route orthogonally around node bounds where a clear channel exists;
  best-effort path otherwise — a connection never disappears (FR-001, edge case).
- Dragging a segment creates/updates waypoints; waypoints survive endpoint moves where possible
  (FR-002). Per-connection geometry switch: orthogonal | straight | curved (Clarification).

## Navigation

- MiniMap toggle with viewport indicator + click-to-navigate; fit-to-view; zoom-to-selection;
  find box matching services by display or catalog name (partial match), Enter centers +
  highlights (FR-015).

**Acceptance mapping**: US1/AC1–4, US3/AC1–4, US5/AC1–3, US6/AC1–2; SC-002, SC-003, SC-006.
