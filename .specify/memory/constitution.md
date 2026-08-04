<!--
SYNC IMPACT REPORT
Version change: 1.4.0 → 1.5.0 (MINOR — two constraints added, none removed or redefined)
Modified principles: none renamed, added, or removed
Added to "Technology & Security Constraints":
  - "Knowledge provenance & privacy" — feature 008 introduced a durable store that shapes
    every generation and that the system writes to ITSELF. Two invariants were protected
    only by module comments: raw user text must never leave the system, and nothing
    project-specific may be promoted into shared knowledge. Both are security-shaped and
    had no home: Principle III covers credentials reaching the browser but says nothing
    about user content flowing outward or into shared state.
  - "Advisory sources are never authoritative" — generalizes the existing indicative-pricing
    rule. Both exist so a user can always tell how much to trust what they are shown.
Deliberately NOT constitutionalised (reviewed under tasks T115):
  - Model tiering — tunable operational policy, like the performance envelopes already
    described as tunable; freezing a tier table would lock in a decision that must follow
    provider pricing and rate limits. Principle I already governs which providers are legitimate.
  - The agent roster — an implementation shape, not a governance rule; naming the roles
    would make every future refactor an amendment.
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check gates are
    derived dynamically from this file)
  - .specify/templates/spec-template.md ✅ no change needed
  - .specify/templates/tasks-template.md ✅ no change needed
Cross-references reviewed:
  - specs/008-multi-agent-knowledge-pipeline — FR-021/FR-030 (privacy boundary), FR-032
    (operator disable without deploy), FR-040 (advisory cross-check) are the source of both
    additions and now have constitutional backing rather than comment-only protection.
Follow-up TODOs: none

PRIOR REPORT (1.3.0 → 1.4.0)
Version change: 1.3.0 → 1.4.0 (MINOR — new section added)
Modified principles: none renamed, added, or removed
Added sections:
  - "Diagram Generation Flow" (new top-level section between Technology & Security
    Constraints and Development Workflow) codifying the mandated conversational sequence
    for AI diagram generation: (1) analyze the request first, (2) ask only the validation
    questions applicable to the requested architecture and offer selectable service
    options, (3) begin the side-by-side live build only after clarification resolves,
    (4) run a cost dialogue offering at minimum a cheapest option and a best-practice
    option, (5) finish with a final alignment-and-flow layout pass.
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check gates are
    derived dynamically from this file; no hard-coded flow references)
  - .specify/templates/spec-template.md ✅ no change needed
  - .specify/templates/tasks-template.md ✅ no change needed
Cross-references reviewed:
  - specs/004-agentic-generation (live-trace, loop budgets) — the new section layers a
    conversational ordering on top of that loop; time/iteration envelopes are unchanged.
  - "Cost realism for AI-generated architectures" constraint — the new cost-dialogue step
    references and must honor it.
Follow-up TODOs: none
-->

# Cloud Architecture Studio AI — Constitution

The non-negotiable principles that govern how this product is specified, designed,
and built. Every spec, plan, and implementation is checked against this document.

## Core Principles

### I. Official Integrations First
Prefer official MCP servers, SDKs, and APIs over community or hand-rolled
alternatives whenever one exists. AWS guidance flows through the official AWS Labs
MCP servers — architecture via the AWS MCP, pricing via the official AWS cost MCP
(backed by the AWS Price List API, which remains an approved direct fallback);
MongoDB guidance through the official MongoDB MCP and Atlas Administration API. A community dependency is allowed only when no official option
exists, and the choice must be justified in the feature's plan. Rationale:
official sources track provider changes, reduce maintenance, and keep pricing and
recommendations trustworthy.

### II. Plugin-Based, Extensible Providers
Each cloud provider (AWS, MongoDB Atlas, and future Azure/GCP/others) is an
independent plugin with its own MCP adapter, pricing adapter, authentication
adapter, and service catalog. Adding a provider MUST be achievable by implementing
a provider plugin, not by editing core application logic. Core code never hard-codes
a provider's services, regions, or pricing — those live in the plugin/catalog.

### III. API-First & Secure by Default (NON-NEGOTIABLE)
All frontend functionality communicates through backend APIs; cloud credentials and
provider integrations never reach the browser. Security rules that cannot be waived:
HTTPS only; sessions in httpOnly cookies; **no long-term AWS credentials are ever
stored** — access uses AWS IAM Identity Center (SSO) with temporary sessions; all
authorization is enforced server-side via RBAC (roles are hierarchical and separate —
a super_admin manages admins, an admin never manages admins); secrets are encrypted;
least privilege by default. UI-level gating is a convenience, never the enforcement point.

