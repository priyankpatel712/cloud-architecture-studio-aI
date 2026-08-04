# Research: Agentic Architecture Generation (Feature 004)

**Date**: 2026-07-09 · **Sources**: Claude/Anthropic official documentation (preferred per user request), LangChain/LangGraph official docs & ecosystem, existing codebase (001–003).

---

## R1 — Orchestration framework: LangChain/LangGraph vs official Claude/Anthropic tooling vs hand-rolled loop

**Decision**: Hand-rolled agent loop (~small, typed loop controller in `lib/generate/agent-loop.ts`), structured after **Anthropic's official agent patterns**. No LangChain/LangGraph dependency.

**Rationale**:

1. **The official Claude guidance says exactly this.** Anthropic's canonical engineering guide *Building Effective Agents* (anthropic.com/engineering/building-effective-agents) recommends building directly on LLM APIs: *"many patterns can be implemented in a few lines of code"*, and frameworks *"often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."* Its core philosophy: *"Start with simple prompts … and add multi-step agentic systems only when simpler solutions fall short"* — and when you do, own the loop. The user asked for research grounded in Claude official docs; this is the definitive official position.
2. **Constitution fit.** Principle I permits a community dependency *only when no official option exists*. An official option exists: the documented direct-API loop patterns (and, if the LLM provider were Anthropic, the SDK Tool Runner). LangGraph.js is mature (v1.0, stable, TS-first, streaming — see alternatives below) but is a community abstraction we would immediately have to fight: our MCP adapters are already hand-wired stdio clients, our LLM layer is provider-agnostic REST, and our stream is bespoke NDJSON consumed by two existing UIs.
3. **Provider reality.** The configured provider is NVIDIA NIM (OpenAI-compatible) with Anthropic/Groq as env-swappable options. 003 follow-up work proved NIM's `guided_json` is not reliably enforced and its function-calling is not dependable for this model class — so the loop must use **structured per-phase completions + sanitization** (our existing `llmJson` + `sanitizePlan` machinery), not a framework's native tool-calling abstraction. LangChain's value (tool-calling agents, model adapters) is precisely the part we can't safely use.
4. **What we'd lose vs. gain.** LangGraph would give durable graph state, checkpointing, and its own streaming event bus — all redundant here (state = one Mongo conversation; stream = existing NDJSON; loop ≤3 iterations bounded by a 120s route). Cost: a large dependency tree in a Next.js route handler, a second event vocabulary to translate to ours, and obscured prompts (the thing 003 debugging repeatedly needed).

**Alternatives considered**:

