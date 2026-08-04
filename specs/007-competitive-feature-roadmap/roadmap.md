# 007 — Competitive Feature Roadmap

**Status: EXECUTED 2026-07-26 — all Phase 1–3 items shipped** (1.1 version history+restore, 1.2 JSON/Mermaid import, 1.3 public share links+embed, 2.1 quick-connect, 2.2 comments, 2.3 node accents+annotation z-order, 3.1 flow walkthrough, 3.2 code/IaC import via router+planner prompts, 3.3 one-way Terraform export). Phase 4 heavy bets (realtime, live AWS import, C4 model-views) remain future specs. Deviation from plan: z-order shipped for annotations only — container reordering conflicts with React Flow's parent-before-child ordering requirement.
Grounded in a 2025–2026 survey of Lucidchart (incl. Lucid AI), draw.io, Eraser, Miro, Whimsical, FigJam, Excalidraw, IcePanel, Structurizr, Cloudcraft, Hava, Brainboard, and the Mermaid/D2/PlantUML ecosystems, mapped against a full inventory of this studio's current features.

## Where the studio already meets or beats the market

No work needed here — these are done and several are genuine differentiators:

- **AI that edits and explains, not just generates** (chat refinement loop, requirements-coverage review, Explain Flow, developer/client reports) — most tools only generate net-new; Lucid/Eraser are the only peers.
- **Per-element live cost estimation with overrides** — only Cloudcraft/Hava have this; none of the generalist tools do.
- **Canvas fundamentals**: undo/redo, edge labels + styling + waypoints, align/distribute, alignment guides, clipboard, canvas search, minimap, auto-arrange (ELK), typed nested containers, annotations, keyboard shortcuts.
- **Export**: PNG, PDF (diagram/report/proposal), **Mermaid**, JSON, cost estimate; export audit trail.
- **Generic HLD/LLD modes + dynamic tool routing** (recently added).

## Gap analysis

**Table stakes we're missing** (present in most surveyed tools):

| # | Gap | Who sets the bar |
|---|-----|------------------|
| 1 | Version history with restore (only optimistic-concurrency 409 today) | Lucid, Miro, draw.io, Eraser |
| 2 | Any import path — no Mermaid import, no JSON re-import | draw.io, Excalidraw, Miro, Whimsical |
| 3 | Public share links (tokenized, read-only) + embed | every SaaS tool |
| 4 | Comments / discussion threads | Lucid, Miro, FigJam, Eraser, Excalidraw+ |
| 5 | Quick-connect (drag from node edge → suggested next shape) | Lucid, draw.io, Miro, Whimsical |
| 6 | Node color styling; z-order controls | universal basics |
| 7 | Realtime multiplayer + presence | commoditized among SaaS tools (but heaviest to build) |

