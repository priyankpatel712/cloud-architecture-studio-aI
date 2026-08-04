# Quickstart: Validation Guide

**Feature**: `008-multi-agent-knowledge-pipeline` | **Date**: 2026-07-31 | **Plan**: [plan.md](./plan.md)

How to prove each user story works end-to-end. Per constitution Principle V, a story is "done" only when its flow has been **driven and observed** — not merely typechecked. Scenarios are grouped by story so each can be validated the moment that story ships.

---

## Prerequisites

```bash
cd app
npm install
# MongoDB must be running (default: mongodb://127.0.0.1:27017/cloud_architecture_studio)
npm run seed              # users/projects
npm run seed:knowledge    # knowledge entries (Phase 3+)
npm run dev
```

At least one AI connection must be configured (Settings → AI Provider, or `LLM_PROVIDER`/`LLM_MODEL` + key in `app/.env.local`).

**Commands used throughout**: `npm test` (vitest), `npm run build` (compile + typecheck + prerender), `npm run lint`.

---

## Phase 0 — Baseline (do this FIRST, before any tiering change)

⚠️ **This measurement is unrecoverable once role tiering is enabled** (FR-041, SC-009).

1. Confirm local secret hygiene (constitution III): `app/.env.local` untracked, ignore rules effective, no key material in tracked files or history.
   - **Verified 2026-07-31**: untracked in both the root repo and the nested `app/` repo; matched by `app/.gitignore` (`.env*`, with `!.env.example`); `git log --all -- .env.local` empty in both; no `nvapi-`/`sk-or-v1-`/`AIzaSy` material in any tracked file. **No rotation required.**
2. Record current state: `npm test` and `npm run build`, noting pass/fail.
   - **Baseline 2026-07-31**: `npm test` → **34 files / 299 tests, all passing** (13.8s, vitest 4.1.10).
3. Run the fixed request set against the **current** pipeline and record to `baseline.json`:
   - convergence rate (fraction of turns where review passed)
   - mean iterations-to-pass
   - active provider and model

**Expected**: `baseline.json` exists and is committed before any Phase 4 (model-tiering) work begins.

> **Note**: step 3 makes real LLM calls against the configured provider and needs a running MongoDB. The harness is committed at `app/scripts/measure-baseline.mjs`; it must be **run by an operator in a working environment** — its numbers cannot be fabricated.

---

## US1 — Follow-up requests are understood and scoped (P1) 🎯 MVP

**Setup**: create a project and generate a starting architecture, e.g. *"A serverless API with Lambda, API Gateway, and DynamoDB, plus a Redis cache."* Wait for the turn to complete.

| # | Action | Expected | Verifies |
|---|---|---|---|
| 1 | "rename that lambda to OrderProcessor" | Only the display name changes. No node added/removed, no unrelated reconfiguration, no re-layout. Trace shows `intent` then `direct-edit`. Completes in **under 5 seconds**. | FR-004, FR-005, SC-003 |
| 2 | "remove the Redis cache" | Cache node and all its edges disappear. Nothing else changes. Any container left empty is removed. | FR-005, FR-009 |
| 3 | "why is there a NAT gateway?" (or any question about the design) | A prose answer. **Canvas is untouched.** Result payload carries `answeredOnly: true`. | FR-007 |
| 4 | "undo that" | Assistant **offers** a restore with a labelled version and Restore/Keep options. Nothing changes until you choose. | FR-008 |
| 5 | Add a second Lambda, then say "remove the lambda" | **One** clarifying question naming both candidates. No deletion occurs. | FR-006, SC-006 |
| 6 | Delete a node by hand on the canvas, then ask "what's left to add?" | The reply reflects the manual deletion rather than describing the pre-edit diagram. | FR-001, US1 AS-5 |
| 7 | Turn 1 requests "multi-region disaster recovery"; make two unrelated edits; then force a draft that drops DR | The turn-3 self-review **fails** on the DR requirement. | FR-002, SC-002 |
| 8 | "make that database bigger" | Config changes, stays within declared field bounds, cost estimate recalculates. | FR-039 |

**Automated**: `npm test -- conversation-context brief-merge intent-sanitize intent-resolve direct-edit edit-scope-enforcement modification-eval`

**Story passes when**: the modification evaluation set reports ≥90% correctly-scoped turns (SC-001) and ≥90% of ambiguous cases asking rather than guessing (SC-006).

---

## US2 — Generation stays inside provider rate limits (P2)

| # | Action | Expected | Verifies |
|---|---|---|---|
| 1 | Run one full guided generation, then `GET /api/settings/llm/usage?window=24h` | `byRole` shows `route`/`intent`/`interpret` on small models and `plan` on the most capable. `smallMidShare ≥ 0.5`. | FR-011, SC-004 |
| 2 | Run the burst that reliably 429-failed before this feature | All turns complete. No turn fails with a rate-limit error. | FR-012, SC-005 |
| 3 | Force a 429 with a `Retry-After` header (stub provider) | Log/trace shows a wait of exactly the stated delay (when ≤8s) or a hop to the next connection — **not** an immediate retry. | FR-012 |
| 4 | Clear all `roleModels` overrides and regenerate | Generation works on defaults with no configuration. | FR-015 |
| 5 | Compare post-tiering convergence rate against `baseline.json` | At or better than baseline on convergence rate and iterations-to-pass. | SC-004, FR-041 |

