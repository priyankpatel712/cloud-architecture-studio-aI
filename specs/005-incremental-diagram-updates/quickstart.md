# Quickstart Validation: Incremental Diagram Build-Up During Generation (Feature 005)

Runnable scenarios proving the feature end-to-end. Prerequisites: `npm run dev` in `app/`, MongoDB up, `.env.local` with LLM + MCP config (as in 004), a verified test user.

## Gates (run first, and after every change)

```powershell
cd app
npx tsc --noEmit
npm run lint
npm test          # includes new chunking tests + all 001–004 suites (SC-004)
npm run build     # constitution V
```

## Scenario 1 — Progressive build-up on a large request (US1 / SC-001)

Send a 5+ service prompt to a fresh project:

> "Design a serverless API with API Gateway, Lambda, DynamoDB, a WAF in front, Cognito for auth, and CloudWatch monitoring."

**Expect** in the NDJSON stream: at least 3 `diagram` events before the terminal `result`, each carrying a growing `nodes` array (strictly more nodes than the previous `diagram` event). Watching the studio canvas (or the creation page), the architecture visibly grows piece by piece rather than appearing all at once. `step` events for `kind:'draft'` show a `chunk` field incrementing across the draft steps of iteration 1.

## Scenario 2 — Small request stays fast, unchunked (US2/AC3, SC-003)

Send a 1-2 service prompt:

> "Add an S3 bucket for file uploads."

**Expect**: exactly one `diagram` event (chunk 1) before the terminal `result`; total turn duration is not measurably slower than an equivalent single-shot 004 turn — no perceptible extra delay from the chunking machinery.

## Scenario 3 — Consistent chunks, no dangling references (FR-003)

Re-run Scenario 1's prompt (or a request needing 6+ new services) and inspect each `diagram` event's `edges`: every edge's `source`/`target` resolves to a node present in that same `diagram` event's `nodes` array — never a reference to a service that only appears in a later event.

## Scenario 4 — Stop mid-chunking preserves progress (US1/AC3, FR-007)

Start a generation large enough to produce multiple chunks; shortly after the first `diagram` event, `POST /api/projects/{id}/chat/stop` (or click Stop in the UI). **Expect**: the stream ends with a `stopped` event; the canvas retains whatever the last `diagram` event showed (not rolled back to empty); behavior otherwise matches 004's stop contract.

## Scenario 5 — Chunk failure preserves prior chunks (FR-010)

Force a mid-turn failure after at least one chunk has applied (e.g. temporarily misconfigure the LLM key mid-run, or use a request likely to trip a provider error on a later chunk). **Expect**: the turn surfaces as a failure the same way a 004 whole-turn failure does, but the canvas keeps whatever chunks applied successfully before the failure — never rolled back to the pre-turn state.

## Scenario 6 — Regression guarantees carry over (US3, FR-011, SC-004)

Re-run feature 004's quickstart Scenarios 2, 3, 5, 6, and 7 (live trace + persistence, budget exhaustion, cost/attach-dedup/MCP-degradation regression, edit scoping, accessibility floor) unmodified. All must still pass — a multi-chunk turn does not trigger an extra `aria-live` announcement per chunk (only the existing boundary/failure/completion announcements fire).

## Live results (2026-07-09, NVIDIA `nvidia/llama-3.3-nemotron-super-49b-v1`, curl smoke test)

Full unit/integration suite (131 tests, 21 files, including the new `chunking.test.ts` and the
extended `agent-loop.test.ts` chunk-round-loop suite) passes, as does `tsc --noEmit`, `npm run
lint`, and `npm run build`. Live verification against a running dev server + real NVIDIA provider:

- **Scenario 1 (progressive build-up)**: real run — "Design a serverless API with API Gateway,
  Lambda, DynamoDB, a WAF in front, Cognito for auth, and CloudWatch monitoring" (6 new services).
  The model returned all 6 adds in a **single** plan call (round 1) despite the CHUNK_SIZE=4
  prompt instruction — the defensive slicing backstop (research §2) correctly split it into 2
  `diagram` events (`chunk:1` with 4 new services + their ready edges, `chunk:2` with the
  remaining 2 + their edges), each internally consistent (no dangling edges), each a strict
  superset of the previous. Confirms FR-001/002/003 and the backstop hold under a real
  non-compliant model response. **Note**: this landed at 2 progressive updates, not the "≥3"
  aspirational SC-001 threshold for "5+ services" — with the default CHUNK_SIZE=4, `ceil(6/4)=2`.
  SC-001's threshold is most reliably met at 7+ new services under this default; CHUNK_SIZE is
  env-tunable (FR-008, `AGENT_CHUNK_SIZE`) if a deployment wants a lower threshold — trading
  smaller chunks for more LLM round-trips (real cost on an already-slow provider like NVIDIA, see
  below). Recorded here rather than silently tuned, per the spec's own Assumptions note that the
  default is expected to be adjusted against real provider behavior.
- **Scenario 2 (small request, single chunk, no regression)**: real run — "Add an S3 bucket for
  file uploads" (1 service). Exactly one `diagram` event (`chunk:1`); `plan`/`apply` step ids
  stayed bare with no `chunk` field (byte-identical to 004's shape) — confirms FR-009/SC-003.
- **Non-regression (T018/T019, live)**: in the 6-service run, `layout`/`price`/`validate:1` each
  ran exactly once, *after* both diagram chunks were applied — not once per chunk. `review:1` also
  ran once; the loop then correctly returned `best_effort` (not `converged`) because NVIDIA's
  real latency (the single plan call took ~2m5s) ate into the turn's time budget — the existing
  FR-006 time-budget guard degraded gracefully exactly as it does today, unaffected by chunking.
  Final estimate ($52.79/mo across 7 services) confirms the constitution v1.3.0 cost-realism fix
  is unaffected by chunking.
- **Provider reliability (not a 005 regression)**: three live attempts hit pre-existing NVIDIA/
  Nemotron failure modes documented earlier this session — "malformed JSON" (guided_json not
  reliably enforced for reasoning models) and one backend-side "Already borrowed" error — both on
  round 1, both surfaced correctly as a `type:'error'` event via the unchanged 003/004
  architecture-phase-failure contract. Confirms round-1 failure propagation is unaffected by the
  chunking refactor.
- **Scenarios 4/5 (stop mid-chunking / chunk failure preserves progress)**: not reproduced live
  (round ≥2 failures and mid-round stops are timing-dependent and hard to trigger on demand against
  a real provider); covered by `agent-loop.test.ts`'s "chunk round failing after the first
  preserves every prior round's applied chunks" and "a stop requested between chunk rounds..."
  tests, which exercise the exact same `runChunkRounds` code path.

## Reference

- Protocol/shapes: [contracts/incremental-generation.md](./contracts/incremental-generation.md)
- Entities: [data-model.md](./data-model.md)
- Decisions: [research.md](./research.md)
