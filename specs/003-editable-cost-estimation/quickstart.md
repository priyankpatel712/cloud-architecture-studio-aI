# Quickstart & Validation — Reliable Generation, Attachable Services, Editable Cost Estimation

How to run the app and validate this feature end-to-end. Implementation details live in `tasks.md`.
Builds on `specs/001-mvp-baseline/quickstart.md` (same setup, same running app) — this feature adds
no new run/setup steps, only new flows to exercise.

## Prerequisites

Same as `001-mvp-baseline`: `app/.env.local` with `MONGODB_URI`, `AUTH_SECRET`, and the LLM/AWS MCP
env vars (`LLM_PROVIDER`, `LLM_API_KEY`, `AWS_MCP_COMMAND`, `AWS_MCP_TOOL`, `AWS_COST_MCP_COMMAND`).
For US1's reliability scenarios you will deliberately unset/break these — keep a working `.env.local`
backed up.

```bash
cd app
npm install
npm run dev         # http://localhost:3000
```

## Validation scenarios (map to user stories)

- **US1 Dependable generation**: with a valid `LLM_API_KEY`/`AWS_MCP_COMMAND`, send a well-formed
  prompt with the AWS tool attached — a costed, editable architecture appears. Then unset
  `LLM_API_KEY` (or point `AWS_MCP_COMMAND` at a nonexistent binary) and send another prompt — the
  chat must show a specific, non-generic reason and, per the reliability contract, must **not** offer
  a retry for this configuration-cause failure (`retryable: false`). Restore the env var, retry the
  same message, and confirm the architecture updates cleanly with no duplicate nodes/edges left from
  the failed attempt (inspect `Architecture.nodes`/`edges` counts before and after).

- **US2 Attach services**: with an existing generated architecture, ask the assistant to attach an
  already-present service (e.g. "add another EC2 instance" when one already exists) — confirm the
  existing node's quantity increments rather than a second node appearing. Then attach a new,
  not-yet-present service via chat, and a different one directly from the catalog panel — confirm
  both merge into the same architecture without moving or reconfiguring unrelated nodes, and the
  total cost includes all of them.

- **US3 Edit the cost estimate**: on a priced architecture, use the cost panel's inline edit to set a
  service's quantity, then another service's fixed total-cost override — confirm both are visually
  marked manual and the architecture total updates immediately. Reset one — confirm it reverts to the
  computed value. Then, via chat, say something like "set the EC2 cost to $200/month" — confirm the
  same override is applied as if it were set inline. Change that service's configuration afterward
  (e.g. its instance type) — confirm the override value is kept but the line is flagged as possibly
  outdated. Try an invalid value (negative) — confirm it's rejected with a specific message and
  nothing changes. As a read-only shared user, confirm overrides are visible but not editable.

- **US4 Export the estimate as a proposal**: with at least one override in place, export
  `format=estimate` — confirm the returned document lists every line item (computed and overridden,
  clearly marked, including the stale flag if applicable) and totals, and requires no diagram data.
  Separately export the diagram (`png`/`pdf`/`mermaid`/`json`) and confirm it succeeds independently
  and contains no cost-override detail beyond what feature 001 already includes.

## Gates (Constitution V — verify before done)

1. `npm run build` passes (compile + typecheck + prerender).
2. `npm run lint` clean.
3. Every scenario above is driven and observed, not just typechecked — in particular the
   fail→retry→succeed sequence in US1 must be run against a real broken/restored env var, not
   simulated.
4. No duplicate `Architecture.nodes`/`CostEstimate` documents result from a retried failed turn.
5. A cost override never appears as a change to `Architecture.nodes[].config` (decoupling, FR-015) —
   confirm by diffing the architecture document before and after setting an override.
