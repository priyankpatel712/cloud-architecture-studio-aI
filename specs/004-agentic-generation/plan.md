# Implementation Plan: Agentic Architecture Generation with Live Working Trace

**Branch**: `004-agentic-generation` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-agentic-generation/spec.md`

## Summary

Re-architect the chat generation turn from single-shot prompt calls into an **agentic multi-phase loop** — understand → gather (official MCPs) → draft → self-review → refine (≤3 iterations) — implemented as a hand-rolled loop-engineering harness structured after Anthropic's official agent patterns (prompt chaining + evaluator-optimizer), not a community framework (research R1/R2). Every phase, lookup, verdict, and refinement is emitted over the existing NDJSON step stream (extended with `kind`, `iteration`, `detail`) and persisted as a separate **GenerationRun** document that the assistant message references by `runId` and the UI fetches on demand when expanded (Clarification Q3) — giving the chat window a live, AI-IDE-style working view and a permanent, expandable record without weighing down thread reads. The live trace UI meets the constitution's a11y floor (reduced-motion, keyboard, polite announcements — FR-012/SC-007). A stop endpoint lets the user cancel a running loop safely. All 001/002/003 guarantees (preserve-user-work, attach-dedup, decoupled cost phase, step-aware failures, plan sanitization) are preserved by keeping the existing apply/pricing machinery as the loop's tools.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16 (App Router, route handlers, Node runtime) — existing stack

**Primary Dependencies**: No new runtime dependencies. Existing: Mongoose 9, zod, `@modelcontextprotocol/sdk` (stdio MCP clients), elkjs (layout), React Flow. LLM access stays in `src/lib/llm.ts` (provider-agnostic: anthropic | groq | nvidia via env). LangChain/LangGraph evaluated and rejected (research R1).

**Storage**: MongoDB — new `GenerationRun` collection holds each turn's full trace; `AIConversation.messages[]` gains a lightweight `runId` reference + run-summary fields (`iterations`/`converged`/`stopped`/`stepCount`); conversation gains a `stopRequested` flag (research R4/R5, Clarification Q3). The full trace is fetched on demand, never embedded in the thread read.

**Testing**: vitest unit tests (loop controller, verdict gating, trace assembly, sanitizers); live NDJSON verification scripts per quickstart.

**Target Platform**: Existing Next.js server (Node runtime), dev on Windows/Laragon.

**Project Type**: Web application (existing `app/` — single Next.js project).

**Performance Goals**: SC-004 — 90% of turns ≤ 90s; hard cap via route `maxDuration` raised to 120s + loop budget (≤3 refine iterations, per-iteration time check). This 90s/120s envelope is the one enshrined in constitution v1.2.0 (amended for this feature). Step events visible ≤1s after occurrence (SC-002) — already satisfied by unbuffered NDJSON writes.

**Constraints**: NVIDIA NIM `guided_json` is not reliably enforced (established in 003 follow-up) → every loop phase keeps schema-light JSON output + `sanitizePlan`-style coercion; native tool-calling APIs are NOT assumed (provider-agnostic loop uses structured per-phase calls instead — research R3). One generation at a time per project (existing 409 + stale-lock guard reused). Accessibility floor is mandatory (FR-012/SC-007): the live/persisted trace UI disables step animations under reduced-motion, keeps expand/collapse keyboard-operable with visible focus, and announces phase/iteration boundaries, failures, and completion via a polite ARIA live region — not every step.

**Scale/Scope**: Single-user dev-stage app; loop adds ≤4 extra LLM calls per turn worst-case (review + refine × ≤3); trace ≤ ~60 steps/turn.

## Constitution Check

*GATE: evaluated pre-Phase-0 and re-checked post-design — PASS (no violations).*

| Principle | Compliance |
|---|---|
| I. Official Integrations First | Grounding stays on official AWS/MongoDB MCPs (unchanged). Orchestration follows **Anthropic's official agent-pattern guidance** (build directly on the LLM API; evaluator-optimizer loop) rather than adding a community framework — research R1 documents why LangChain/LangGraph was rejected. No new community dependency introduced. |
| II. Plugin Providers | The loop calls providers only through the existing plugin registry (`getProvider(id).mcp/pricing`); no provider specifics enter core loop code. LLM provider remains env-swappable through `llm.ts`. |
| III. API-First & Secure | Loop runs entirely server-side in the chat route; the browser receives only the NDJSON step stream and persisted traces. Stop endpoint is owner-gated server-side. No credentials to the client. |
| IV. Spec-Driven | This plan implements spec 004; research resolves all unknowns before design. |
| V. Verify Before Done | quickstart.md defines end-to-end validation (live stream, on-demand trace fetch, stop, budget exhaustion, a11y); `next build` + vitest gates retained. |
| Accessibility & responsiveness floor (non-optional) | The trace UI honors reduced-motion (no step animations; instant state changes), is keyboard-operable with visible focus, and uses a polite ARIA live region announcing phase/iteration boundaries, failures, and completion (FR-012/SC-007); the trace scrolls within the chat at mobile widths. |
| Performance envelope | 90s p90 / 120s hard cap matches constitution v1.2.0 (amended for this feature via `/speckit-constitution`); the legacy single-shot 30s target is untouched. |
| YAGNI / simplicity | Hand-rolled ~200-line loop controller over a framework; reuses the existing apply/price/sanitize machinery as loop tools. One new collection (`GenerationRun`) — required by the spec's separate-storage clarification (FR-006), not speculative. |

## Project Structure

### Documentation (this feature)

```text
specs/004-agentic-generation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── agentic-generation.md   # NDJSON v2 protocol, trace shape, stop endpoint
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
app/src/
├── lib/
│   ├── llm.ts                          # unchanged surface; reused per phase
│   ├── generate/
│   │   ├── agent-loop.ts               # NEW — loop controller: phases, iteration budget,
│   │   │                               #   review verdicts, refinement, trace assembly, abort checks
│   │   ├── reviewer.ts                 # NEW — self-review LLM call + verdict sanitizer
│   │   ├── orchestrator.ts             # REFACTORED — existing gather/plan/apply/layout/price
│   │   │                               #   become loop-invocable tools; sanitizePlan reused
│   │   ├── cost-orchestrator.ts        # unchanged (cost phase stays decoupled)
│   │   └── overrides.ts                # unchanged
│   └── models/
│       ├── AIConversation.ts           # messages[].runId + run summary; conversation.stopRequested
│       └── GenerationRun.ts            # NEW — separate trace document (steps[] + run summary)
├── app/api/projects/[id]/chat/
│   ├── messages/route.ts               # streams v2 step events; writes GenerationRun + message
│   │                                   #   summary; runs agent-loop
│   ├── runs/[runId]/route.ts           # NEW — GET owner/viewer-gated full trace, on demand
│   └── stop/route.ts                   # NEW — POST owner-gated stop
└── components/studio/
    └── ChatPanel.tsx                   # live trace grouped by iteration; persisted trace
                                        #   collapsed on past messages, fetched via runs/[runId]
                                        #   on expand; Stop button while sending; a11y: reduced-
                                        #   motion, keyboard focus, polite aria-live announcements
app/tests/
├── agent-loop.test.ts                  # NEW — budget, convergence, verdict gating, abort
└── (existing suites unchanged — SC-005 regression gate)
```

**Structure Decision**: Single existing Next.js project; the agent loop is a new module in `lib/generate/` composing the already-tested orchestrator internals, so 001/002/003 behavior is inherited rather than reimplemented. The trace lives in a new `GenerationRun` collection referenced by the message (Clarification Q3), so thread reads stay unchanged in weight and the full trace loads only on expand.

## Complexity Tracking

No constitution violations to justify. (The one debatable call — refusing the LangChain dependency the user name-checked — is the *simpler* option and is backed by the official vendor guidance; see research R1.)
