# Feature Specification: Guided Diagram Generation Flow

**Feature Branch**: `006-guided-generation-flow`

**Created**: 2026-07-09

**Status**: Implemented (code complete — 31/32 tasks done; quickstart live-scenario validation [T031] pending, see [tasks.md](./tasks.md))

**Input**: User description: "updated flow for diagram generation flow, first analize the requst then ask the validation quetions which are appicable in the archtechre also ask the option to chose the services from the options. once the clearification done the side by side real architecture start bulding. after all requrement and analysis done ask questions releted to cost and provide chip and best prective pricing optins. all gether then set aligment anf flow of the final archtecture" — i.e. re-sequence AI diagram generation as: analyze the request → ask only the applicable validation questions and offer selectable service options → once clarified, build the real architecture live and side-by-side → then run a cost dialogue offering a cheapest (budget) option and a best-practice option → finish by setting the alignment and flow of the final architecture. Codified as the "Diagram Generation Flow" section of constitution v1.4.0.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Analyze and clarify before anything is drawn (Priority: P1)

A user describes the system they need in the chat. Instead of the assistant immediately building a diagram, it first analyzes the request and plays back what it understood (capabilities, scale signals, constraints, gaps). It then asks only the validation questions that genuinely apply to this particular architecture — never a generic questionnaire — and wherever a stated need could be met by more than one service, it presents those candidate services as an explicit choice (with a recommendation) for the user to pick from. Only when the user has answered or skipped the questions does the architecture start building, live and side-by-side with the conversation.

**Why this priority**: This is the core behavioral change of the feature — decisions are made *with* the user before generation, preventing wasted builds on wrong assumptions and making the user the decision-maker instead of a spectator.

**Independent Test**: Send an ambiguous multi-requirement prompt (e.g. "an online shop with user accounts and search"). Verify the assistant produces a visible analysis, asks a small set of request-specific questions including at least one selectable service choice, makes no canvas changes until the questions are resolved, and then starts the live build reflecting the answers.

**Acceptance Scenarios**:

1. **Given** an empty project, **When** the user submits a new architecture request with ambiguities, **Then** the assistant responds with a summary of what it understood plus a bounded set of validation questions specific to that request, and the canvas remains unchanged.
2. **Given** a stated need that at least two services could satisfy (e.g. relational vs. document database), **When** the clarification round is presented, **Then** the candidate services appear as a selectable choice with a recommended default and a one-line trade-off each — the assistant never silently picks.
3. **Given** the clarification round is open, **When** the user answers all questions (or explicitly skips), **Then** the side-by-side live build starts and honors every answer and every explicitly selected service.
4. **Given** the clarification round is open, **When** the user says "just build it" (or skips everything), **Then** the assistant proceeds using documented defaults (small MVP-scale assumptions) and notes in the conversation which defaults it applied.
5. **Given** a request that is already fully specified, **When** the assistant analyzes it and finds no applicable questions, **Then** it states that briefly and proceeds straight to the build — no forced questionnaire.

---

### User Story 2 - Cost dialogue with budget and best-practice options (Priority: P2)

After the requirements are settled and the draft architecture is built, the assistant turns to cost: it asks the cost-relevant questions that apply (expected usage, growth expectations, budget sensitivity) and then presents at least two priced configurations of the architecture — a **cheapest (budget)** option and a **best-practice** option — each with an itemized monthly estimate and a plain-language trade-off summary. The user picks one (or asks for adjustments), and the chosen option is applied to the architecture's configuration and cost estimate.

**Why this priority**: Cost is the second explicit user ask and delivers standalone value on top of any generated architecture, but it depends on a built draft existing first (User Story 1).

**Independent Test**: Complete a guided generation, then verify the assistant asks cost questions before presenting exactly the two labelled options (plus any extras), each priced per the existing pricing accuracy policy, and that choosing one visibly updates the architecture's configuration and estimate.

**Acceptance Scenarios**:

1. **Given** a draft architecture has just been built, **When** the build phase completes, **Then** the assistant asks the applicable cost-related questions before presenting priced options.
2. **Given** the cost questions are answered (or skipped), **When** the assistant presents options, **Then** at least a "cheapest" and a "best-practice" configuration are shown, each with an itemized estimate and what the user gives up or gains by choosing it.
3. **Given** the two options are presented, **When** the user selects one, **Then** the architecture's service configurations and the project's cost estimate reflect that selection, and the choice is recorded in the conversation.
4. **Given** a user selected the cheapest option, **When** they later ask to move to best practice (or vice versa), **Then** the assistant re-applies the other option without requiring a full regeneration.
5. **Given** the official pricing source is unavailable, **When** options are presented, **Then** figures are clearly labelled indicative, and both options are still offered.

---

### User Story 3 - Final alignment and flow pass (Priority: P3)