**Differentiators within reach** (few tools have them; they fit this app's AI + cloud + cost identity):

| # | Opportunity | Who has it today |
|---|-------------|------------------|
| D1 | Flow walkthrough animation on the canvas (step-through request paths) | IcePanel Flows only |
| D2 | Paste code/IaC/SQL → diagram (AI import) | Eraser only |
| D3 | Terraform/IaC export from the diagram | Brainboard only |
| D4 | Live AWS account import (we already hold SSO sessions via Connections) | Cloudcraft, Hava, Lucidscale |
| D5 | One model → multiple views (cloud ⇄ HLD drill) | Structurizr, IcePanel |

## The plan

### Phase 1 — close the table-stakes gaps (highest value : effort)

**1.1 Version history with restore** (M)
- Snapshot on every persisted change: new `ArchitectureVersion` collection written by the architecture PUT route and the chat-turn persist path (nodes/edges/containers/annotations/guidance + version number, author, source: `chat-turn` | `direct-edit` | `restore`, cap ~50/project with pruning).
- UI: "History" panel in the studio (list with relative time, source badge, node/edge counts); Preview (read-only render into the existing canvas) and Restore (writes a NEW version — never rewrites history — reusing the existing 409 conflict machinery).
- Later hook: per-version diff summaries already exist (`summarizeArchitectureEdit`) — show them as the change description per entry.

**1.2 Import: Mermaid + studio JSON** (M)
- JSON: accept our own export format back (round-trip), validated by zod, into a NEW project or replacing current canvas (confirmation + history snapshot first).
- Mermaid: parse `graph`/`flowchart` blocks into system-provider nodes/edges (labels → `sys-*` mapping via the router LLM when available; deterministic `sys-service` fallback otherwise), then ELK-arrange. This makes the studio a paste-target for every AI tool that emits Mermaid.
- Entry points: "Import" in the studio toolbar + on the projects page.

**1.3 Public share links + embed** (S/M)
- Tokenized read-only link (`/share/[token]`), token stored on Project (revocable, owner-only management in the existing Share menu), no auth required to view; renders the existing read-only studio view.
- Embed = same route with `?embed=1` (chrome hidden) + iframe snippet copy button.
- Keep the existing email-share for edit-adjacent collaboration; public links are view-only.

### Phase 2 — editing ergonomics + lightweight collaboration

**2.1 Quick-connect** (M) — drag from a node's source handle onto empty canvas → popover with 5–6 suggested next services (curated adjacency per category: API gateway → Lambda/service, service → DB/queue/cache…), creating node + labeled edge in one gesture. Suggestions come from a static adjacency map per provider; AI not required.

**2.2 Comments** (M) — pin-style comment threads anchored to a node/container or canvas point; `CommentThread` model (projectId, anchor, messages, resolved); visible to owner + shared users; resolved-filter. No realtime needed — refetch on focus/interval.

**2.3 Node styling + z-order** (S) — optional accent override on service/container nodes (small palette, stored per node, exports respect it); bring-to-front/send-to-back for annotations and containers.

### Phase 3 — differentiators that compound our identity

**3.1 Flow walkthrough animation** (S/M) — "Play flow" on the canvas: reuse Explain Flow's BFS transit order to highlight nodes/edges step-by-step (dimmed canvas, animated edge pulse, step captions, prev/next controls). IcePanel is the only peer; we already compute the data.

**3.2 Paste anything → diagram (AI import)** (M) — new chat affordance: paste Terraform/CloudFormation/SQL/code; router detects "import" intent; a dedicated prompt maps resources to catalog services (aws_lambda_function → aws-lambda…), then the normal plan/apply/layout pipeline runs. Eraser is the only peer, and we already have the whole downstream pipeline.

**3.3 Terraform export (one-way first)** (M/L) — serializer mapping AWS catalog nodes → Terraform resource blocks with sensible defaults + `# TODO` markers for non-derivable fields; containers → tags/module grouping. Ship as a new export format alongside Mermaid/JSON. Two-way sync (Brainboard's moat) explicitly out of scope until one-way proves demand.

### Phase 4 — heavy bets (separate specs, not started without explicit decision)

- **4.1 Realtime co-editing + presence** (L) — websocket infra, CRDT/OT or op-relay + server arbitration; today's 409 conflict banner is a deliberate stopgap. Do after Phase 1–3.
- **4.2 Live AWS import** (L) — read-only account scan through the existing AWS SSO connection → diagram + drift versioning (Hava-style). Strong fit (Connections + pricing already exist) but a large, security-sensitive surface.
- **4.3 C4 model-views** (L) — one persisted model rendered at cloud/HLD zoom levels; builds on the hld/lld modes. Research spike first.

## Suggested execution order

`1.1 → 1.2 → 1.3 → 3.1 → 2.1 → 2.2 → 2.3 → 3.2 → 3.3` — Phase 1 closes the embarrassing gaps; 3.1 is pulled early because it's cheap, visible, and demo-friendly. Each item lands independently (no cross-dependencies except 1.1 before any restore-adjacent work).
