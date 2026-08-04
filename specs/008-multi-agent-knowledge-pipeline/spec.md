# Feature Specification: Multi-Agent Generation with Conversation Memory, Knowledge Store & Model Tiering

**Feature Branch**: `008-multi-agent-knowledge-pipeline`

**Created**: 2026-07-31

**Last Updated**: 2026-07-31 (revised via `/speckit-specify` to resolve `/speckit-analyze` findings G1, A1, A2, C1, C3, C4, G2, I4)

**Status**: Validated — pending approval

**Input**: User description: "I wanted to improve the diagram generation process. Also when diagram has already generated, the follow-up request or any modification comes, the LLM did not understand the request. For this I wanted to implement multi-agent and sub-agent workflow, where some type of information should be stored in MongoDB — the repetitive information or knowledge related to generation of the diagram — so that it could be resolved easily; so make some initial rules which can be best practice. One agent is able to search and fetch information from the web. Some agents use the open-source MCP which can help to generate the diagram. Agent and sub-agent implementation can be implemented based on Anthropic or other best practices. Also need to utilize all LLM connections in a way where the small multi-modality can help to reduce the access of powerful LLM, and use simple LLM for simple tasks or queries, so that the rate limit can be prevented from hitting the limits. Make a robust plan in the existing implementation; if needed can write some code from scratch and replace the existing functionality."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow-up requests are understood and scoped (Priority: P1)

A user has a generated architecture on the canvas and continues the conversation: *"remove the Redis cache"*, *"rename that lambda to OrderProcessor"*, *"add a queue between the API and the worker"*, *"make the database multi-AZ"*, *"actually go back to what we had before"*, or *"why did you put CloudFront there?"*. The assistant understands what "that lambda" refers to, changes only what was asked, leaves the rest of the diagram untouched, and remembers requirements and decisions from earlier turns in the same conversation. Simple, unambiguous edits apply almost immediately instead of triggering a full redesign. When a reference genuinely could mean two different things, the assistant asks one short clarifying question rather than guessing.

**Why this priority**: This is the defect the user reported. Today the assistant sees only the newest message plus a snapshot of the canvas — never the conversation — so it re-interprets every follow-up from scratch, loses earlier requirements, and frequently rewrites parts of the diagram nobody asked it to touch. Everything else in this feature is an optimization; this is a correctness fix.

**Independent Test**: Generate an architecture, then issue a series of modification requests (add, remove, rename, reconfigure, question, undo) against it. Verify each turn changes only the intended elements, that a requirement stated in the first turn is still enforced three turns later, and that a question-only message produces an answer without mutating the canvas.

**Acceptance Scenarios**:

1. **Given** a generated architecture containing exactly one Lambda function, **When** the user says "rename that lambda to OrderProcessor", **Then** only that node's display name changes — no node is added or removed, no other node is reconfigured, and no re-layout of unrelated parts occurs.
2. **Given** an architecture generated from a first-turn request that included "multi-region disaster recovery", **When** the user makes two further unrelated modification requests, **Then** the disaster-recovery requirement is still tracked and still graded in the assistant's self-review on the third turn.
3. **Given** an architecture with two Lambda functions, **When** the user says "remove the lambda", **Then** the assistant asks one clarifying question naming both candidates instead of deleting one at random.
4. **Given** a generated architecture, **When** the user asks "why is there a NAT gateway?", **Then** the assistant answers from the conversation and current design without adding, removing, or moving anything on the canvas.
5. **Given** a user has manually edited the canvas (e.g. deleted a node by hand), **When** they then send a follow-up chat message, **Then** the assistant's response accounts for that manual edit rather than acting as if it never happened.
6. **Given** the user says "undo that" or "go back to the previous version", **When** the assistant handles the turn, **Then** it presents the matching earlier version as a restore option and performs the restore only after the user confirms.
7. **Given** the user asks for a single configuration change (e.g. "make that database bigger"), **When** the change is applied, **Then** the resulting configuration is within that setting's valid range and the cost estimate is recalculated.

---

### User Story 2 - Generation stays inside provider rate limits (Priority: P2)

A user runs several complex generations in a row, or one large multi-service generation. The work completes without failing on provider rate limits. Behind the scenes, simple internal steps (classification, routing, interpretation, summarizing) are handled by small, fast models, and only the genuinely hard design work goes to the most capable model. When a provider does report a rate limit, the system waits exactly as long as the provider asks or moves to another configured provider, rather than hammering the same endpoint.

