# Contract: Export Fidelity Tiers (FR-007, SC-005)

Extends feature 001's [export contract](../../001-mvp-baseline/contracts/export.md) for the new
canvas elements. Tiers per Clarification 2026-07-06.

| Format | Tier | Containers | Labels/display names | Styles/waypoints | Annotations |
|--------|------|-----------|----------------------|------------------|-------------|
| PNG | Pixel-faithful | as rendered | as rendered | as rendered | as rendered |
| PDF | Pixel-faithful (diagram image + cost summary) | as rendered | as rendered | as rendered | as rendered |
| JSON | Complete, round-trippable | full data | full data | full data | full data |
| Mermaid | Structure-faithful | nested `subgraph` blocks | node + edge labels | **not encoded** | omitted (or comment lines) |

Rules:

- JSON export MUST re-import to an identical architecture (round-trip property — the basis of
  SC-005's JSON test).
- Mermaid MUST nest subgraphs to mirror container nesting and include all node/edge labels;
  geometry, colors, waypoints, and positions are intentionally not represented.
- PNG/PDF capture exactly what the canvas shows at export time, including containers and
  annotations.

**Acceptance mapping**: US2/AC4, FR-007, SC-005.