### IV. Spec-Driven Delivery
Every non-trivial feature flows through the Spec Kit lifecycle: constitution →
`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
Specs state *what* and *why* for users and stakeholders and avoid premature technology
choices; plans own the *how* (architecture, data model, APIs, tech). Code is not
written ahead of an approved spec and plan for anything beyond trivial fixes.

### V. Verify Before Done
A change is "done" only when exercised end-to-end — the affected flow is driven and
its behavior observed, not merely typechecked. `next build` MUST pass (compile +
TypeScript + prerender). Outcomes are reported faithfully: failing tests are shown,
skipped steps are named, and completion is claimed only when verified.

## Technology & Security Constraints

- **Stack**: Next.js (App Router, current major) + React + TypeScript; Tailwind CSS v4;
  React Flow for the diagram canvas; Mongoose over MongoDB; bcrypt + JWT (jose, httpOnly
  cookie) for auth; lucide-react icons. Backend logic lives in Next.js route handlers
  (Node runtime) with the edge proxy for route gating.
- **Data**: MongoDB is the system of record. Every user-owned entity (Project,
  Connection, Architecture, CostEstimate, …) is scoped to a `userId` and access-checked
  server-side.
- **Pricing**: cost estimates come from official pricing sources; displayed figures must
  stay within ±5% of official pricing for the same configuration. Placeholder pricing is
  clearly labelled as indicative until the pricing engine is connected.
- **Advisory sources are never authoritative**: whenever the product shows something it is
  not certain of — an estimate, a cached answer, a second opinion from an external tool —
  the uncertainty MUST travel with it. An advisory input may inform the system's own
  reasoning but MUST NOT override its design decisions, and MUST NOT be presented to the
  user as fact. This generalizes the indicative-pricing rule above: the user must always be
  able to tell how much to trust what they are looking at.
- **Knowledge provenance & privacy (NON-NEGOTIABLE)**: the product keeps a durable store of
  generation knowledge that it also writes to itself, so three rules bound it. (1) **No raw
  user content leaves the system.** Anything sent to an external service is reduced to
  derived, generic terms first, and the reduction is enforced at the transport boundary, not
  left to callers. (2) **Nothing project-specific enters shared knowledge.** A lesson the
  system learns from one user's work is stored only if it is true independently of that
  work; otherwise it is discarded, not trimmed. (3) **Every stored entry carries its source
  and a confidence, and an operator can disable any entry without a deployment.** Knowledge
  that shapes every generation must be inspectable and revocable by the people responsible
  for it.
- **Cost realism for AI-generated architectures**: unless the user's request states real
  production scale (explicit traffic/data/user numbers), the assistant MUST assume a small
  MVP/prototype workload — each field's catalog default, or lower — when filling usage-scale
  config fields (requests, writes, storage, transfer, etc.), and MUST NOT confuse a field
  already denominated in millions/mo with a raw count. Every AI-planned or AI-edited config
  MUST be clamped to that field's declared bounds (and a generous ceiling for millions-mo
  fields lacking an explicit bound) as a defensive backstop, so a unit or scale mistake can
  never inflate an indicative estimate by orders of magnitude.
- **Performance**: The legacy single-shot AI architecture generation flow targets completion
  within 30 seconds. The agentic multi-step generation flow (feature 004) targets 90% of turns
  within 90 seconds end-to-end, with an enforced 120-second hard cap that no turn may exceed.
  Both envelopes remain tunable without a product change.
- **Accessibility & responsiveness floor**: every screen is responsive to mobile, has
  visible keyboard focus, and respects reduced-motion. This floor is not optional.

## Diagram Generation Flow

The AI generation experience (a new architecture or a major revision) follows a fixed
conversational sequence. Every generation surface MUST honor this ordering:

1. **Analyze first.** The assistant analyzes the user's request before asking or drawing
   anything — extracting the stated capabilities, scale signals, constraints, and gaps
   that the rest of the flow will act on.
2. **Clarify with applicable validation questions.** It then asks only the validation
   questions that genuinely apply to the requested architecture — never a generic
   questionnaire. Wherever a stated need can be met by more than one service, the
   candidate services MUST be presented as selectable options for the user to choose
   from, not silently picked on the user's behalf.
3. **Build side-by-side once clarified.** Only after clarification is resolved does the
   real architecture start building — live and side-by-side with the conversation, so
   the user watches the canvas take shape as each decision lands (honoring the feature
   004 live working-trace guarantees).
4. **Cost dialogue after requirements settle.** With requirements and analysis complete,
   the assistant asks the cost-related questions and presents priced choices: at minimum
   a cheapest (budget) option and a best-practice option, each honoring the
   cost-realism constraint above.
5. **Finalize alignment and flow.** With everything gathered, the assistant sets the
   alignment and flow of the final architecture — a coherent layout with a consistent
   flow direction, sensible grouping, and no overlapping nodes or edges.

Rationale: analyzing and clarifying before drawing prevents wasted generations built on
wrong assumptions; surfacing service and pricing choices keeps the user the
decision-maker rather than a spectator; the closing alignment pass makes the delivered
diagram read like a finished architecture document instead of a raw graph. This sequence
governs conversational ordering only — the loop time and iteration budgets in the
Performance constraint are unchanged by it.

## Development Workflow

1. `/speckit-specify` a feature → review the spec (what/why, no premature tech).
2. Optionally `/speckit-clarify` to de-risk ambiguity, then `/speckit-plan`.
3. `/speckit-tasks` to generate ordered, testable tasks; optionally `/speckit-analyze`
   for cross-artifact consistency before implementing.
4. `/speckit-implement` — build to the tasks, then verify per Principle V.
5. Use `/speckit-converge` to fold already-built work (auth, user module) into the
   spec workflow as the codebase and specs are reconciled.

Quality gates before a feature is considered complete: `next build` passes; ESLint is
clean; the primary flow is driven and observed; the responsive/a11y floor holds.

## Governance

This constitution supersedes ad-hoc practices. Amendments are made by editing this file
with a version bump and a dated entry below. Any deviation (e.g. a community dependency,
a client-side shortcut) must be justified in the relevant plan and is reviewed against
these principles. Complexity must earn its place — prefer the simplest design that
satisfies the spec (YAGNI).

**Version**: 1.5.0 | **Ratified**: 2026-07-06 | **Last Amended**: 2026-08-01

### Amendment Log

- **1.5.0 (2026-08-01)**: Technology & Security Constraints — added two rules that feature
  008 relied on but that nothing enforced. **"Knowledge provenance & privacy"**: the product
  now keeps a durable knowledge store that it writes to itself, so no raw user content may
  leave the system (enforced at the transport boundary, not left to callers), nothing
  project-specific may enter shared knowledge, and every entry carries a source and
  confidence and is disableable by an operator without a deploy. **"Advisory sources are
  never authoritative"**: uncertainty travels with whatever is shown; an advisory input may
  inform the system's reasoning but never overrides its design or reaches the user as fact —
  a generalization of the existing indicative-pricing rule. Model tiering and the agent
  roster were reviewed and deliberately left out: both are tunable implementation policy,
  and constitutionalising them would make routine tuning an amendment.

- **1.4.0 (2026-07-09)**: Added the "Diagram Generation Flow" section — the mandated
  conversational sequence for AI diagram generation: analyze the request first; ask only
  the validation questions applicable to the architecture and offer selectable service
  options where multiple services fit; begin the side-by-side live build only after
  clarification resolves; run a cost dialogue presenting at minimum a cheapest and a
  best-practice pricing option; finish by setting the alignment and flow of the final
  architecture.
- **1.3.0 (2026-07-09)**: Technology & Security Constraints — added "Cost realism for
  AI-generated architectures": the assistant defaults to MVP/prototype-scale usage
  assumptions unless told otherwise, must not confuse millions/mo fields with raw counts,
  and every AI-planned/edited config is clamped to its field's bounds as a backstop.
  Triggered by a real defect where a simple serverless API was indicatively estimated at
  $1.4M/month instead of ~$26/month.
- **1.2.0 (2026-07-09)**: Technology & Security Constraints → Performance — the 30-second
  target is now scoped to the legacy single-shot generation flow; the agentic multi-step
  generation flow (feature 004) adopts a 90s p90 target with a 120-second enforced hard cap
  (per spec 004 SC-004). Both envelopes remain tunable.
- **1.1.0 (2026-07-06)**: Principle I — AWS pricing source aligned with the spec's
  chat-based revision: pricing flows through the official AWS cost MCP, with the AWS
  Price List API retained as an approved direct fallback (was: "the AWS Pricing API").
