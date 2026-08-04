# Implementation Plan: Reliable AWS-MCP Generation with Attachable Services and Editable Cost Estimation

**Branch**: `003-editable-cost-estimation` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-editable-cost-estimation/spec.md`

## Summary

Harden the existing chat-based generation flow (feature 001) and make its already-implicit two-step
shape explicit and reliable: the official AWS MCP produces the architecture, the official AWS cost
MCP prices it, users can attach more services afterward without disturbing prior work, and the
resulting cost estimate becomes an independently editable, independently exportable artifact —
decoupled from the diagram — where a user can override a line item's quantity/usage and/or its flat
total cost (quantity wins if both are set), via inline edit or a chat instruction, with immediate
recalculation. Research (research.md) found the reliability and sequencing groundwork already
exists in `app/src/lib/generate/orchestrator.ts` and the AWS provider adapters; the real gaps are
(1) diagnosing/removing the live generation bug evidenced by leftover debug logging, (2)
distinguishing non-retryable configuration failures from retryable transient ones, (3) attach-time
duplicate merging, and (4) a wholly new, decoupled cost-override layer (`CostEstimateOverride`) plus
a narrow second LLM step for chat-driven overrides.

## Technical Context

**Language/Version**: TypeScript 5, Node.js runtime (route handlers), React 19 — unchanged from
feature 001/002.

**Primary Dependencies**: Reuses the existing stack (Next.js 16 App Router, Mongoose 9, `zod`,
`@anthropic-ai/sdk`/Groq REST for the LLM client, `@xyflow/react`). No new dependency is required —
overrides, the cost-orchestrator step, and the estimate export are built on the existing LLM client,
Mongoose, and export/audit infrastructure.

**Storage**: MongoDB via Mongoose (unchanged). One new collection: `CostEstimateOverride`
(data-model.md). No change to `Architecture`'s schema (FR-015 decoupling).

**Testing**: Same baseline as 001/002 — `next build` (compile + typecheck + prerender) as the gate;
API flows verified with scripted HTTP calls against a running server, including a deliberately
broken-env fail→retry→succeed sequence for US1 (quickstart.md); unit tests for the pure
override-merge/precedence logic (`lib/generate/overrides.ts`) and the attach-dedup logic.

**Target Platform**: Responsive web app (desktop + mobile browsers); Node server for route handlers
— unchanged.

**Project Type**: Web application (single Next.js app under `app/`) — unchanged; this feature extends
the existing app, it does not add a project.

**Performance Goals**: Override apply-and-recalculate visible within 1s (SC-004); generation success
rate ≥99% without a retry (SC-001), consistent with the constitution's 30s generation target.

**Constraints**: A cost override MUST NEVER write to `Architecture` (FR-015, enforced structurally
per research R6); overrides and the cost-orchestrator step operate only on AWS line items (Atlas
override is out of scope, per spec Assumptions); no long-term AWS credentials, all provider access
server-side (constitution III, unchanged).

**Scale/Scope**: 4 user stories, 16 functional requirements, 1 new collection, 1 new endpoint
(`PATCH /cost-overrides`), 1 extended endpoint format (`export?format=estimate`), 2 extended
endpoints (`chat/messages`, `architecture` PUT) for attach-dedup and override-merge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Official Integrations First | Architecture and pricing continue to flow through the official AWS MCP / AWS cost MCP exclusively (FR-001, FR-007); overrides and the cost-orchestrator step are a pure application-layer feature on top of official pricing output — no community pricing library introduced | PASS |
| II. Plugin-Based, Extensible Providers | `quantityField` (research R9) is added to the AWS provider's own catalog definitions (`lib/providers/aws/catalog.ts`), not to core code; override logic is provider-agnostic (reads a generic `ServiceNode`/`CostEstimate` shape) so it does not hard-code AWS specifics outside the provider plugin | PASS |
| III. API-First & Secure by Default | New/extended endpoints are backend route handlers under `app/src/app/api/`; override writes gated by `canEditProject` server-side (research R10); no provider credentials touched by this feature | PASS |
| IV. Spec-Driven Delivery | This plan derives from spec.md (post-clarification); tasks will trace to FR/SC/US ids | PASS |
| V. Verify Before Done | `next build` + the driven fail→retry→succeed scenario (quickstart.md) are required completion gates, not optional | PASS |

No violations. Complexity Tracking table intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-editable-cost-estimation/
├── plan.md                        # This file
├── research.md                    # Phase 0 output — decisions & rationale, grounded in current code
├── data-model.md                  # Phase 1 output — CostEstimateOverride + extended shapes
├── quickstart.md                  # Phase 1 output — how to run & validate
├── contracts/                     # Phase 1 output
│   ├── cost-overrides.md          # PATCH /cost-overrides + chat-driven overrides + attach-dedup
│   ├── generation-reliability.md  # tightened failure/retry contract on chat/messages
│   └── export.md                  # format=estimate addition
└── tasks.md                       # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Single existing Next.js application under `app/` (feature 001/002's structure, unchanged shape).
This feature only adds/extends files within it — no new top-level project or directory.

```text
app/
├── src/
│   ├── app/
│   │   └── api/
│   │       └── projects/[id]/
│   │           ├── chat/messages/route.ts     # EXTEND — cost-orchestrator phase, error.step, attach-dedup
│   │           ├── architecture/route.ts      # EXTEND — merge overrides + stale-flag on direct edit
│   │           ├── export/route.ts            # EXTEND — format=estimate
│   │           └── cost-overrides/route.ts    # NEW — PATCH inline override set/clear
│   ├── components/
│   │   └── studio/
│   │       ├── ChatPanel.tsx                  # EXTEND — step-aware error display, non-retryable state
│   │       └── Inspector.tsx / a new CostPanel # EXTEND/NEW — inline override UI, stale badge, reset
│   ├── lib/
│   │   ├── models/
│   │   │   ├── CostEstimateOverride.ts        # NEW
│   │   │   ├── CostEstimate.ts                # EXTEND — perService[].overridden/stale fields
│   │   │   └── AIConversation.ts              # EXTEND — messages[].error {step, retryable}
│   │   ├── generate/
│   │   │   ├── orchestrator.ts                # EXTEND — attach-dedup merge, remove debug console.log
│   │   │   ├── cost-orchestrator.ts           # NEW — chat-driven override parsing (research R8)
│   │   │   └── overrides.ts                   # NEW — pure merge/precedence/stale logic (research R5/R6/R11)
│   │   ├── providers/aws/catalog.ts           # EXTEND — quantityField per service (research R9)
│   │   └── schemas.ts                         # EXTEND — costOverridePatchSchema
```

**Structure Decision**: Extends the existing single Next.js application (no new project/option). New
domain logic lives in `lib/generate/overrides.ts` and `lib/generate/cost-orchestrator.ts`, kept free
of any `Architecture` import so the diagram/cost decoupling (FR-015) is a structural property of the
codebase, not just a documented convention.

## Complexity Tracking

No constitution violations; no entries required.
