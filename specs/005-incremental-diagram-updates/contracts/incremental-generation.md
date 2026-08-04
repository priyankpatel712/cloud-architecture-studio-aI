# Contract: Incremental Diagram Build-Up (Feature 005)

Extends 004 `contracts/agentic-generation.md`. Backward compatible: the new stream event and
step fields are additive; a consumer that ignores them behaves exactly as it does today.

## 1. POST /api/projects/[id]/chat/messages — NDJSON stream v2 (extended)

### New event: `diagram`

Emitted after each chunk (or defensive slice-group) is applied to the in-memory turn state,
*before* the next chunk is planned or the terminal event is sent:

```json
{"type":"diagram","nodes":[...],"edges":[...],"containers":[...],"iteration":1,"chunk":2}
```

- `nodes`/`edges`/`containers`: the FULL current architecture snapshot (not a diff) — same
  shape as the terminal `result` event's `architecture` field. Cost (`estimate`) is NOT
  included — pricing only runs once per iteration, after all of that iteration's chunks are
  applied (unchanged from 004).
- `iteration`/`chunk`: 1-based, matching the corresponding `step` event.
- The client replaces its live canvas state with this snapshot — the same rendering path
  already used for the terminal `result` event's architecture, invoked mid-stream instead of
  only at the end.
- A turn with only one chunk (small requests, FR-009) emits exactly one `diagram` event before
  its terminal event, same as any other chunk — there is no special no-chunk case to handle.

### Step events (extended)

`kind: 'draft'` steps MAY now carry a `chunk` field:

```json
{"type":"step","id":"plan:1.2","kind":"draft","iteration":1,"chunk":2,"label":"Designing the architecture plan (part 2)","status":"running"}
{"type":"step","id":"plan:1.2","kind":"draft","iteration":1,"chunk":2,"label":"Designing the architecture plan (part 2)","status":"done","detail":"Adding compute and networking"}
```

- Absence of `chunk` means the step ran as a single, unchunked unit (fully backward compatible
  with any consumer written against the 004 contract).
- `detail` on a chunked draft step's `done` status carries the chunk's `chunkLabel` when the
  model supplied one.

## 2. Terminal events — unchanged

`result` / `error` / `unsatisfiable` / `stopped` envelopes are unchanged from 004. The terminal
`result`'s `architecture` field is simply the same snapshot as the last `diagram` event sent
(after that iteration's validate/layout/price/review complete) — no new terminal fields.

## 3. UI contract (ChatPanel + creation page) — extended

- On receiving a `diagram` event, the client immediately applies its `nodes`/`edges`/`containers`
  to the live canvas — the same update path already used when the terminal `result` event's
  architecture arrives, just invoked once per chunk instead of once per turn.
- The existing live `WorkingTrace` step list continues to render `step` events unchanged; a
  chunked draft step's `chunk` field, when present, is reflected in its label (e.g. "part 2")
  so the trace and the canvas visibly correspond.
- Stop (existing `POST /stop`, feature 004): unchanged semantics — whatever `diagram` snapshot
  was last applied to the canvas stays exactly as shown; no rollback.
- Accessibility (feature 004 FR-012, carried over unchanged, spec 005 FR-011): a `diagram`
  event does NOT trigger its own `aria-live` announcement — the existing boundary/failure/
  completion announcement policy is unchanged, so a multi-chunk turn does not flood assistive
  technology with a chunk-per-chunk announcement.
- Backward compat: a client that only understands the 004 contract ignores unknown `diagram`
  events and unknown `chunk` fields, and still renders correctly from the terminal `result`
  event alone — exactly today's behavior.

## 4. Guarantees preserved (feature 004 §6, unchanged)

- Architecture persists only after a converged-or-best-effort loop, at the single existing
  persist point — chunking is purely a mid-turn, pre-persist concern.
- Cost phase contract runs once per iteration after all chunks in that iteration are applied,
  exactly as in 004 — never per chunk.
- Preserve-user-work (research R7): the protected-node-snapshot check that guards refine
  passes runs against the fully-assembled iteration result, unaffected by how many chunks
  produced it.