| Option | Verdict | Why |
|---|---|---|
| **LangChain.js / LangGraph.js v1** ([overview](https://docs.langchain.com/oss/javascript/langgraph/overview), [v1.0 announcement](https://www.langchain.com/blog/langchain-langgraph-1dot0), [repo](https://github.com/langchain-ai/langgraphjs)) | Rejected | Production-ready and the strongest community option (durable execution, streaming, HITL). Rejected on constitution Principle I + Anthropic's official anti-framework guidance + provider constraints above. Revisit only if the workflow grows true graph complexity (dynamic branching across many node types, resumable long-running state). |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Rejected | Official, but it is the Claude Code harness as a library: filesystem/bash tools, subagents, sessions — a coding-agent product, Anthropic-only, wrong shape for an in-app generation loop that must stay provider-agnostic. |
| **Anthropic SDK Tool Runner** (`client.beta.messages.toolRunner`) | Deferred option | Official and closest in spirit (SDK-driven agentic loop over custom tools, per-turn hooks). Unusable while the active provider is NVIDIA; noted as the preferred drop-in if the app standardizes on Anthropic later. |
| **Anthropic Managed Agents** | Rejected | Server-managed sessions + hosted sandbox; wrong trust/latency model for a per-request web generation flow, Anthropic-only. |
| **Vercel AI SDK** | Rejected | Community; would replace `llm.ts` wholesale for marginal gain; same Principle I objection. |

## R2 — Loop shape: which official agent pattern fits FR-001–FR-004

**Decision**: Compose two patterns from Anthropic's official taxonomy:

- **Prompt chaining** for the fixed backbone: *understand → gather (MCP grounding) → draft (plan+apply) → price*. These are clean, ordered subtasks — exactly the case the guide prescribes chaining for.
- **Evaluator-optimizer** for quality: a **reviewer** LLM call evaluates the applied draft against (a) every explicitly requested capability, (b) the MCP guidance, (c) preserve-user-work constraints, returning a structured verdict `{pass, unmetCapabilities[], refinementInstructions}`; on fail, a **refine** call feeds the instructions back into the planner. The guide recommends this pattern precisely "when clear evaluation criteria exist and iteration measurably improves outputs".

**Loop budget** (FR-003/FR-004): max 3 review→refine iterations; wall-clock check between phases against the route budget (raise `maxDuration` 60→120s; abort refinement — not the turn — when <25s remain, returning the best draft with unmet capabilities listed). Early exit on first `pass` (spec US1/AC3).

**Rationale**: the reviewer sees the *applied, priced* result (not the raw plan), so it catches losses introduced by sanitization/merging too. Orchestrator-workers and routing were considered and rejected: subtasks here are predictable, so a dynamic orchestrator adds cost without coverage.

**Alternatives considered**: single mega-prompt with self-critique inline (no observable steps, can't stream verdicts, weaker on NIM); N-way voting/parallelization (token cost ×N per iteration for marginal gain at this catalog size).

## R3 — Tool use inside the loop: native tool-calling API vs structured phase calls

**Decision**: Keep **structured per-phase completions** (`llmJson` with per-phase schemas + coercing sanitizers). The loop's "tools" (MCP lookups, apply, layout, price, validate) are invoked deterministically by the loop controller, not chosen by the model.

**Rationale**: Claude's tool-use loop (documented in the official tool-use overview: emit `tool_use` → execute → return `tool_result` → repeat) is the right shape *when the model must choose tools*. Here the toolset is small and the sequence is known; deterministic invocation gives (a) provider independence (NIM function-calling unreliable; `guided_json` already proven leaky), (b) guaranteed step events for the trace (FR-005 requires every lookup observable — a model that skips a tool call would silently skip a step), (c) reuse of 003's hardened sanitizers. The model's authority stays where it adds value: plan content, review verdicts, refinement instructions.

**Alternatives considered**: OpenAI-compatible function calling on NIM (rejected — unreliable for this model family, and would fork behavior per provider); Anthropic-native tool use (deferred with the Tool Runner option in R1).

## R4 — Streaming the working trace to the chat window

**Decision**: Extend the existing NDJSON protocol (001/003) rather than adopting SSE or a framework event bus. Step events gain three fields: `kind` (`understand | lookup | draft | review | refine | layout | price | validate | persist | cost`), `iteration` (1-based), optional `detail` (short human string, e.g. the source consulted or the verdict summary). Terminal events unchanged. ChatPanel groups live steps by iteration; the creation page consumes the same protocol unchanged (unknown fields are additive).

**Rationale**: the transport already exists, survives client disconnects (guarded emit), and is consumed by two pages; additive fields are backward-compatible. SSE would add reconnect semantics we don't need for ≤120s turns. This mirrors how AI IDEs (e.g. Claude Code) stream tool/step events over a simple line protocol.

## R5 — Trace persistence & stop control

**Decision**:
- **Trace**: persisted as a **separate `GenerationRun` document** (new collection), referenced from the assistant message by `runId` and fetched **on demand** when a reader expands the trace (spec FR-006 / Clarification 2026-07-09 Q3). The message carries only a lightweight summary — `runId`, `iterations`, `converged`, `stopped`, `stepCount` — so routine thread reads stay small and single-query; the full `steps[]` load only on expand via `GET /api/projects/[id]/chat/runs/{runId}`. The run is assembled server-side by the same emitter that streams (one source of truth), written once at turn end and on every failure/stop path. Messages created before 004 have no `runId` (spec assumption).
- **Stop** (FR-009): `POST /api/projects/[id]/chat/stop` (owner-gated) sets `stopRequested` on the conversation; the loop checks the flag between phases (fast Mongo read, ~6 checks/turn) and aborts in-flight LLM fetches via `AbortController`. A stopped turn persists nothing beyond the last completed phase (architecture persists only at the existing STEP-1 point; a stop before it leaves the canvas untouched), appends an assistant "stopped" message referencing its partial run, resets status to `idle`, clears the flag. The existing stale-lock guard remains the backstop.

**Rationale**: The spec clarification (Q3) pins persistence to separate-and-on-demand, overriding the embedded option an earlier draft of this research favored. Separate storage keeps the frequently-read thread document light no matter how many multi-iteration turns accumulate, sidesteps the datastore's document-size ceiling as threads grow long, and matches the collapsed-by-default UX — the full trace is only materialized when someone actually expands it. The cost is one extra query on expand plus a `runId` join, which is negligible: the live stream already delivers every step to the active client, so a just-completed turn never refetches; the on-demand read serves only reloaded or shared views. Polling a flag for stop beats process signaling on a dev/single-node deployment and works across Next.js worker restarts.

**Alternatives considered**: embed `trace[]` in the assistant message (the earlier decision here — ≈7KB/turn, under the 16MB cap at today's scale; rejected per Clarification Q3 because it bloats every thread read as runs accumulate and pushes long threads toward the doc-size ceiling); in-memory abort registry keyed by projectId (rejected: lost on server restart, breaks multi-worker).

## R6 — Structural validation gate (FR-010)

**Decision**: A pure `validateArchitecture()` step after each apply: every edge endpoint resolves to a node; container parent references acyclic and existing; every node priced (cost ≥ 0 present); membership containerIds exist. Failures are fed to the reviewer as automatic `unmetCapabilities`, making the refine loop fix them; if still failing at budget exhaustion, the turn returns the best draft with the validation gaps named (FR-004). Existing cycle guard and sanitizers stay as the first line of defense.

## R7 — Scoping edits on existing architectures (FR-011)

**Decision**: The understand phase produces a **change scope** (which existing nodeIds/capabilities the request touches); the reviewer receives it and must not demand refinements outside it; the refine prompt carries 003's preserve-user-work rules verbatim. Diff summaries (`summarizeArchitectureEdit`) between iterations assert that untouched nodes are byte-identical — a violated assertion fails the iteration rather than persisting it (spec edge case: preserve-user-work is never sacrificed to converge).

---

**All Technical Context unknowns resolved.** Sources: [Building Effective Agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents) · Claude tool-use & agent-design official docs (via claude-api reference: tool-use loop, agent design patterns, Tool Runner/Agent SDK/Managed Agents taxonomy) · [LangGraph JS docs](https://docs.langchain.com/oss/javascript/langgraph/overview) · [LangChain/LangGraph 1.0](https://www.langchain.com/blog/langchain-langgraph-1dot0) · [langgraphjs repo](https://github.com/langchain-ai/langgraphjs).