**Automated**: `npm test -- llm-roles llm-role-chains retry-after llm-usage-window`

---

## US3 — Reusable knowledge (P3)

| # | Action | Expected | Verifies |
|---|---|---|---|
| 1 | `npm run seed:knowledge`, then request an architecture matching several rules | Trace shows a `knowledge` step naming consulted rules; the design reflects them. | FR-019, SC-007 |
| 2 | Force a draft placing a database in a public subnet | Self-review flags it; refinement corrects it before the turn completes. | FR-019, US3 AS-2 |
| 3 | Complete a turn where iteration 1 failed review and a refinement fixed it | A `distill` step appears **after** `result`; a new `learned` entry exists with `confidence: 0.6` and contains no project name or user literal. | FR-020, FR-021 |
| 4 | `PATCH /api/settings/knowledge/:id` with `enabled: false`, then regenerate | The rule is no longer applied. No redeploy needed. | FR-032, US3 AS-4 |
| 5 | `POST /api/settings/knowledge/reseed` twice | Second run reports `created: 0` — dedupe by content hash holds. | FR-022 |
| 6 | Inspect where AWS rules are defined | They live in `app/src/lib/providers/aws/rules.ts`, **not** in core. | FR-038, constitution II |

**Automated**: `npm test -- knowledge-store knowledge-dedupe knowledge-distill`

---

## US4 — Web research (P4)

| # | Action | Expected | Verifies |
|---|---|---|---|
| 1 | Set `TAVILY_API_KEY`; ask about something absent from store and MCPs | Trace shows a `research` step naming the search terms; result influences the design. | FR-024, FR-029 |
| 2 | Inspect the stored entry from scenario 1 | `source: 'web'`, a `sourceUrl` on an official documentation domain, `staleAfter` ≈ +14 days. | FR-025, FR-026 |
| 3 | Immediately repeat an equivalent request | **Zero** web lookups; answered from the store. | SC-007 |
| 4 | Manually age an entry past `staleAfter`, then repeat the request | The finding is re-verified from source rather than reused. | FR-026 |
| 5 | Unset all search keys; ask the same gap question | Generation completes normally using remaining sources; degradation recorded in the trace. | FR-027 |
| 6 | Inspect the outbound search query | Contains derived capability keywords only — **never** raw user request text. | FR-030 |

**Automated**: `npm test -- web-search-backend knowledge-waterfall`

---

## US5 — Operator visibility and control (P5)

| # | Action | Expected | Verifies |
|---|---|---|---|
| 1 | Run several generations, open Settings → usage panel | Real request/token counts per connection — not the previous hardcoded figures. | FR-031 |
| 2 | Assign a specific model to a role, regenerate | The assignment is honored; visible in `byRole` usage. | FR-010, FR-016 |
| 3 | Open the knowledge panel and disable a lesson | It stops being applied on the next generation. | FR-032 |
| 4 | Open settings as a non-administrator | Read-only; mutating calls return 403 server-side even if the UI is bypassed. | FR-033 |
| 5 | Keyboard-only navigation of the new controls; reduced-motion enabled | Visible focus throughout; no motion; layout responsive. | Constitution a11y floor |

**Automated**: `npm test -- usage-aggregate knowledge-admin-rbac`

---

## Non-Regression (required before "done" — FR-035, SC-008)

Re-run the prior features' quickstarts unchanged:

| Feature | Scenarios | Must still hold |
|---|---|---|
| [004](../004-agentic-generation/quickstart.md) | Live working trace, iteration budget, stop control | Trace shows every phase live; stop halts promptly without corrupting the project; turns stay within the 120s cap |
| [005](../005-incremental-diagram-updates/quickstart.md) | Incremental build-up, pacing | ≥3 progressive diagram updates for a 5+ service request; already-applied chunks survive a stop |
| [006](../006-guided-generation-flow/quickstart.md) | analyze → clarify → build → cost → finalize | The guided sequence is unchanged for new architectures and major revisions |

**Then**: `npm test` (all suites green) and `npm run build` (compile + typecheck + prerender) and `npm run lint` clean.

### SC-004 comparison (T064) — 2026-08-01, first measured round

Both files measured on the identical six-request set, same skip-all path, same
design-pass guard; the only configured variable was the tiering toggle.

| | pre-tiering (`baseline.json`) | post-tiering (`post-tiering.json`) |
|---|---|---|
| convergenceRate | 0 (0/5 designed) | 0 (0/5 designed) |
| meanIterationsToPass | – (nothing passed) | – (nothing passed) |
| smallMidShare | n/a | **0.109** (6/55 requests) — target ≥ 0.5 ✗ |