Once the requirements, build, and cost choice are all settled, the assistant performs a finishing pass over the diagram: services are aligned into a coherent layout with a consistent flow direction (e.g. traffic entering on one side and flowing through tiers), related services are sensibly grouped, and no nodes or edges overlap. The delivered diagram reads like a finished architecture document, not a raw graph.

**Why this priority**: The closing polish step the user explicitly asked for; valuable but only meaningful after a built architecture exists.

**Independent Test**: Run a guided generation producing 8+ services; verify the final diagram has a consistent primary flow direction, logical grouping, and zero overlapping nodes/edges without manual rearranging.

**Acceptance Scenarios**:

1. **Given** the cost option has been applied, **When** the turn finishes, **Then** the final diagram shows a consistent primary flow direction from entry point(s) to data/storage tiers.
2. **Given** a generated diagram of any size, **When** the finishing pass completes, **Then** no nodes overlap and no edge passes through an unrelated node's body.
3. **Given** the user had manually positioned existing elements (revision case), **When** the finishing pass runs, **Then** untouched user work keeps its exact positions; a full re-layout of user-arranged work happens only when the user explicitly requests one (via chat or the canvas Auto-arrange tool) — never as a side effect of the finishing pass.

---

### User Story 4 - Small edits stay fast (Priority: P4)

A user with an existing architecture asks for a small in-place change ("rename this", "add a cache in front of the database"). The full guided sequence does not activate: no questionnaire, no cost interview — the edit applies immediately as it does today, with the assistant asking at most a single follow-up only if the edit itself is ambiguous.

**Why this priority**: A proportionality/non-regression guarantee — the guided flow must not make everyday small edits slower or more annoying.

**Independent Test**: On an existing architecture, request a one-service addition; verify the change applies without any mandatory clarification or cost round and completes as fast as the current behavior.

**Acceptance Scenarios**:

1. **Given** an existing architecture, **When** the user requests a small unambiguous edit, **Then** the edit applies directly with no clarification or cost round.
2. **Given** an existing architecture, **When** the user requests a major revision (e.g. "redesign this for multi-region"), **Then** the full guided sequence applies as for a new architecture.
3. **Given** any guided or non-guided turn, **When** it runs, **Then** all existing guarantees hold unchanged: live working trace, progressive canvas build-up, stop control, one generation at a time per project, and the accessibility floor.

---

### Edge Cases

- User abandons the clarification round mid-way (closes the tab, stops replying): nothing is built; the open questions remain in the thread and the user can answer, skip, or restate the request later. No project state is corrupted.
- User gives contradictory answers (e.g. picks the lowest-cost service option but demands capabilities only a premium tier provides): the assistant flags the conflict and asks one targeted follow-up rather than silently choosing.
- Every stated need has exactly one sensible service: the service-choice step collapses to a brief confirmation rather than a forced menu.
- User answers a question by changing the original request materially: the assistant re-analyzes and refreshes the remaining questions instead of proceeding on stale analysis.
- User skips the cost questions entirely: the two options are still presented, priced using documented MVP-scale defaults.
- Stop is pressed during the build, cost, or finishing phase: existing stop semantics apply — completed work is kept, nothing partial beyond a completed step is persisted, and the thread stays usable.
- The finishing pass cannot fully resolve overlaps for a very dense diagram: it delivers its best layout and states the limitation honestly rather than failing the turn.
- A returning user opens an old thread whose clarification round was never resolved: the assistant offers to resume or restart the round against the current request.

## Requirements *(mandatory)*

### Functional Requirements

**Phase 1 — Analyze**

- **FR-001**: For every new-architecture request or major revision, the assistant MUST produce and show a request analysis — stated capabilities, scale signals, constraints, and detected gaps/ambiguities — before asking any question and before any canvas change.

**Phase 2 — Clarify**