**Why this priority**: Rate-limit failures currently abort turns mid-flight and are the reason an artificial delay is hardcoded into the pipeline. Reducing large-model calls is also what makes the additional agents in User Stories 1, 3 and 4 affordable — but the fix stands alone and delivers value even if no other story ships.

**Independent Test**: Run a burst of generations that reliably triggers a rate-limit failure today. Verify all turns complete, and that a record of which model served each internal step shows simple steps ran on small models and only design/review steps used the most capable model.

**Acceptance Scenarios**:

1. **Given** a configured set of AI connections, **When** any generation turn runs, **Then** each internal step is served by a model matched to that step's difficulty, and the majority of steps in a turn do not use the most capable model.
2. **Given** a provider responds with a rate-limit signal that includes a retry delay, **When** the system handles it, **Then** it waits that stated delay (when short enough to fit the turn's time budget) or switches to another configured connection, instead of retrying immediately.
3. **Given** a provider has recently been rate-limited, **When** the next turn starts, **Then** that provider is deprioritized for new requests until its limit window has passed.
4. **Given** a burst of generations that would exceed a provider's per-minute request allowance today, **When** the burst runs, **Then** no turn fails with a rate-limit error under normal provider conditions.
5. **Given** an operator has not configured any per-step model preferences, **When** generation runs, **Then** sensible defaults apply automatically with no configuration required.
6. **Given** per-step model assignment is about to be enabled, **When** the change is made, **Then** a record of current design-quality performance already exists so any quality regression is detectable afterwards.

---

### User Story 3 - Reusable knowledge makes repeat work cheap and consistent (Priority: P3)

Architectural knowledge the system keeps re-deriving — house rules ("databases never sit in public subnets"), reference patterns, provider guidance, and lessons learned from its own past corrections — is stored once and reused on every relevant future generation. When the assistant's self-review repeatedly catches the same class of mistake, that correction becomes a stored rule so the next generation gets it right the first time, without a code change or redeploy.

**Why this priority**: Directly addresses the user's request to store repetitive generation knowledge so it "resolves easily". It improves quality and reduces iterations (which reduces model calls), but the system is functional without it.

**Independent Test**: Seed the knowledge store with best-practice rules, run a generation whose request matches several rules, and confirm the rules were supplied to the design step and were graded in the self-review. Then run a generation that fails self-review for a recurring reason and confirm a corresponding reusable lesson is recorded and applied on a later matching request.

**Acceptance Scenarios**:

1. **Given** a seeded set of best-practice rules, **When** a user requests an architecture matching some of them, **Then** those rules are supplied to the design step and appear in the assistant's working trace as consulted knowledge.
2. **Given** a stored rule that databases are not internet-exposed, **When** a draft violates it, **Then** the self-review flags the violation and the refinement corrects it before the turn completes.
3. **Given** a turn where the first draft failed self-review and a refinement fixed it, **When** the turn completes, **Then** a generalized, project-agnostic lesson is recorded for reuse — containing no project names or user-specific literals.
4. **Given** an operator edits or disables a stored rule, **When** the next generation runs, **Then** the change takes effect without a code deployment.
5. **Given** the same architectural knowledge is derived twice, **When** it is stored, **Then** it is not duplicated — repeat derivations update the existing entry rather than adding a copy.
6. **Given** a new cloud provider is introduced later, **When** its best-practice rules are contributed, **Then** they can be added alongside that provider's other definitions without modifying shared generation logic.

---

### User Story 4 - The assistant researches what it does not know (Priority: P4)

When a request touches something neither the stored knowledge nor the provider integrations can answer — a newly launched service, a current limit or quota, a recent best-practice change — a research agent looks it up from official documentation sources on the web, uses the answer in the current design, and stores it so the next similar request needs no lookup. The user sees the research happening in the live working trace.

**Why this priority**: Adds genuine freshness and closes knowledge gaps, but only pays off once the knowledge store (US3) exists to cache into, and the system degrades gracefully without it.

**Independent Test**: Ask for something absent from stored knowledge and provider integrations. Verify the trace shows a research step, the result influences the design, an entry is stored, and an immediately repeated equivalent request performs no web lookup.

**Acceptance Scenarios**:

1. **Given** a request whose knowledge need is met by neither the store nor the provider integrations, **When** the turn runs, **Then** a research step appears in the live working trace naming what was searched.
2. **Given** research returns a result, **When** the turn completes, **Then** the finding is stored with its source reference and a freshness horizon.
3. **Given** an equivalent request arrives later while the stored finding is still fresh, **When** the turn runs, **Then** it is answered from the store with no web lookup.
4. **Given** a stored finding whose freshness horizon has passed, **When** an equivalent request arrives, **Then** the finding is re-verified from its source rather than reused as-is.
5. **Given** no research capability is configured, **When** a knowledge gap occurs, **Then** generation continues normally using the sources it does have, exactly as today.
6. **Given** research is performed, **When** sources are selected, **Then** official provider documentation sources are preferred over general web content.

---

### User Story 5 - Operators can see and tune AI behavior (Priority: P5)

An administrator can see which models are actually being used, how many requests and tokens each connection consumed, and can adjust which model handles which class of work. They can also review, edit, or disable stored knowledge rules and learned lessons.

**Why this priority**: Makes the preceding stories observable and controllable, and replaces placeholder usage figures with real data. Valuable but not required for any of the generation improvements to work.

**Independent Test**: Run several generations, then open settings and verify real usage figures appear per connection, change a per-step model assignment and observe the next generation honor it, and disable a knowledge rule and observe it no longer applied.

**Acceptance Scenarios**:

1. **Given** generations have run, **When** an administrator opens the AI settings, **Then** real request and token counts per connection are shown rather than placeholder values.
2. **Given** an administrator assigns a specific model to a class of work, **When** the next generation runs, **Then** that assignment is honored.
3. **Given** an administrator disables a stored knowledge rule, **When** the next matching generation runs, **Then** that rule is not applied.
4. **Given** a non-administrator opens the same settings, **When** the page renders, **Then** it is read-only, consistent with existing role-based access rules.

---

### Edge Cases

- **Ambiguous reference with no good candidate** ("remove the cache" when there is no cache): the assistant says so plainly instead of removing something adjacent.
- **A small model returns malformed structured output**: the turn degrades to the existing behavior (full analysis path / current model) rather than failing; the system never loops on non-compliant output.
- **All configured connections are rate-limited simultaneously**: the turn fails with the existing honest failure surface and remains retryable; no partial corruption of the diagram.
- **Conversation grows very long**: conversation context supplied to the assistant stays within a bounded size, keeping the most recent and most relevant turns rather than growing without limit.
- **A stored lesson turns out to be wrong or harmful**: it can be disabled or removed by an operator, and low-value lessons age out automatically.
- **Research source is unreachable or slow**: the turn proceeds without it and records the degradation in the trace, matching existing behavior when provider integrations are unavailable.
- **A modification request also implies new requirements** ("add caching, and by the way this now needs to handle 10× traffic"): both the scoped edit and the new requirement are captured; the new requirement joins the tracked requirement set.
- **Manual canvas edits between chat turns**: the assistant treats the current canvas as truth and accounts for what changed since its last turn.
- **A trivial edit request that is actually structural** ("rename the database" when it also needs re-pricing): the fast path still re-prices, re-validates, and clamps configuration to valid bounds before completing.
- **A follow-up that is actually a major revision** ("redesign this for multi-region"): it is treated as a major revision and follows the full guided sequence, not the fast path.
- **Two connections claim the same model at different tiers**: the per-work-class assignment decides which is used; the system does not silently reinterpret the operator's choice.

## Requirements *(mandatory)*

### Functional Requirements

**Conversation understanding (US1)**

- **FR-001**: The system MUST supply the assistant with the recent conversation — including its own prior replies, what it changed on each turn, and manual canvas edits made between turns — when interpreting, analyzing, and designing a response to a follow-up request.
- **FR-002**: The system MUST maintain a cumulative set of requirements across a conversation, so requirements stated in earlier turns continue to be enforced and graded in later turns until the user withdraws or supersedes them.
- **FR-003**: The system MUST classify each follow-up request into an explicit intent (create new, add, remove, reconfigure, rename, restyle, undo, question, or ambiguous) before deciding how to act on it.
- **FR-004**: The system MUST resolve references in a follow-up request ("that lambda", "the queue", "it") to specific existing diagram elements, using the conversation and the current diagram.
- **FR-005**: When a request resolves to a single unambiguous, structurally simple change, the system MUST apply it directly without running a full design loop, while still re-validating and re-pricing the result.
- **FR-006**: When a reference is genuinely ambiguous between two or more elements, the system MUST ask exactly one clarifying question naming the candidates rather than choosing arbitrarily.
- **FR-007**: A question-only request MUST be answered without mutating the diagram.
- **FR-008**: An undo/revert request MUST be handled by presenting the matching earlier version as a restore option and performing the restore only on explicit user confirmation — never by generating a new design and never by silently discarding current work.
- **FR-009**: The system MUST constrain a modification turn to the resolved scope — elements the user referenced plus explicitly requested additions — and MUST reject and not apply changes outside that scope.

**Model tiering and rate limits (US2)**

- **FR-010**: Each distinct class of internal work MUST be assignable to its own model, independently of the model used for other classes.
- **FR-011**: Simple classification, interpretation, and summarization work MUST default to small, fast models; architecture design MUST default to the most capable configured model.
- **FR-012**: The system MUST honor a provider-supplied retry delay on a rate-limit response — waiting that delay when it fits the turn's time budget, otherwise switching to another configured connection.
- **FR-013**: The system MUST deprioritize a connection that has recently been rate-limited until its limit window has plausibly elapsed. Where a provider-supplied retry delay is available it takes precedence over any inferred estimate.
- **FR-014**: The system MUST record, per request, which connection and model served it, whether it succeeded, and how many tokens it consumed.
- **FR-015**: The system MUST operate with no per-class configuration present, applying safe defaults.
- **FR-016**: Model assignment changes MUST take effect without a code deployment.

**Knowledge store (US3)**

- **FR-017**: The system MUST persist reusable generation knowledge — best-practice rules, reference patterns, provider guidance, and learned lessons — in the system of record.
- **FR-018**: The system MUST ship with an initial set of best-practice rules covering cloud structural conventions, layout/readability conventions, provider-specific conventions, and modification-turn conventions.
- **FR-019**: The system MUST retrieve knowledge relevant to the current request and supply it to both the design step and the self-review step, so stored rules are both applied and graded.
- **FR-020**: When the self-review rejects a draft and a refinement corrects it, the system MUST be able to record a generalized lesson from that correction for future reuse.
- **FR-021**: Recorded lessons MUST NOT contain project-identifying or user-specific content.
- **FR-022**: Stored knowledge MUST be deduplicated, and unused or low-value entries MUST age out.
- **FR-023**: Previously cached provider guidance MUST be reusable for requests that match no curated reference pattern (today such requests are never cached).

**Research and integrations (US4)**

- **FR-024**: The system MUST consult sources in cost order — stored knowledge first, then provider integrations, then web research — and MUST NOT perform web research when an earlier source satisfies the need.
- **FR-025**: Web research MUST prefer official provider documentation sources.
- **FR-026**: Web research findings MUST be stored with a source reference and a freshness horizon; once that horizon passes, a finding MUST be re-verified from its source before being reused.
- **FR-027**: Web research MUST be optional — when unconfigured or unavailable, generation MUST proceed using remaining sources.
- **FR-028**: The set of external knowledge integrations MUST be extensible by configuration, without editing core generation logic.
- **FR-029**: Research activity MUST be visible in the live working trace, consistent with how existing knowledge lookups are shown.
- **FR-030**: Only derived search terms — never raw user request text — may be sent to external search services.

**Observability and control (US5)**

- **FR-031**: Administrators MUST be able to view real per-connection usage figures.
- **FR-032**: Administrators MUST be able to view, edit, disable, and delete stored knowledge entries.
- **FR-033**: Administrative controls MUST be enforced server-side under existing role rules, and read-only for non-administrators.

**Cross-cutting**

- **FR-034**: Every new agent step MUST appear in the existing live working trace with the same running/done/failed semantics as existing steps.
- **FR-035**: The feature MUST NOT regress existing guarantees from features 004, 005, and 006: the live trace, the stop control, incremental diagram build-up, the guided analyze→clarify→build→cost→finalize flow, preserve-user-work, cost realism, and the accessibility floor.
- **FR-036**: All new model outputs MUST be treated as untrusted and validated before use, and a non-compliant output MUST never cause an unbounded retry loop.
- **FR-037**: Every new step MUST respect the existing end-to-end turn time budget and hard cap.
- **FR-038**: Provider-specific generation knowledge MUST be contributable per provider, alongside that provider's other definitions, so introducing a new provider never requires modifying shared generation logic.
- **FR-039**: Any configuration value the assistant creates or changes — including on the direct fast path — MUST be clamped to that setting's declared valid range before it is priced or displayed.
- **FR-040**: A secondary external opinion on diagram topology MAY be consulted to inform self-review only; it MUST NOT override the system's own design nor be presented to the user as authoritative.
- **FR-041**: Before per-work-class model assignment is enabled, the system's current design-quality performance (self-review convergence rate and iterations-to-pass over a fixed request set) MUST be recorded as a baseline, so later quality regressions are detectable.

### Key Entities

- **Knowledge Entry**: A single reusable piece of generation knowledge. Kind (rule, pattern, guidance, lesson, service note), the provider and design mode it applies to, its retrievable text, matching keywords, where it came from (seeded, provider integration, web research, or learned), a confidence level, usage counters, and an optional freshness horizon.
- **Edit Scope**: The interpreted meaning of a follow-up request for one turn — its intent kind, the specific diagram elements it targets, any requested additions, and the residual free-text instruction. Transient turn state, not persisted as a record.
- **Conversation Context**: A bounded rendering of recent conversation history — user requests, assistant replies with what each changed, and manual canvas edits — supplied to the assistant on each turn. Derived from existing conversation records, not a new store.
- **Requirement Ledger**: The cumulative set of user requirements for a conversation, each with a status (met, pending, withdrawn), carried forward across turns and used to grade every self-review.
- **Model Role Assignment**: A mapping from a class of internal work to a preferred connection and model, with ordered fallbacks.
- **Usage Record**: One entry per model request — connection, model, work class, token counts, latency, and outcome — used for reporting and for rate-limit avoidance.
- **Quality Baseline**: A recorded snapshot of design-quality performance over a fixed request set, captured before model tiering is enabled and used as the comparison point for regression checks.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across a 20-request modification evaluation set run against pre-existing diagrams, at least 90% of turns change only the intended elements — no unrequested node is added, removed, or reconfigured.
- **SC-002**: A requirement stated in the first turn and violated by a draft three turns later is caught by the self-review in that later turn, 100% of the time.
- **SC-003**: Unambiguous rename, remove, and single-field reconfigure requests complete in under 5 seconds and consume no most-capable-model calls.
- **SC-004**: At least 50% of model requests in a typical generation turn are served by small or mid-tier models, with design quality at or better than the recorded pre-tiering baseline (SC-009) on both convergence rate and iterations-to-pass.
- **SC-005**: In a burst test that reliably produces a rate-limit failure today, zero turns fail with a rate-limit error under normal provider conditions.
- **SC-006**: An ambiguous reference produces a clarifying question rather than an arbitrary change in at least 90% of ambiguous cases in the evaluation set.
- **SC-007**: A request matching stored knowledge shows that knowledge consulted in the trace; a repeat of a previously researched topic completes with zero web lookups while the stored finding is fresh.
- **SC-008**: All existing acceptance scenarios from features 004, 005, and 006 continue to pass unchanged.
- **SC-009**: A design-quality baseline (convergence rate and iterations-to-pass over a fixed request set) is recorded before any model-tiering change is enabled, and is available for comparison thereafter.

## Assumptions

- MongoDB remains the system of record; the knowledge store is a new collection there and needs no new infrastructure.
- Keyword-based retrieval is sufficient for the initial knowledge store; semantic/vector retrieval is explicitly out of scope for this feature and may be revisited if hit-rate proves inadequate.
- The existing turn state machine (analyze → clarify → build → cost → finalize) and its live working trace remain the backbone; new agents are added as steps within it rather than replacing it.
- The direct fast path (FR-005) applies only to small, unambiguous edits — not to a new architecture or a major revision, both of which continue to follow the constitution's mandated guided sequence in full.
- "Multi-modality" in the request is interpreted as *a mix of differently-sized models*, tiered by task difficulty. Image/vision input is not part of this feature.
- Web research requires an external search service credential; when absent, the capability is simply inactive and generation degrades gracefully, mirroring how provider integrations behave today when unconfigured. No official provider-published general web-search integration exists, so a third-party search service is used, constrained to official documentation domains.
- Existing AI connections and their stored credentials are reused; no new credential-storage model is introduced beyond per-work-class model preferences.
- Automated tests are explicitly in scope for this feature, focused on reference resolution, requirement merging, model-role resolution, rate-limit handling, and knowledge retrieval.
- The evaluation set referenced by SC-001/SC-006 is authored as part of this feature; it is the natural extension of the evaluation harness deferred in feature 004.
- Self-review continues to grade against the cumulative requirement ledger (FR-002) rather than the raw conversation transcript; the transcript informs interpretation, analysis, and design only (FR-001).
