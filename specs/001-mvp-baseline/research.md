# Phase 0 Research — Cloud Architecture Studio AI MVP

Decisions that resolve the open technical choices for the remaining work. Each entry: the decision,
why, and the alternatives rejected. Constitution Principle I (official integrations first) governs.

## R1. AWS service recommendations & generation

- **Decision**: Use the official **AWS Labs MCP** servers as the source of service discovery,
  recommendations, and Well-Architected guidance, invoked from the backend via an AWS provider MCP
  adapter. An LLM orchestrator turns the user's description + MCP tool results into an architecture.
- **Rationale**: Constitution I mandates official MCP over community. AWS Labs MCP tracks provider
  changes and encodes Well-Architected guidance (FR-015).
- **Alternatives rejected**: Hard-coded service rules (stale, violates II); community AWS MCP forks
  (unofficial); pure-LLM guessing without MCP grounding (fails FR-015 accuracy).

## R2. MongoDB Atlas recommendations

- **Decision**: Use the official **MongoDB MCP server** for Atlas cluster/index/search/vector-search
  recommendations, via a MongoDB provider MCP adapter; Atlas Administration API for reading real
  projects/clusters once connected.
- **Rationale**: Official, matches FR-013/FR-015.
- **Alternatives rejected**: Direct driver introspection only (misses recommendation guidance).

## R3. Live pricing

- **Decision**: AWS costs via the **official AWS cost MCP** (AWS Labs pricing/cost-analysis MCP
  server) behind the AWS pricing adapter, with the **AWS Price List API** (AWS SDK v3) as the
  approved direct fallback (constitution v1.1.0); Atlas costs from official Atlas tier pricing
  behind a MongoDB pricing adapter. Results cached briefly; every figure carries an
  `indicative | exact` marker (FR-021).
- **Rationale**: FR-019 names the official AWS cost MCP; SC-002 (±5%). Adapters keep pricing
  per-provider (II).
- **Alternatives rejected**: Pricing API as the sole source (the spec's chat revision names the
  cost MCP as primary); scraping calculators (fragile); keeping the current static `catalog.ts`
  numbers as final (only acceptable as clearly-labelled indicative fallback).

## R4. AWS account connection (auth)

- **Decision**: **AWS IAM Identity Center (SSO)** via AWS SDK v3 `sso-oidc`/`sso` device/authorization
  flow. Store only the **temporary** session (access token + expiry, account id, alias, region,
  permission set) encrypted at rest; never long-term keys (FR-012).
- **Rationale**: PRD Module 2 + Constitution III.
- **Alternatives rejected**: IAM access keys (violates "no long-term credentials"); storing refresh
  material beyond session TTL.

## R5. Email delivery (verification + password reset)

- **Decision**: An **email provider abstraction** (`lib/email/`) with a transactional provider
  (e.g. Resend or Amazon SES) behind it. Until credentials are configured, a dev transport logs the
  link and the API surfaces it in non-production only (already the current reset behavior).
- **Rationale**: FR-003/FR-004; keeps the dev loop testable; production-safe. Per the 2026-07-06
  clarification, email verification is a **hard gate** — unverified accounts are refused workspace
  access — so email delivery is a production dependency for sign-up; the dev transport keeps the
  gated flow testable locally.
- **Alternatives rejected**: Coupling directly to one SDK in route handlers (harder to swap);
  non-blocking "verify later" banner (clarification chose the gate).

## R6. Persistence & multi-tenant scoping

- **Decision**: Mongoose models for Project, Connection, Architecture, CostEstimate, each carrying an
  `ownerId` (User `_id`) and access-checked in every route handler (ownership + RBAC). Reuse the
  established `connectDB` cache and `requireSession`/`requireCan` helpers.
- **Rationale**: FR-022/FR-023 + Constitution III; consistent with the built user module.
- **Alternatives rejected**: Client-side persistence (insecure); a separate service/DB (unneeded for MVP).

## R7. Provider plugin model

- **Decision**: A `providers/registry.ts` exposing a `Provider` interface — `catalog`, `pricingAdapter`,
  `mcpAdapter`, `authAdapter` — with `aws/` and `mongodb/` implementations. Core code references the
  registry, never a specific provider. Adding a provider = new folder + registry entry.
- **Rationale**: Constitution II (extensible providers). Migrates today's `lib/catalog.ts` into
  `providers/*/catalog`.
- **Alternatives rejected**: Provider `switch` statements in core (violates II).

## R8. Export

- **Decision**: PNG via `html-to-image` on the canvas; PDF via `jsPDF` (embedding the PNG + a cost
  summary); Mermaid by serializing nodes/edges to Mermaid text; JSON by serializing the architecture
  document. Generated client-side where possible, with a server route for PDF assembly if needed.
- **Rationale**: FR-024; libraries are MIT and named in the PRD.
- **Alternatives rejected**: Server-side headless rendering for PNG (heavier; unnecessary for MVP).

## R9. Concurrent edits

- **Decision**: Optimistic concurrency via a `version` field on Architecture; a save with a stale
  version is rejected with a conflict the UI can surface (edge case in spec).
- **Rationale**: Prevents silent overwrites (spec Edge Cases) without real-time infra (future).
- **Alternatives rejected**: Real-time CRDT/websockets (out of MVP scope).

## R10. Input validation

- **Decision**: **zod** schemas at each route boundary; shared with client forms where practical.
- **Rationale**: Testable, unambiguous requirements; consistent error shapes.
- **Alternatives rejected**: Ad-hoc manual checks (inconsistent).

## R11. Conversational generation (persistent per-project chat)

- **Decision**: A backend **LLM chat orchestrator** (`lib/generate/orchestrator.ts`, LLM client
  behind `lib/llm.ts`, provider/model configured via `LLM_*` env) drives one persistent
  **AIConversation thread per project**. Each user message carries **attached provider tools**
  (`aws`, `mongodb`); the orchestrator invokes only the attached providers' `mcpAdapter`s, applies
  the results to the **current architecture in place** (never a fresh start), prices via the
  pricing adapters, and appends an assistant message recording which MCP tools were invoked and
  what edits were applied. No tools attached → the assistant replies asking the user to attach a
  provider (no generation). A provider's MCP failing → the reply names the failed provider and
  offers retry or continue with the available ones. Direct canvas saves append a `system` message
  so follow-up chat builds on the edited architecture (FR-016a).
- **Rationale**: FR-014a–d + Clarifications (2026-07-06): the chat panel lives beside the canvas in
  every project and the thread persists; the MCP tools (not the LLM) remain the authority for
  service selection and price (Constitution I).
- **Alternatives rejected**: One-shot `POST /api/generate` (fails FR-014d iteration); client-side
  LLM calls (Constitution III); a fresh thread per session (clarification chose persistence).
- **Note**: No per-user generation rate limits in the MVP — explicitly deferred (clarified).

All NEEDS CLARIFICATION from Technical Context are resolved above.