**Reading, honestly.** Quality "held" only in the vacuous sense that zero
cannot regress. Both runs were dominated by the same environmental fact: Groq's
free-tier day caps (rolling, still in force from earlier measurement runs)
pushed nearly every call onto NVIDIA NIM at ~27s per call, and 150–250s turns
cannot converge inside their budgets. The pre-tiering run failing this way is
itself the finding the feature was commissioned against — the untiered pipeline
reproducibly drowns in rate limits on this workspace's connections.

**The post run earned its keep by exposing a real miscalibration**: 54 of 55
mid-role calls (review/cost/analyze) were served by `nvidia/…nemotron-49b`,
whose catalog tier is **large** — the mid preference list led with the same
model the plan role uses, so "mid tier" was a label, not a behavior. Fixed the
same day: the mid chain now leads with genuinely mid-tagged models
(`groq/llama-3.3-70b`, `hf/Llama-3.3-70B`), pinned by a regression test
(`llm-role-chains.test.ts` "tier honesty").

**Status: measured and recorded, not yet passed.** Until a healthy round
exists, SC-004 remains open.

**Request set upgraded to v2 (2026-08-01, T124).** The measurement set is now
`aws-reference-architectures-v2`: 20 workloads grounded in official AWS
reference architectures — six generative-AI patterns (RAG assistant, document
processing, text-to-SQL, agents, content generation, semantic search) plus 14
classic categories. The v1 files above are superseded; the harness refuses to
compare files from different request sets, so the next round starts clean:

1. Wait for provider health (`npm run models:check` passes and a normal chat
   turn answers in seconds, not minutes — on 2026-08-01 the fleet was fully
   exhausted: Groq day-capped, HuggingFace out of monthly credits).
2. Settings → tiering OFF → `npm run baseline` (~40–90 min, 20 requests)
3. Settings → tiering ON → `npm run baseline -- --post` — prints the SC-004
   verdict against the new baseline.
   `npm run baseline -- --limit 5` exists for smoke runs; subset files are
   labeled and never comparable against a full run.

### Non-regression status — 2026-07-31

Each prior quickstart opens with a **Gates** block (`npx tsc --noEmit`, `npm run lint`,
`npm test`, `npm run build`). **All four gates pass**, run deliberately with MongoDB
stopped — which is how the knowledge-store stall (tasks T116) was found.

Automated coverage of the logic each feature's scenarios exercise, all green:

| Feature | Suites carrying its behavior | Tests |
|---|---|---|
| 004 | `agent-loop`, `reviewer`, `trace-emitter`, `trace-emitter-agents`, `orchestrator` | 30 / 9 / 7 / + |
| 005 | `chunking`, `agent-loop` (chunk-round guarantees) | 5 / + |
| 006 | `flow`, `cost-options`, `finalize`, `walkthrough` | 14 / 15 / 11 / 4 |

**What this does and does not establish.** The suites pin the loop's decision logic,
the once-per-iteration guarantees across chunk rounds, the reviewer's hard gates, the
step-kind enum staying in sync between emitter and Mongoose schema (a mismatch silently
loses a whole persisted trace), and the guided flow's ordering. They do **not** exercise
a browser, a live model, or a running database.

**Still genuinely manual** — needs `npm run dev`, MongoDB, and a keyed provider:

- 004 Scenarios 1–7: live NDJSON step timing (≤1s), stop mid-run returning to `idle`,
  budget exhaustion wording, screen-reader announcements at phase boundaries only.
- 005 Scenarios 1–6: ≥3 progressive canvas updates for a 5+ service request, and
  already-applied chunks surviving a stop.
- 006 Scenarios 1–8: the analyze → clarify → build → cost → finalize sequence observed
  end to end, including the interrupt/resume/supersede paths.

These are UI- and provider-timing assertions; there is no way to claim them from a
test run, so they are left unchecked below rather than marked done.

---

## Sign-off Checklist

- [X] Phase 0 baseline recorded **before** any tiering change (SC-009) — 2026-08-01, tiering off, 6/6 requests measured on full design passes. **Caveat**: recorded while Groq was day-capped and every call rode the fallback chain, so convergenceRate (0.1667) reflects duress, not normal quality; re-run `npm run baseline` under healthy providers before switching tiering on (one command, overwrites the file)
- [ ] US1 scenarios 1–8 observed passing; evaluation set ≥90% (SC-001, SC-006)
- [ ] US2 burst test completes with zero rate-limit failures (SC-005); `smallMidShare ≥ 0.5` (SC-004)
- [ ] US3 rules applied *and* graded; a distilled lesson verified project-agnostic (FR-021)
- [ ] US4 repeat request performs zero web lookups (SC-007)
- [ ] US5 usage panel shows real data; RBAC enforced server-side — endpoints and panels built; `usage-aggregate` (15) and `knowledge-admin-rbac` (18) green, including 403 for a non-super-admin on edit/delete
- [ ] Features 004/005/006 quickstarts pass unchanged (SC-008) — automated portion green; live scenarios pending, see above
- [X] `npm test`, `npm run build`, `npm run lint` all clean (constitution V) — **2026-07-31: 53 files / 527 tests pass; build compiles; lint clean**
