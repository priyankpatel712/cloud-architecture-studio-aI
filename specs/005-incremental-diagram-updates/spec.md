# Feature Specification: Incremental Diagram Build-Up During Generation

**Feature Branch**: `005-incremental-diagram-updates`

**Created**: 2026-07-09

**Status**: Implemented

**Input**: User description: "Incremental, step-by-step architecture generation with live diagram updates. Today, when the AI generates or edits an architecture (feature 004's agentic loop), the entire multi-step plan runs server-side and the user only sees step labels streaming live — the actual diagram only appears all at once at the very end. The user wants each individual change (or small batch of changes) applied to the diagram and visible on the canvas as it happens — a progressive, step-by-step build-up of the architecture — instead of a big reveal at the end. This should also naturally pace out the underlying AI requests over time (smaller chunks of work per call) rather than one large plan call, because a large multi-service plan risks bursting requests too close together and triggering the AI provider's request-rate limit. Builds on feature 004 (agentic generation with live working trace)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch the architecture build up piece by piece (Priority: P1)

A user asks the assistant to design or modify a system. Instead of watching a list of step labels tick by and then having the entire diagram appear at once at the end, the user watches services and connections appear on the canvas progressively as the assistant works through the request — e.g. API Gateway appears, then Lambda appears and connects to it, then DynamoDB appears and connects to Lambda — each becoming visible within moments of being decided, not all in one reveal at the end.

**Why this priority**: This is the core visible value requested — replacing the "black box, then one big reveal" experience with a progressive build-up the user can actually watch and follow.

**Independent Test**: Send a multi-service request and observe the canvas; verify the diagram updates at least twice during the turn with progressively more of the final architecture, not in a single update at turn completion.

**Acceptance Scenarios**:

1. **Given** an empty canvas, **When** the user requests an architecture with 5 or more services, **Then** at least 3 distinct intermediate diagram states are rendered before the turn completes, each showing more of the final architecture than the last.
2. **Given** a batch of closely related edits (e.g. a new node and the edge that connects it), **When** that batch is applied, **Then** it appears on the canvas together as one visible update — a new node is never shown disconnected when its connecting edge was planned in the same batch.
3. **Given** the turn is stopped mid-way via the existing stop control, **When** the user stops generation, **Then** whatever pieces were already applied remain visible on the canvas (already-shown progress is never rolled back).

---

### User Story 2 - Smaller, paced AI planning steps (Priority: P2)

Rather than asking the AI to plan an entire architecture change in one large request, the assistant breaks its planning into smaller chunks (a handful of services at a time) and applies each chunk before planning the next. This keeps each individual AI request smaller and spreads requests out over time, so a large, complex generation stays within the configured AI provider's request-rate limit instead of risking a mid-turn rate-limit failure.

**Why this priority**: Directly addresses observed rate-limit failures on larger requests, and is the mechanism that makes User Story 1's progressive reveal possible in the first place.

**Independent Test**: Send a request large enough that it previously risked a single burst of AI requests near the provider's per-minute cap; verify the working trace shows multiple smaller planning steps (rather than one large one) and the turn completes without a rate-limit error under normal provider conditions.

**Acceptance Scenarios**:

1. **Given** a request that would previously require one large planning call, **When** the assistant processes it, **Then** the planning work is split into multiple smaller steps, each visible in the working trace.
2. **Given** the configured AI provider enforces a request-rate limit, **When** a generation runs, **Then** the pacing between chunk-planning requests keeps the turn's request rate under that limit under normal conditions.
3. **Given** a request small enough to need only one chunk (e.g. one or two services), **When** the assistant processes it, **Then** it behaves equivalently to today — no unnecessary extra delay or chunking overhead.

---

### User Story 3 - Existing trust and transparency guarantees carry over (Priority: P3)

Everything users already rely on from the current live working trace (feature 004) — reduced-motion support, keyboard-operable expand/collapse, screen-reader announcements at meaningful boundaries, the stop control, and the persisted trace history — continues to work exactly as it does today with incremental diagram updates layered on top.

**Why this priority**: A non-regression guarantee. Lower priority than the new capability itself, but required before this ships.

**Independent Test**: Re-run feature 004's existing acceptance scenarios (trace visibility, accessibility floor, stop control) against the new incremental flow and confirm they still pass unchanged.

**Acceptance Scenarios**:

1. **Given** a screen reader user, **When** a chunk is applied to the diagram, **Then** the same boundary/failure/completion announcement policy from feature 004 applies — not a new announcement per chunk, to avoid flooding assistive technology.
2. **Given** the user clicks Stop mid-generation, **When** the turn stops, **Then** behavior matches feature 004's stop semantics: chunks already applied are kept as a partial/best-effort result.

---

### Edge Cases

- What happens when a chunk fails to plan or apply (an AI request error, or a validation gap)? The turn stops there, surfaced as a failure the same way a feature-004 turn failure is surfaced today — but chunks already successfully applied are never rolled back.
- What happens if the AI's plan for a later chunk needs to reference something created in an earlier chunk (e.g. connecting to a service added earlier in the same turn)? Later chunks must be planned with full knowledge of everything applied so far in the turn, so such references always resolve.
- What happens when the request is small enough that chunking would add no value (e.g. one or two services)? It is still handled by the same mechanism but effectively runs as a single chunk, with no perceptible extra delay.
- How does chunking interact with the existing review/refine iterations (feature 004)? Refinement edits are typically already small; they may run as a single chunk each rather than being split further.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST break an AI-planned architecture change into a sequence of smaller chunks rather than planning the entire change in one step, when the change involves more than a small number of services or containers.
- **FR-002**: System MUST apply each chunk to the live architecture (nodes, edges, containers) and make the result visible to the user before planning the next chunk.
- **FR-003**: Every chunk MUST be internally consistent when applied — any edge or container membership planned within a chunk MUST resolve to a node or container that exists once that chunk is applied; nothing in a chunk may dangle on an element planned for a later, not-yet-applied chunk.
- **FR-004**: Later chunks MUST be planned with full knowledge of everything already applied earlier in the same turn, so they can reference and extend prior chunks (e.g. connecting a new service to one added earlier).
- **FR-005**: The existing live working-trace UI (feature 004) MUST show each chunk's planning and application as its own step(s), consistent with the existing step/iteration display model.
- **FR-006**: System MUST continue to respect the existing end-to-end generation time budget and hard cap across all chunks combined in a turn, not per individual chunk.
- **FR-007**: System MUST continue to support the existing stop control; stopping mid-generation MUST preserve chunks already applied and discard only the in-flight or not-yet-planned remainder, matching feature 004's best-effort semantics.
- **FR-008**: The pacing between chunk-planning AI requests MUST be adjustable without a code change, so it can be tuned to stay under a given AI provider's request-rate limit.
- **FR-009**: A request small enough to need only one chunk MUST behave equivalently to today's single-step generation — no unnecessary chunking overhead or added delay.
- **FR-010**: If a chunk fails to plan or apply, the system MUST preserve every chunk successfully applied earlier in the turn and surface the failure the same way a whole-turn failure is surfaced today (already-visible progress is never rolled back).
- **FR-011**: System MUST NOT regress any existing feature 004 guarantee — accessibility floor, preserve-user-work, cost-estimate accuracy, or persisted trace completeness — as a result of chunking.

### Key Entities

- **Chunk (plan step)**: A bounded subset of an AI-planned architecture change — a small set of service adds/updates/removals together with their edges and container placements — that is planned and applied as one self-contained unit before the next chunk begins. Not a new persisted record; a processing-time grouping within a single generation turn's existing trace and architecture.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For architecture requests involving 5 or more services, users see the diagram update at least 3 times progressively during generation, rather than once at the end.
- **SC-002**: Generation of a complex, multi-service architecture completes without a request-rate-limit error under normal provider conditions, in a scenario that would have risked one before this change.
- **SC-003**: Total time to complete generation of a small request (1-2 services) does not measurably increase compared to today's single-step planning.
- **SC-004**: 100% of feature 004's existing acceptance scenarios (working-trace visibility, accessibility floor, stop control, cost and persistence correctness) continue to pass unchanged.

## Assumptions

- Chunk size (how many services/containers per chunk) is a tunable parameter, not fixed by this spec; a reasonable starting default is chosen during planning and adjusted against real provider rate limits.
- This applies to the initial drafting phase of a generation turn; feature 004's review/refine iterations may reuse the same chunking mechanism, but an already-small refinement edit does not need to be split further.
- This feature works within whatever request-rate limit the configured AI provider currently has — it paces requests to fit under that limit, it does not raise or change the limit itself.
- Persistence, cost-estimate, and structural-validation guarantees apply to the fully-assembled architecture once all chunks in a turn complete; an intermediate, mid-turn canvas state may be transiently incomplete (e.g. a newly-added service shown before its cost is computed).
