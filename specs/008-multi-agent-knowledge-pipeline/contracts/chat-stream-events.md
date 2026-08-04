# Contract: Chat Turn Stream Events

**Feature**: `008-multi-agent-knowledge-pipeline` | **Serves**: FR-034, FR-035, FR-007, FR-008

The chat turn streams NDJSON from `POST /api/projects/[id]/chat/messages`. This feature **adds step kinds and two terminal payload shapes**; it changes no existing event contract, because features 004/005/006 depend on them (FR-035).

---

## Unchanged (non-regression surface)

`step`, `diagram`, `result`, `stopped`, `unsatisfiable`, and `error` events keep their current shapes and ordering guarantees. Specifically preserved:

- Incremental `diagram` events during chunked build-up (feature 005)
- `step` running → done/failed transitions (feature 004)
- Stop-control semantics: already-applied chunks are kept (features 004/005)
- Interaction rounds for clarify / cost questions / priced options (feature 006)

---

## New Step Kinds

Emitted through the existing emitter with identical `running → done | failed` semantics, so the trace UI, its accessibility behavior, and persisted `GenerationRun` history need no structural change (FR-034).

| Kind | Emitted when | Label shown to the user |
|---|---|---|
| `intent` | The intent resolver classifies a follow-up | "Understanding the request" |
| `direct-edit` | The fast path applies a trivial edit | "Applying edit" |
| `knowledge` | Stored knowledge is retrieved and injected | "Consulted N house rules" |
| `research` | Web research runs | "Searched the web: &lt;query&gt;" |
| `distill` | A lesson is recorded post-turn | "Recorded a lesson" |

**Constraints**
- `research` names the search terms actually sent — which are derived capability keywords, never raw user text (FR-030), so the trace is safe to share.
- `knowledge` reports a count and entry titles, not full rule text, keeping the trace readable.
- `distill` is emitted **after** the `result` event, since distillation runs post-turn. Clients must tolerate a trailing step after `result`. This is the one ordering addition in this contract.
- A failed step never aborts the turn: knowledge, research, and distill failures degrade and are recorded as `failed` while the turn proceeds (FR-027, FR-034).
- The screen-reader announcement policy is unchanged — boundaries, failures, and completion only, not every micro-step (feature 004 clarification).

---

## New Terminal Payloads

### Answer-only turn (`kind: 'question'`)

```json
{
  "type": "result",
  "message": "CloudFront sits in front of the S3 bucket so that …",
  "architecture": null,
  "answeredOnly": true
}
```

`architecture: null` with `answeredOnly: true` signals the client to render the reply **without touching the canvas** (FR-007). The client must not interpret a null architecture as an error or as an instruction to clear the diagram.

### Restore offer (`kind: 'undo'`)

**As implemented (2026-07-31)**, an undo request returns the same answer-only shape, with a reply directing the user to Version history:

```json
{
  "type": "result",
  "message": "I can restore an earlier version rather than redesigning anything — open Version history…",
  "architecture": null,
  "answeredOnly": true
}
```

A restore is **never performed automatically** (FR-008): it discards current work, so it requires a deliberate user action, and an undo request must never be answered by generating a new design. Both guarantees hold here.

**Deviation from the original design, recorded deliberately.** This contract first specified a structured `restore_offer` interaction with Restore/Keep buttons. That would require a new interaction kind across the flow types, the Mongoose enum, the round-answer routing, and the client — four files and a new answered-round path — for a UI affordance on top of a capability the toolbar already provides. The prose offer delivers FR-008's safety properties today at a fraction of the risk. **The structured offer remains a worthwhile follow-up**, not a cancelled requirement; when it lands, this section should be restored to the interaction shape above.

---

## Client Obligations

1. Tolerate unknown `step.kind` values — render the label, ignore kinds you do not recognize. This keeps older clients forward-compatible with later agent additions.
2. Tolerate a `distill` step arriving after `result`.
3. Treat `architecture: null` as "no canvas change", never as "clear the canvas".
4. Continue honoring existing stop, error, and interaction semantics unchanged.
