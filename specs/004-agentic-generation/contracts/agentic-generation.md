# Contract: Agentic Generation Protocol (Feature 004)

Extends 001 `contracts/generation.md` and 003 `contracts/generation-reliability.md`. Backward compatible: all new stream fields are additive; consumers that ignore them behave as today.

## 1. POST /api/projects/[id]/chat/messages — NDJSON stream v2

Pre-stream failures unchanged (plain JSON: 400/401/403/409 with stale-lock guard). Stream events:

### Step events (extended)

```json
{"type":"step","id":"lookup:aws","kind":"lookup","iteration":1,"label":"Consulting official AWS MCP","detail":"aws___search_documentation","status":"running"}
{"type":"step","id":"review:1","kind":"review","iteration":1,"label":"Reviewing draft against your request","status":"done","detail":"2 capabilities unmet: WAF, multi-region DR"}
{"type":"step","id":"refine:2","kind":"refine","iteration":2,"label":"Refining the design (iteration 2)","status":"running"}
```

- `kind`: `understand | lookup | draft | review | refine | layout | price | validate | persist | cost`
- `iteration`: 1-based; the client groups steps visually per iteration.
- `detail`: optional ≤300-char human string; MUST NOT contain raw model output or secrets.
- `status`: `running | done | failed`. Every step id emits `running` first; terminal status always follows (guaranteed even on client disconnect via guarded emit).
- Ordering: backbone `understand → lookup* → draft → validate → layout → price → review` then per extra iteration `refine → draft(re-apply) → validate → layout → price → review`, then `persist → cost`.

### Terminal events (extended payload)

`result` / `error` / `unsatisfiable` envelopes unchanged from 003. The result payload's `message` now carries the **run summary only** — NOT the full trace, which the client already rendered live and which persists separately (Clarification Q3):

```json
"message": { "...existing fields": "...", "runId": "<GenerationRun _id>", "iterations": 2, "converged": true, "stopped": false, "stepCount": 41 }
```

Best-effort completion (budget exhausted, FR-004): delivered as `result` with `converged:false` and reply text naming unmet capabilities — NOT as `error` (the turn succeeded with a documented gap).

### Stopped turn

```json
{"type":"stopped","partial":{ "...result payload shape, architecture only if a persist phase completed..." }}
```

Client treats like `unsatisfiable`: append the persisted "stopped" assistant message, re-enable input immediately (SC-006).

## 2. POST /api/projects/[id]/chat/stop  (NEW)

- Auth: project owner (same guard as messages POST). 
- `202 {"stopping":true}` when a generation is running; `409 {"error":"No generation is in progress."}` otherwise.
- Semantics: sets `conversation.stopRequested`; the loop honors it at the next phase boundary (≤ a few seconds). In-flight LLM fetches are aborted. Nothing persists beyond the last completed phase (FR-009). Always safe to retry a new message after the stream's terminal event.

## 3. GET /api/projects/[id]/chat — thread (extended)

Each assistant message includes the **run summary** — `runId`, `iterations`, `converged`, `stopped`, `stepCount` — when present, but NOT the full trace (kept separate, fetched on demand — FR-006/Clarification Q3). Read access: any project viewer.

## 4. GET /api/projects/[id]/chat/runs/[runId] — full trace on demand (NEW)

- Auth: any project viewer (same read guard as thread GET); traces are viewable by whoever can view the thread (FR-006/SC-003).
- `200 { "steps": [TraceStep], "iterations": 2, "converged": true, "stopped": false, "startedAt": ..., "endedAt": ... }` — the full ordered trace for one run.
- `404` if the `runId` does not belong to a run under this project (prevents cross-project reads).
- Called by the UI only when a reader expands a persisted "Show working…" toggle; the just-completed turn does not call it (it already holds the live steps).

## 5. UI contract (ChatPanel + creation page)

- Live: steps render grouped by iteration under "Working on it…", each with spinner/✓/✕ and `detail` as secondary text; iteration ≥2 groups get an "Iteration N" divider.
- Persisted: assistant messages with a `runId` show a collapsed "Show working (N steps, M iterations)" toggle — the label uses `stepCount`/`iterations` (no fetch). Expanding issues `GET …/chat/runs/{runId}` to load the steps, then renders them grouped by iteration; a spinner covers the fetch.
- Accessibility (FR-012/SC-007): under reduced-motion the live steps appear/transition instantly (no animation); the expand/collapse toggle is a keyboard-focusable button with visible focus, operable via Enter/Space; a polite `aria-live` region announces phase/iteration boundaries, step failures, and turn completion — deliberately not every step. The trace region scrolls within the chat at mobile widths.
- Stop: a Stop control is visible while `sending`; on click POST /stop, disable it, await terminal stream event.
- Creation page: the first generation (streamed from `projects/new`) renders the live trace using the **same `WorkingTrace` component**, so every turn shows a live trace and SC-002 holds (Clarification 2026-07-09).
- Backward compat: messages without a `runId` render exactly as today; all consumers ignore unknown stream fields.

## 6. Guarantees preserved (FR-007/FR-008)

- Architecture persists only after a converged-or-best-effort loop, at the single existing persist point; version conflict semantics unchanged.
- Cost phase contract (003 contracts/cost-overrides.md) unchanged and runs after persist; its failure still yields step:'cost' error with partial payload.
- Retryability semantics unchanged: config-cause `LlmError`s are non-retryable; loop failures inside an iteration surface as architecture-step errors with the partial trace persisted.
- Preserve-user-work: refinements may not modify nodes outside the understood change scope; violations fail the iteration, never persist (research R7).
