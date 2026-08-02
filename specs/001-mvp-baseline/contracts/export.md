# Contract: Export (FR-024)

Export a project's current architecture. Owner or shared reader.

## `GET /api/projects/[id]/export?format=png|pdf|mermaid|json`
- `json` → `200 application/json` — the architecture document (nodes, edges, guidance, estimate).
- `mermaid` → `200 text/plain` — a Mermaid diagram serialized from nodes/edges.
- `pdf` → `200 application/pdf` — diagram image + cost summary (assembled with jsPDF).
- `png` → produced client-side from the canvas via html-to-image; the server route is the fallback.

An `Export` audit record `{ ownerId, architectureId, format, createdAt }` is written. The artifact is
streamed, not persisted.

**Acceptance mapping**: US7/AC1–2, FR-024.
