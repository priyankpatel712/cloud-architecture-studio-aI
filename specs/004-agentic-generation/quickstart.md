# Quickstart Validation: Agentic Architecture Generation (Feature 004)

Runnable scenarios proving the feature end-to-end. Prerequisites: `npm run dev` in `app/`, MongoDB up, `.env.local` with LLM + MCP config (as in 003), a verified test user.

## Gates (run first, and after every change)

```powershell
cd app
npx tsc --noEmit
npm run lint
npm test          # includes new agent-loop tests + all 001–003 suites (SC-005)
npm run build     # constitution V
```

## Scenario 1 — Iterative self-refinement (US1 / SC-001)

Via the API (or the creation page), send a 5+ capability prompt to a fresh project:

> "Design a high-availability fintech API: API Gateway, Lambda, WAF protection, Cognito auth, KMS encryption, and a multi-region MongoDB Atlas cluster for DR, inside a dedicated VPC."

**Expect** in the NDJSON stream: `understand → lookup(aws) → lookup(mongodb) → draft → validate → layout → price → review` steps with `iteration:1`; if the review fails, `refine`/`draft`/`review` steps with `iteration:2+`; terminal `result` whose `message.converged` is true, `trace` non-empty, and whose architecture contains every named capability. Verify early exit: a trivially satisfiable prompt ("a single S3 bucket") completes with `iterations:1` and no refine steps.

## Scenario 2 — Live trace + persistence (US2 / SC-002, SC-003)

While Scenario 1 runs, watch the studio ChatPanel: every step appears live (≤1s), grouped by iteration, with detail text on lookups and review verdicts. After completion, reload the project: the assistant message offers "Show working (N steps, M iterations)"; **expanding it issues `GET /api/projects/{id}/chat/runs/{runId}`** and renders the full trace; a shared read-only user sees it too. Confirm separation of concerns: `GET /api/projects/{id}/chat` returns only `runId`, `iterations`, `converged`, `stopped`, `stepCount` on the message (NOT the full `steps`); `GET …/chat/runs/{runId}` returns the `steps`. A cross-project `runId` returns 404.

## Scenario 3 — Budget exhaustion, best effort (US3/AC1, FR-004)

Send a contradictory prompt (e.g. "serverless-only architecture that also runs everything on self-managed EC2 with no managed services"). **Expect**: loop runs to its 3-iteration cap, terminal `result` with `converged:false`, reply text explicitly naming what remains unmet, thread usable, canvas holds the best draft.

## Scenario 4 — Stop mid-run (US3/AC2, FR-009, SC-006)

Start a generation; within the first seconds `POST /api/projects/{id}/chat/stop` (or click Stop in the UI). **Expect**: `202 {"stopping":true}`; the stream ends with a `stopped` event; the thread gains a "stopped" assistant message with the partial trace; `conversation.status` returns to `idle`; an immediate follow-up message succeeds (no 409). If stopped before the persist phase, the canvas is unchanged.

## Scenario 5 — Regression guarantees (FR-007/FR-008, SC-005)

Re-run the 003 verification flows: cost override via chat ("set the RDS cost to $500/month"), inline override + reset, attach-dedup ("add another EC2"), MCP-failure degradation (unset `AWS_MCP_COMMAND` → indicative mode with the degradation visible as a failed `lookup` step in the trace). All must behave exactly as documented in specs/003.

## Scenario 6 — Edit scoping (FR-011)

On an existing hand-arranged architecture, request one addition ("add an SQS dead-letter queue for the Lambda"). **Expect**: untouched nodes keep configs/connections (positions may re-layout per the 003 structural-change rule); the trace shows the understand step's change scope; no refinement touches unrelated nodes.

## Scenario 7 — Accessibility floor (FR-012 / SC-007)

With the OS "reduce motion" setting enabled, run a generation: step rows appear and change state **instantly, with no animation**. Using the keyboard only, Tab to a persisted "Show working…" toggle — it takes **visible focus** and expands/collapses on Enter/Space; the loaded steps are reachable/scrollable by keyboard. With a screen reader active, confirm announcements fire at **phase/iteration boundaries, on a failed step, and at turn completion** — but NOT on every individual step (no flooding). At a mobile viewport width, the live and persisted trace regions scroll within the chat without breaking layout. `npm run build` stays green.

## Reference

- Protocol/shapes: [contracts/agentic-generation.md](./contracts/agentic-generation.md)
- Entities: [data-model.md](./data-model.md)
- Decisions: [research.md](./research.md)
