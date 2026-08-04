# Contract: Internal Agent Interfaces

**Feature**: `008-multi-agent-knowledge-pipeline` | **Consumers**: the generation pipeline (`app/src/lib/generate/`, `knowledge/`, `research/`)

These are internal module contracts, not HTTP endpoints. Every one shares a non-negotiable rule: **model output is untrusted** (FR-036). Each contract therefore specifies what the model proposes and what code verifies.

---

## 1. Intent & Reference Resolver

**Module**: `app/src/lib/generate/intent.ts` | **Role**: `intent` (small tier) | **Serves**: FR-003, FR-004, FR-006

```ts
resolveIntent(input: {
  text: string
  context: string          // rendered ConversationContext
  nodes: NodeRef[]         // { nodeId, serviceId, displayName }
  edges: EdgeRef[]
  containers: ContainerRef[]
}, signal?: AbortSignal): Promise<EditScope>
```

**Guarantees**
- Always resolves — never throws to the caller. Any model, transport, or parse failure returns `{ kind: 'new', targets: [], additions: [], freeform: input.text }`, which routes to the existing full analyze path (today's behavior).
- Every returned `nodeId` exists in `input.nodes`. Unverifiable ids are dropped before return.
- `sanitizeEditScope` is applied unconditionally; see [data-model.md](../data-model.md) for coercion rules.
- Bounded at ~400 max tokens and one attempt per turn. **Never retries on non-compliant output** — it degrades instead (FR-036).

**Caller obligations**
- Call only when the canvas is non-empty and no interaction round is open.
- Treat `ambiguous` as "ask exactly one clarifying question", not as a licence to guess (FR-006).
- Treat `question` as read-only: the turn must not mutate the architecture (FR-007).
- Treat `undo` as **offer + confirm**, never an automatic restore (FR-008).

---

## 2. Direct-Edit Executor

**Module**: `app/src/lib/generate/direct-edit.ts` | **No model call** | **Serves**: FR-005, FR-039

```ts
applyDirectEdit(scope: EditScope, arch: Architecture): Promise<{
  arch: Architecture
  editsApplied: string[]
  applied: boolean         // false ⇒ caller must fall back to the full path
}>
```

**Guarantees**
- Handles exactly three kinds: `rename`, `remove`, and single-field `reconfigure`. Any other kind returns `applied: false` without mutating input.
- Removing a node also removes every edge referencing it — no dangling edges.
- Removing the last child of a container removes the container (no empty containers).
- **Every changed config value is clamped to its declared field bounds before pricing** (FR-039, constitution cost-realism constraint).
- Re-prices affected nodes and re-runs structural validation before returning.
- Purely functional with respect to its input: on any failure it returns `applied: false` and the unmodified architecture.

**Caller obligations**
- On `applied: false`, fall through to the normal analyze/build path — never surface a partial edit.
- Persist through the existing architecture write path so versioning and cost estimates stay consistent.

---

## 3. Knowledge Store

**Module**: `app/src/lib/knowledge/store.ts` | **No model call on the read path** | **Serves**: FR-017, FR-019, FR-022

```ts
retrieveKnowledge(q: {
  keywords: string[]
  provider: ProviderId | 'any'
  designMode: DesignMode | 'any'
  topK?: number            // default 6
}): Promise<KnowledgeEntry[]>

upsertKnowledge(entry: KnowledgeEntryInput): Promise<{ created: boolean }>
recordKnowledgeUsage(ids: string[]): Promise<void>   // fire-and-forget
```

**Guarantees**
- `retrieveKnowledge` never throws — a database failure returns `[]` and generation proceeds ungrounded (matching existing best-effort cache behavior).
- Only `enabled` entries with `confidence ≥ 0.5` are returned; entries past `staleAfter` are excluded from reuse and flagged for re-verification (FR-026).
- Combined `content` of the returned set is char-capped to protect the prompt budget.
- `upsertKnowledge` dedupes on content `hash`: an equivalent entry updates in place and returns `created: false` (FR-022).

**Caller obligations**
- Inject retrieved entries into **both** the planner and the reviewer prompts (FR-019) — rules that are applied but not graded silently decay.
- Call `recordKnowledgeUsage` only for entries injected into a turn that ultimately passed review.

---

## 4. Knowledge Agent (source waterfall)

**Module**: `app/src/lib/research/knowledge-agent.ts` | **Serves**: FR-024, FR-025, FR-027

```ts
gatherKnowledge(input: {
  keywords: string[]
  provider: ProviderId
  designMode: DesignMode
  progress?: TraceEmitter
}): Promise<{ entries: KnowledgeEntry[], degraded: boolean, researched: boolean }>
```

**Ordering is contractual** (FR-024): stored knowledge → provider MCP → web research. Each rung is attempted only if the previous produced nothing usable.

**Guarantees**
- At most **one** web research operation per turn, regardless of gap count.
- Web research is skipped entirely when no search backend is configured; `degraded: true` is reported and generation continues (FR-027).
- Every rung attempted emits a trace step, including failures (FR-029, FR-034).
- Findings from the web rung are written back to the store before return, so the next equivalent request needs no lookup (SC-007).

---

## 5. Web Search Backend

**Module**: `app/src/lib/research/web-search.ts` | **Serves**: FR-025, FR-027, FR-030

```ts
interface SearchBackend {
  readonly id: 'tavily' | 'brave' | 'disabled'
  search(query: string, opts: { allowDomains: string[] }): Promise<SearchHit[]>
  fetchPage(url: string): Promise<string>
}
```

**Guarantees**
- Backend selection order is Tavily → Brave → disabled, chosen by which credential is present.
- The `disabled` backend is a no-op returning `[]` — callers need no conditional branch.
- Results outside `allowDomains` are filtered out **client-side after the call**, so a backend ignoring a domain hint cannot leak non-official sources into grounding (FR-025).
- **Only derived capability keywords are transmitted — never raw user request text** (FR-030). Enforced at this boundary; callers cannot opt out.
- `fetchPage` returns text capped consistently with the existing MCP raw-text cap.

---

## 6. Distiller

**Module**: `app/src/lib/knowledge/distill.ts` | **Role**: `distill` (small tier) | **Serves**: FR-020, FR-021

```ts
distillLesson(input: {
  reviewGap: string        // what the reviewer flagged
  refinementFix: string    // what the refinement changed
  provider: ProviderId
  designMode: DesignMode
}): Promise<KnowledgeEntryInput | null>
```

**Guarantees**
- Invoked **only** post-turn, after the result is persisted, and only when iteration 1 failed review and a refinement corrected it — never on the user-visible latency path.
- Returns `null` rather than a low-quality entry when the pair yields no generalizable lesson.
- Output containing project names, verbatim user-text literals, or identifiers is **rejected before storage** (FR-021) — verified by test, not merely requested in the prompt.
- Produced entries always carry `source: 'learned'` and `confidence: 0.6`.

**Caller obligations**
- Never block turn completion or the response stream on this call.
- A distiller failure is logged and swallowed; it must not surface as a turn error.

---

## 7. Model Role Resolution

**Module**: `app/src/lib/llm-roles.ts` | **Serves**: FR-010, FR-011, FR-013, FR-015, FR-016

```ts
type LlmRole = 'route' | 'intent' | 'interpret' | 'distill' | 'research'
             | 'analyze' | 'review' | 'cost' | 'report' | 'plan'

resolveRoleConfigs(role?: LlmRole): Promise<LlmConfig[]>
recentRequests(provider: string, windowMs: number): Promise<number>
```

**Guarantees**
- **Omitting `role` returns exactly today's chain** — this is the compatibility contract that makes call-site migration incremental and individually revertible.
- Resolution precedence: `LlmSettings.roleModels[role]` → role default chain → active config → env.
- A provider at or above its per-minute ceiling (via `recentRequests`) is deprioritized *before* a request is sent, not after a 429 (FR-013).
- Providers lacking a usable credential are omitted from the chain entirely.
- Chain length remains capped at 3, preserving the existing turn-budget guarantee.