- **FR-002**: The assistant MUST ask only validation questions that apply to the analyzed request, derived from its detected gaps — never a fixed generic questionnaire — and MUST keep each round to a small bounded set (default at most 5 questions).
- **FR-003**: Wherever a stated need can be satisfied by more than one service, the assistant MUST present the candidate services as an explicit selectable choice with a recommended default and a one-line trade-off per candidate, and MUST NOT silently pick on the user's behalf.
- **FR-004**: Users MUST be able to skip any individual question or the entire clarification round, in which case the assistant proceeds with documented defaults (small MVP-scale assumptions per the constitution's cost-realism constraint) and states which defaults it applied.
- **FR-005**: The assistant MUST NOT add or change architecture content on the canvas until the clarification round resolves (every question answered or skipped). If analysis finds no applicable questions, the assistant says so and proceeds directly.
- **FR-006**: All questions, answers, selections, and applied defaults MUST be recorded in the conversation thread and consolidated into a requirement brief that drives the build.

**Phase 3 — Build**

- **FR-007**: Once clarification resolves, the architecture build MUST start and render live, side-by-side with the conversation, preserving the existing live working-trace and progressive build-up behaviors unchanged.
- **FR-008**: The built architecture MUST include a service fulfilling every user-confirmed capability and MUST use every service the user explicitly selected.

**Phase 4 — Cost dialogue**

- **FR-009**: After the draft architecture is built, the assistant MUST ask the cost-related questions applicable to that architecture (expected usage, growth, budget sensitivity) before presenting priced options; these questions are also skippable.
- **FR-010**: The assistant MUST present at least two priced configurations of the architecture — a cheapest (budget) option and a best-practice option — each with an itemized monthly estimate and a plain-language summary of the trade-offs, honoring the existing pricing accuracy and indicative-labelling policies and the cost-realism constraint.
- **FR-011**: The user's selected pricing option MUST be applied to the architecture's service configurations and the project's cost estimate; the user MUST be able to switch to the other option later via chat without a full regeneration, and both options MUST preserve every user-confirmed capability.

**Phase 5 — Finalize**

- **FR-012**: After the cost selection (or its skip), the assistant MUST perform a final alignment-and-flow pass on the diagram: a consistent primary flow direction, sensible grouping of related services, and no overlapping nodes or edges — while preserving the positions of pre-existing user-arranged elements. A full re-layout of user-arranged work happens only on an explicit user request (chat or the Auto-arrange tool), never as a side effect of this pass.

**Proportionality & non-regression**

- **FR-013**: Small in-place edits to an existing architecture MUST bypass the guided sequence and apply directly as today; the assistant MAY ask at most one follow-up question when the edit itself is ambiguous. Major revisions follow the full guided sequence.
- **FR-014**: All existing generation guarantees MUST carry over unchanged: live working trace, incremental canvas updates, the stop control and its semantics, one generation at a time per project, trace persistence, and the accessibility floor.
- **FR-015**: Time spent waiting for the user to answer clarification or cost questions MUST NOT count against the generation time budget; each active processing phase individually stays within the existing agentic turn envelope.

### Key Entities

- **Requirement Brief**: the consolidated output of analysis plus clarification — confirmed capabilities, scale assumptions (stated or defaulted), constraints, and explicit service selections; the single source the build phase works from.
- **Validation Question**: a request-specific question raised by the analysis — its rationale (which gap it closes), its answer options where applicable, and its resolution state (answered, skipped/defaulted).
- **Service Choice**: a need mapped to two or more candidate services, each with a short trade-off, a recommended default, and the user's selection.
- **Pricing Option**: a named priced configuration of the built architecture ("cheapest" or "best practice", others allowed), with an itemized monthly estimate, trade-off summary, indicative flag, and whether the user selected it.
- **Guided Turn**: one pass through the sequence with its phase states (analyze → clarify → build → cost → finalize), linking the conversation messages, the requirement brief, the pricing options, and the resulting architecture version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new-architecture and major-revision turns show a visible request analysis, and any applicable clarification questions, before the first canvas change.
- **SC-002**: In every request where a need has more than one viable service, the user is offered an explicit selectable choice — zero silent service picks across the validation prompt set.
- **SC-003**: A typical clarification round (validation prompt set) contains at most 5 questions and can be completed by the user in under 2 minutes.
- **SC-004**: 100% of completed guided turns present at least two priced options (cheapest and best-practice) before finalization, with estimates meeting the existing pricing accuracy policy (±5% where official pricing is connected; clearly labelled indicative otherwise).
- **SC-005**: Built architectures contain a service for 100% of user-confirmed capabilities and use 100% of explicitly selected services.
- **SC-006**: At least 95% of guided generations deliver a final diagram with zero overlapping nodes/edges and a consistent primary flow direction, without manual rearranging.
- **SC-007**: Small-edit requests complete with zero mandatory questionnaire steps and no added latency versus current behavior.
- **SC-008**: Each active processing phase (analysis, build, costing, finishing) completes within the existing agentic turn envelope — 90 seconds at the 90th percentile, 120-second hard cap — with user response wait time excluded.

## Assumptions

- The guided sequence applies to new architectures and major revisions; small in-place edits keep today's immediate behavior (per constitution v1.4.0 "Diagram Generation Flow" scoping). What counts as "major" is judged by the assistant from the request's blast radius (e.g. redesigns, multi-service additions, changed non-functional requirements) — a heuristic to be refined in planning.
- "chip" in the user description is read as **cheap/cheapest (budget)** and "best prective" as **best practice**.
- Clarification and cost questions are always skippable; skipped items fall back to the constitution's MVP-scale cost-realism defaults, and applied defaults are disclosed in the conversation.
- One clarification round is the norm; a follow-up question is allowed when answers conflict or materially change the request.
- Pricing options adjust service configurations and tiers (and may substitute equivalent services) but never drop a user-confirmed capability.
- Cost figures may be indicative when the official pricing source is unavailable, using the existing clearly-labelled indicative mode.
- User think-time between phases is unbounded and excluded from generation time budgets; threads with unresolved rounds remain resumable.
- This feature layers conversational sequencing on top of features 004 (agentic generation with live working trace) and 005 (incremental diagram build-up); none of their guarantees or budgets change.
