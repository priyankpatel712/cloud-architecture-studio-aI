# Feature Specification: Agentic Architecture Generation with Live Working Trace

**Feature Branch**: `004-agentic-generation`

**Created**: 2026-07-09

**Status**: Implemented — all 31 tasks in [tasks.md](./tasks.md) complete; see [quickstart.md](./quickstart.md) for validation scenarios.

**Input**: User description: "Re-architect the AI architecture-generation process as an agentic, multi-step LLM workflow (proper framework such as LangChain/LangGraph or the official Claude/Anthropic agent tooling — research decides) instead of today's single-shot prompt calls. Use agents and loop engineering (plan → act → observe → refine iterations with tool use) so the assistant produces more appropriate, higher-quality architectures. Stream and show ALL agent interactions (tool calls, MCP lookups, reasoning steps, iterations) live in the chat window while processing, the way AI IDEs like Claude Code show their working steps. Research should preferentially use Claude official documentation. This amends/extends the existing generation flow from features 001/003."

## Clarifications

### Session 2026-07-09

- Q: What end-to-end time budget governs the new agentic turn, and what is the hard-cap ceiling (given the constitution's 30s target vs SC-004's 90s)? → A: 90s p90 target with a 120s hard cap; the constitution's 30s target applies to the legacy single-shot flow and is flagged for a constitution amendment.
- Q: How must the live working-trace UI satisfy the constitution's non-negotiable a11y floor (reduced-motion, keyboard focus, screen-reader)? → A: Full floor — reduced-motion disables step animations (instant state changes); expand/collapse is keyboard-operable with visible focus; a polite ARIA live region announces phase/iteration boundaries, failures, and completion (not every micro-step, to avoid flooding).
- Q: How is the full run trace persisted relative to the datastore's document-size ceiling — embedded in the message or stored separately? → A: Kept separate from the message and referenced by it, fetched on demand when expanded, and retained in full (no step truncation under the loop budget).
- Q: Does the first generation (streamed from the project-creation page) also show the live working trace, given SC-002's "100% of turns"? → A: Yes — the creation page reuses the same live-trace UI, so every generation turn on every streaming surface shows its trace; no turn is exempt.
- Q: How is each self-review verdict persisted so FR-002's "recorded with reasons" is testable? → A: As the review Trace Step's human-readable detail (pass/fail, unmet capabilities, what changed); the structured verdict is transient loop state and is not persisted as a separate field.
- Q: Is the formal 20-prompt evaluation harness for SC-001's ≥95% target in scope now, or deferred? → A: Deferred to post-launch QA; SC-001 is verified now via the quickstart multi-capability scenario plus a manual spot-check set. Per-turn capability coverage is already enforced by the reviewer/validation loop.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Iterative self-refining generation (Priority: P1)

A user describes the system they need in the chat. Instead of a single-pass answer, the assistant works the request like an engineer: it breaks the request into needs, consults the official provider knowledge sources, drafts an architecture, reviews its own draft against the request and the gathered guidance, and refines it — repeating until the design covers every stated need or a safety limit is reached. The user receives a noticeably more complete and appropriate architecture than today's one-shot result.

**Why this priority**: This is the core value of the amendment — generation quality. Everything else (visibility, controls) decorates this loop.

**Independent Test**: Send a multi-requirement prompt (e.g. "fintech API with WAF protection, user auth, encryption, multi-region DR"). Verify the returned architecture includes every explicitly requested capability, correctly connected, and that the turn demonstrably ran more than one design pass (trace shows review/refine activity).

**Acceptance Scenarios**:

1. **Given** an empty project, **When** the user requests an architecture with 5+ explicit capabilities, **Then** the final diagram contains a service fulfilling each capability with sensible connections, and the working trace shows at least one review pass over the draft.
2. **Given** a draft the self-review finds incomplete (a requested capability missing), **When** the loop continues, **Then** the next iteration adds the missing capability, and the trace records what was found lacking and what changed.
3. **Given** a request the assistant fulfills completely on its first draft, **When** the self-review passes, **Then** the loop ends early without unnecessary iterations.
4. **Given** an existing architecture on the canvas, **When** the user requests a change, **Then** the iterative workflow edits in place, preserving untouched user work exactly as the current flow does.

---

### User Story 2 - Live working trace in the chat (Priority: P2)

While the assistant works, the chat window shows everything it is doing, live, the way AI coding IDEs show their steps: each knowledge lookup (with the provider consulted), each design draft, each self-review verdict, each refinement iteration — appearing as they happen with running/done/failed states. After the turn completes, the trace remains attached to the assistant's reply, collapsed, so anyone reading the thread later can expand it and see how the design was derived.

