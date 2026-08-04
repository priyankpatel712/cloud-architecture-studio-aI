# Data Model: Incremental Diagram Build-Up During Generation

No new collections. This feature extends one existing sub-document and introduces one
in-memory-only concept (never persisted as its own record).

## Extended: `TraceStep` (sub-document of `GenerationRun`, `app/src/lib/models/GenerationRun.ts`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `chunk` | Number | No (new, additive) | 1-based chunk index within this step's `iteration`, when a `kind: 'draft'` step was split into multiple chunk-planning rounds. Absent for a step that ran as a single chunk (today's behavior — fully backward compatible, no migration). |

All other `TraceStep` fields (`id`, `kind`, `label`, `detail`, `iteration`, `status`, `startedAt`, `endedAt`) are unchanged.

## Conceptual: Chunk (plan step)

Not a persisted entity — a processing-time grouping that exists only for the duration of one
generation turn's draft phase.

| Property | Description |
|---|---|
| Contents | A bounded subset of an architecture change: at most `CHUNK_SIZE` new services/containers, plus any `update`/`remove`/`edges`/`containers` operations whose dependencies are already satisfied by what's been applied so far this turn. |
| Origin | Either (a) one full LLM planning response when the model already self-limited to `CHUNK_SIZE` or fewer new items, or (b) one slice-group of a single oversized LLM response, produced by the defensive code-side backstop (research.md §2). |
| Lifecycle | Planned → applied to the in-memory turn state → rendered to the client via a `diagram` stream event → (loop continues to the next chunk, or the draft phase ends). |
| Relationship to `TraceStep` | Each applied chunk emits or updates one `kind: 'draft'` trace step carrying its `chunk` index and a `chunkLabel`-derived `detail`. |

## Unchanged

`Architecture`, `AIConversation`, `GenerationRun` (top-level fields), `Project`, `User` — no schema changes beyond the additive `TraceStep.chunk` field above. The final, fully-assembled architecture persisted at the end of a turn has exactly the same shape as it does today (feature 004) — chunking is purely a mid-turn processing and transport concern.
