# Quickstart: Guided Diagram Generation Flow — Validation Guide

**Feature**: 006-guided-generation-flow | **Date**: 2026-07-09

Runnable end-to-end scenarios proving the feature per Principle V. Protocol/entity details:
[contracts/guided-flow-protocol.md](./contracts/guided-flow-protocol.md),
[data-model.md](./data-model.md).

## Prerequisites

```powershell
cd app
npm install
# .env.local: MONGODB_URI, JWT secret, LLM_PROVIDER/LLM_API_KEY (+ LLM_MODEL if overriding),
# optional AWS/MongoDB MCP config — same setup as features 004/005
npm run dev
```

Sign in, or create a fresh account. Scenarios 1–5 flow through one project; 6–7 need an
existing architecture.

## Scenario 1 — Analyze + clarify before anything is drawn (US1 / FR-001..006 / SC-001, SC-002)

1. Create a new project via chat with an ambiguous request: *"an online shop with user
   accounts and search"*.
2. **Expect**: the assistant replies with an analysis summary (capabilities, assumptions,
   constraints) and a question card of ≤5 request-specific questions, at least one being a
   service choice (e.g. database or search options) with 2–4 candidates, one marked
   Recommended, each with a one-line trade-off. **The canvas is empty** — no `diagram` events,
   no architecture persisted (verify canvas + refresh).
3. Answer the questions, picking a NON-recommended service candidate.
4. **Expect**: the build turn starts (live trace + progressive canvas build-up as in 004/005)
   and the finished draft contains the exact service you selected plus a service per confirmed
   capability (FR-008). The question card is now read-only showing your recorded answers.

## Scenario 2 — Skip-all path with disclosed defaults (US1-S4 / FR-004)

1. New project, same ambiguous request; when the question card appears, click **"Use defaults
   & build"** (or type *"just build it"*).
2. **Expect**: the build proceeds immediately; the assistant's reply explicitly lists the
   defaults it applied (MVP-scale assumptions, recommended service candidates).

## Scenario 3 — Fully-specified request skips the questionnaire (US1-S5)

1. New project with an exhaustive request (name the services, scale, region explicitly).
2. **Expect**: the analyze turn states no clarification is needed and continues straight into
   the build in the same stream — no question card, single turn.

## Scenario 4 — Cost dialogue with two priced options (US2 / FR-009..011 / SC-004)

1. Continue from Scenario 1's completed build.
2. **Expect**: after the draft persists, the assistant asks ≤3 cost questions (usage/growth/
   budget sensitivity) — answer or skip them.
3. **Expect**: a pricing options card with **cheapest** and **best practice** side by side,
   each with an itemized monthly estimate and plain-language trade-offs (indicative badges if
   the pricing source is offline). Select **cheapest**.
4. **Expect**: node configs and the project cost estimate update to the cheapest variant
   (check CostPanel + toolbar total); no structural change to the diagram; the choice is
   recorded in the thread.
5. Type *"switch to the best practice option"*.
6. **Expect**: configs/estimate re-apply from the stored option without a regeneration
   (fast turn, no draft/chunk steps in its trace).

## Scenario 5 — Final alignment and flow pass (US3 / FR-012 / SC-006)

1. Run a guided generation producing 8+ services (e.g. multi-tier web platform).
2. **Expect** after the pricing option applies: the final diagram flows left→right from entry
   points to data tiers, related services are grouped, and **zero nodes/containers overlap**
   (inspect visually + no edge through an unrelated node). The trace shows a `finalize` step.
3. Revision variant: manually drag two existing nodes somewhere distinctive, then request a
   major revision and complete the flow. **Expect**: your hand-placed untouched nodes keep
   their positions; only new/changed elements are laid out.

## Scenario 6 — Small edits bypass the guided flow (US4 / FR-013 / SC-007)

1. On the existing architecture, send *"rename the API gateway to Edge API"* and then
   *"add a cache in front of the database"*.
2. **Expect**: both apply directly — no analysis card, no questions, no cost round; latency
   comparable to today. Then send *"redesign this for multi-region DR"* and **expect** the
   full guided sequence to engage (analysis + questions).

## Scenario 7 — Interrupts, resume, and supersede (edge cases / FR-014)

1. Open round + close the tab; reopen the project. **Expect**: the question card re-renders
   from the thread, still answerable.
2. While a round is open, type a materially different request (*"actually make it a mobile
   game backend"*). **Expect**: old round marked superseded (read-only), fresh analysis +
   round for the new request.
3. Press Stop during a build turn. **Expect**: 004/005 stop semantics unchanged (applied
   chunks kept, thread usable, retry possible).
4. Give contradictory answers (pick the cheapest DB candidate, then demand a capability only a
   premium tier has in a text answer). **Expect**: one targeted follow-up, not a silent pick.

## Scenario 8 — Budgets, build gates, and unit tests (SC-008 / Principle V)

```powershell
cd app
npm run test        # vitest — analyze.test.ts, flow.test.ts, cost-options.test.ts,
                    # finalize.test.ts, agent-loop.test.ts all green
npm run lint
npm run build       # next build must pass (compile + TS + prerender)
```

- Time each active phase in Scenarios 1–5 (network tab per turn): every turn completes within
  the 120s hard cap; think-time between turns has no effect on any turn's behavior.
- Accessibility spot-check: navigate a question card and the pricing card with keyboard only
  (visible focus, operable); enable reduced motion (no animated reveals); screen reader
  announces round arrival once (boundary-only).

## Sign-off checklist

- [ ] Scenarios 1–7 observed as described (screenshots or notes per scenario)
- [ ] Scenario 8 gates green (`test`, `lint`, `build`)
- [ ] SC-001/002/004/006/007 spot-verified against the scenario evidence
- [ ] No regression on a legacy thread (pre-feature conversation still renders and can post)