**Why this priority**: Transparency is the explicitly requested UX and builds trust in the result, but it depends on the loop (US1) existing first.

**Independent Test**: Run a generation and watch the chat: every phase of the loop appears live with status transitions; after completion, the persisted message exposes the same trace on demand.

**Acceptance Scenarios**:

1. **Given** a generation in progress, **When** the assistant consults an official knowledge source, **Then** the chat shows that lookup as a live step naming the source, marked running then done (or failed).
2. **Given** a generation that iterates, **When** iteration 2 begins, **Then** the chat visibly distinguishes iteration 2's steps from iteration 1's.
3. **Given** a completed turn, **When** the user (or a shared viewer) reopens the project later, **Then** the assistant message offers the full working trace of that turn, collapsed by default.
4. **Given** a step that fails mid-turn, **When** the loop continues on a fallback path, **Then** the failed step stays visible as failed and the trace shows how the assistant proceeded.

---

### User Story 3 - Bounded, controllable loops (Priority: P3)

Generation loops are governed: they terminate within a predictable time and iteration budget, degrade gracefully when they cannot converge (returning the best draft so far, clearly labelled), and the user can stop a running generation from the chat without corrupting the project.

**Why this priority**: Safety rails for the new loop; matters once US1 exists, but the defaults protect users even if they never touch a control.

**Independent Test**: Craft a request that cannot fully converge (contradictory constraints). Verify the loop stops at its budget, returns the best-effort result labelled as such, and the project remains editable. Trigger a stop mid-run and verify the project is not left locked or half-written.

**Acceptance Scenarios**:

1. **Given** a loop that has not converged, **When** it reaches its iteration budget, **Then** it stops, returns the best draft with an honest note about what remains unmet, and the thread stays usable.
2. **Given** a running generation, **When** the user chooses to stop it, **Then** the run halts promptly, nothing partial is persisted beyond a completed phase, and a retry is possible immediately.
3. **Given** any generation turn, **When** it runs, **Then** it completes (or terminates) within the documented time budget.

---

### Edge Cases

- Loop oscillation (review keeps flip-flopping between two drafts): iteration budget cuts it off; the trace shows both candidates were considered.
- All knowledge lookups fail mid-loop: the loop continues in the clearly-labelled indicative mode (existing behavior), and the trace records the degradation point.
- The user closes the tab mid-run: the turn still completes server-side and the full trace is persisted with the message (existing disconnect guarantee extends to the trace).
- Very long traces (many iterations × many steps): the chat remains responsive; the trace presentation stays readable (grouped by iteration).
- Concurrent turn attempt while a loop is running: rejected exactly as today (one generation at a time per project).
- A self-review that requests a change violating preserve-user-work: the workflow must refuse that refinement; user-owned elements are never sacrificed to converge.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The generation turn MUST run as a multi-phase workflow — at minimum: understand the request, gather grounding from the official provider sources, draft the architecture, self-review the draft against the request and the grounding, and refine when the review finds gaps.
- **FR-002**: The self-review MUST evaluate the draft against (a) every explicitly requested capability, (b) the gathered official guidance, and (c) the project's existing user work; each verdict MUST be recorded in the trace with its reasons — captured as the review step's human-readable detail (pass/fail, the unmet capabilities, and what changed). The structured verdict is transient loop state and need not be persisted as a separate field.
- **FR-003**: The workflow MUST iterate (review → refine) until the review passes or a configured iteration budget is reached; the budget MUST have a sane default and a hard time cap.
- **FR-004**: When the budget is reached without convergence, the system MUST return the best draft so far, explicitly telling the user which requested capabilities remain unmet.
- **FR-005**: Every workflow phase, knowledge lookup, review verdict, and refinement MUST be emitted as a live, human-readable step event (running/done/failed) while the turn executes, and rendered live in the chat window, grouped by iteration. This live rendering MUST apply to every generation turn on every surface that streams one — including the first generation initiated from the project-creation page (which reuses the same live-trace UI) — so no turn lacks a live trace.
- **FR-006**: The complete step trace of a turn MUST be persisted and retained in full under the loop budget, stored separately from the message so that it does not weigh down routine message/thread reads (fetched on demand when the trace is expanded), and be viewable later by anyone who can view the thread, collapsed by default in the UI.
- **FR-007**: The workflow MUST preserve all existing generation guarantees unchanged: preserve-user-work editing, attach-duplicate merging, container authority rules, the decoupled cost phase and its overrides, and the step-aware failure/retryability contract from feature 003.
- **FR-008**: Knowledge-source failures during the loop MUST degrade exactly as today (distinct per-provider failure reporting; clearly-labelled indicative mode) with the degradation visible in the trace.
- **FR-009**: The user MUST be able to stop a running generation from the chat; a stop MUST leave the project unlocked, persist nothing beyond the last completed phase, and permit an immediate retry.
- **FR-010**: The final architecture returned by a converged loop MUST pass structural validation (every connection references existing services, container membership is valid, every service is priced) before being persisted.
- **FR-011**: A turn on an existing architecture MUST scope its iterations to the requested change — the loop refines the delta, never regenerating untouched parts of the canvas.
- **FR-012**: The working-trace UI (both live and persisted/collapsed) MUST meet the constitution's accessibility floor: it MUST honor the user's reduced-motion preference by disabling step animations and showing state changes instantly; its expand/collapse controls MUST be keyboard-operable with visible focus; and it MUST announce — politely, to assistive technology — phase/iteration boundaries, step failures, and turn completion, deliberately NOT every individual step, to avoid flooding assistive technology.

