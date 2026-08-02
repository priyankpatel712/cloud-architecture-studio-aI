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
- **Performance**: AI architecture generation targets completion within 30 seconds.
- **Accessibility & responsiveness floor**: every screen is responsive to mobile, has
  visible keyboard focus, and respects reduced-motion. This floor is not optional.

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

**Version**: 1.1.0 | **Ratified**: 2026-07-06 | **Last Amended**: 2026-07-06

### Amendment Log

- **1.1.0 (2026-07-06)**: Principle I — AWS pricing source aligned with the spec's
  chat-based revision: pricing flows through the official AWS cost MCP, with the AWS
  Price List API retained as an approved direct fallback (was: "the AWS Pricing API").
