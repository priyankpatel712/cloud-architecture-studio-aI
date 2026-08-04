# Implementation Plan: Incremental Diagram Build-Up During Generation

**Branch**: `005-incremental-diagram-updates` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-incremental-diagram-updates/spec.md`

## Summary

Today, one generation turn's "draft" phase (feature 004's `draftAndApply`) plans the entire
architecture change in a single LLM call, and the client only sees the result when the whole
turn finishes. This feature splits that single call into a small uniform loop of smaller
chunk-planning calls (each capped at `CHUNK_SIZE` new services/containers, each aware of every
prior chunk already applied this turn), applies and streams each chunk's result to the canvas
immediately via a new additive NDJSON `diagram` event, and paces the calls with a short
inter-chunk delay. A defensive code-side slicing backstop guarantees the visible incremental
build-up even if a single chunk response comes back oversized. Everything downstream of the
draft phase (validate, layout, price, review, persist, the accessibility floor, the stop
control) is unchanged — chunking is purely a mid-turn, pre-persist concern layered inside the
existing agentic loop from feature 004.

## Technical Context

**Language/Version**: TypeScript 5.x, Next.js 16 (App Router) — unchanged, no new stack element.

**Primary Dependencies**: None new. Reuses `@/lib/llm` (llmJson), the existing NDJSON streaming
route (`app/src/app/api/projects/[id]/chat/messages/route.ts`), `@/lib/generate/orchestrator.ts`,
`@/lib/generate/agent-loop.ts`, `@/lib/generate/trace-emitter.ts`, and the React Flow canvas
already driven by `ChatPanel.tsx` / `projects/new/page.tsx`.

**Storage**: MongoDB via Mongoose — one additive optional field (`TraceStep.chunk`) on the
existing `GenerationRun` sub-document; no new collection, no migration.

**Testing**: Vitest, following the existing LLM-mocked pattern (`tests/agent-loop.test.ts`) —
new tests mock multi-round `llmJson` responses to verify chunk sequencing, the slicing backstop,
and the `moreNeeded` termination signal.

**Target Platform**: Same — Next.js web app, Node runtime route handlers.

**Project Type**: Web service (existing single Next.js app under `app/`) — not a new project.

**Performance Goals**: SC-001 (≥3 progressive `diagram` events for a 5+ service request);
SC-003 (no measurable added latency for a 1-2 service request vs. today's single-shot call).

**Constraints**: The existing 90s p90 / 120s hard-cap turn budget (constitution v1.2.0) applies
across all chunks combined, unchanged; chunking must not push a normal-sized turn's own request
timing into risking a configured provider's requests-per-minute cap (mitigated via inter-chunk
pacing, not hard-guaranteed under concurrent-turn load — see research.md §3).

**Scale/Scope**: Single-turn generation loop change; one new additive NDJSON event type; no new
API routes; architectures at today's scale (single-digit to low-double-digit node counts).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Official Integrations First | No new external dependency introduced. PASS. |
| II. Plugin-Based, Extensible Providers | No provider-specific logic added; chunking is provider-agnostic (works the same regardless of which LLM provider is configured). PASS. |
| III. API-First & Secure by Default | No new client-exposed secret or credential path; the new `diagram` event carries only already-public-to-the-owner architecture data, over the same authenticated route. PASS. |
| IV. Spec-Driven Delivery | This feature is flowing through `/speckit-specify` → `/speckit-plan` → (next) `/speckit-tasks` → `/speckit-implement`, per this constitution's Development Workflow. PASS. |
| V. Verify Before Done | quickstart.md defines runnable scenarios (real multi-service generation observed end-to-end); `next build` gate carried over unchanged. PASS. |
| Tech constraint — Performance | The 90s p90 / 120s hard cap (feature 004 amendment) is preserved as a turn-wide budget; chunking must not regress it for small requests (SC-003) or blow it for large ones (chunks share the same `timeRemaining()` check already in `agent-loop.ts`). PASS — re-verify empirically in quickstart Scenario 2. |
| Tech constraint — Cost realism (v1.3.0) | Unaffected — chunking only changes how `add`/`edges`/`containers` are planned and applied; the cost-realism prompt guidance and `clampToFieldBounds` backstop (constitution v1.3.0) apply identically regardless of chunk boundaries, since pricing still runs once per iteration on the fully-assembled state. PASS. |
| Tech constraint — Accessibility floor | The new `diagram` event is explicitly NOT wired to its own `aria-live` announcement (contracts/incremental-generation.md §3), preserving the existing boundary-only announcement policy. PASS. |

**Result**: No violations. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/005-incremental-diagram-updates/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── incremental-generation.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created by /speckit-plan)
```

### Source Code (repository root)

Existing single Next.js app under `app/` — this feature only touches files already established
by features 001/003/004; no new top-level directory.

```text
app/src/lib/generate/
├── orchestrator.ts        # draftAndApply → split into a chunk-round primitive; PLAN_SCHEMA
│                           # gains moreNeeded/chunkLabel; defensive slicing backstop lives here
│                           # alongside the existing decideAdds/resolveRef index-resolution
├── agent-loop.ts           # runAgentLoop's draft phase becomes a chunk loop (CHUNK_SIZE-bounded,
│                           # CHUNK_DELAY_MS-paced); everything after (validate/layout/price/
│                           # review) still runs once per iteration on the assembled result
├── loop-config.ts          # + CHUNK_SIZE, CHUNK_DELAY_MS (env-overridable, same intEnv() pattern)
└── trace-emitter.ts        # step() gains an optional chunk param; + a diagram() emit helper

app/src/lib/models/
└── GenerationRun.ts        # traceStepSchema + optional `chunk: Number`

app/src/app/api/projects/[id]/chat/messages/
└── route.ts                 # forwards the new diagram() emits into the NDJSON stream (additive)

app/src/components/studio/
├── ChatPanel.tsx            # consumes `diagram` stream events → pushes architecture to canvas
│                           # live (reuses the existing onArchitecture-style callback)
└── WorkingTrace.tsx          # renders a chunked draft step's `chunk` field in its label

app/src/app/(dashboard)/projects/new/page.tsx
                            # same `diagram` event handling as ChatPanel (first-generation surface)

app/tests/
├── agent-loop.test.ts       # extended: chunk-loop sequencing, moreNeeded termination
└── (new) chunking.test.ts   # defensive slicing backstop, unit-level
```

**Structure Decision**: Extend the existing feature 004 module layout in place — no new
top-level module, no new API route. The draft phase's internals change (single call → chunk
loop); its external contract to the rest of `agent-loop.ts` (returns a `DraftResult` covering
everything applied this iteration) is unchanged, so `layoutIfStructural`/`priceArchitecture`/
`validateArchitecture`/`reviewDraft` call sites in `agent-loop.ts` need no modification beyond
where the draft call itself is invoked.

## Complexity Tracking

*No entries — Constitution Check passed with no violations.*