### Key Entities

- **Generation Run**: one chat turn's workflow execution — its phases, iteration count, convergence outcome, start/end times, and terminal status; belongs to the conversation thread. Persisted with its ordered Trace Steps and referenced by (not embedded in) the assistant message, fetched on demand.
- **Trace Step**: one observable unit of work inside a run — human-readable label, kind (understanding, lookup, draft, review, refinement, pricing…), iteration number, status (running/done/failed), and an optional short detail (e.g. which source was consulted, what the review found); ordered within its run.
- **Review Verdict**: the self-review's structured outcome for one iteration — pass/fail, the unmet capabilities found, and the refinement instructions it produced. Used transiently within the loop to drive refinement; for persistence it is captured as the review Trace Step's detail (not a separate structured store).
- **Assistant Message (extended)**: the existing thread message, now referencing its Generation Run's persisted trace (kept separate and fetched on demand when expanded) alongside the current mcpCalls/editsApplied/error fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For prompts naming 5+ explicit capabilities, the delivered architecture includes every named capability in at least 95% of turns (today's single-shot flow is the baseline). Verified now via the quickstart's multi-capability scenario plus a manual spot-check set; a formal 20-prompt evaluation harness is deferred to post-launch QA. Per-turn capability coverage is enforced by the reviewer/structural-validation loop.
- **SC-002**: 100% of generation turns — including the first generation started from the project-creation page — display live working steps, with each step's status change visible within 1 second of it occurring.
- **SC-003**: The full working trace of any past generation turn is retrievable from the thread by project viewers, for 100% of turns run after this feature ships.
- **SC-004**: 90% of generation turns complete within 90 seconds end-to-end; no turn ever exceeds the enforced hard cap of 120 seconds. This 90s p90 target / 120s hard cap governs the agentic turn; the constitution's 30-second target applies to the legacy single-shot flow (constitution amended to v1.2.0 to add this agentic envelope).
- **SC-005**: All existing generation, cost-override, and canvas behaviors continue to pass their acceptance criteria unchanged (zero regressions in the 001/002/003 test suites).
- **SC-006**: A user can stop a running generation and successfully start a new turn within 5 seconds of stopping.
- **SC-007**: The working-trace UI passes the accessibility floor for 100% of renders: with reduced-motion enabled zero step animations play (states change instantly), all trace controls are reachable and operable by keyboard with visible focus, and assistive-technology announcements are limited to phase/iteration boundaries, failures, and completion.

## Assumptions

- The visible trace shows concise human-readable step labels with optional short details — not raw model output; full internal reasoning text is out of scope for the UI.
- Default loop budget: up to 3 review→refine iterations per turn within the turn time budget (90s p90 target, 120s hard cap — see SC-004); both remain tunable without a product change.
- "Agents" refers to the workflow's specialized roles (e.g. researcher, architect, reviewer) executing within one generation turn — long-lived autonomous background agents are out of scope.
- The choice of orchestration framework (LangChain/LangGraph, official Claude/Anthropic agent tooling, or a hand-rolled loop) is a planning/research decision, not a product requirement; research will preferentially consult official Claude/Anthropic documentation, per the constitution's official-first principle.
- The existing chat streaming transport and the one-generation-at-a-time rule are reused, not redesigned.
- The current LLM provider configuration (provider-agnostic, environment-driven) continues to apply; the workflow must not hard-require a single vendor.
- Existing threads keep working: messages created before this feature simply have no trace attached.
