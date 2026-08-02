# Implementation Plan: Cloud Architecture Studio AI — MVP

**Branch**: `001-mvp-baseline` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-mvp-baseline/spec.md`

## Summary

Deliver the MVP of Cloud Architecture Studio AI: an authenticated workspace where users design
cloud architectures through a **persistent per-project AI chat** — attaching provider tools (AWS,
MongoDB Atlas) to each prompt — and receive an editable, costed architecture grounded in the
official provider MCPs. The chat panel lives on the project-creation page and beside the studio
canvas in every project; follow-up messages update the architecture in place, and direct canvas
edits feed back into the assistant's context (FR-014a–d, FR-016a). Authentication, RBAC
(super_admin/admin/user), and the admin panel are **already implemented**; the studio, generator,
connections, and projects screens exist as **UI shells backed by mock/indicative data**. The
remaining work: persist domain data per user; build the LLM chat orchestrator over the official
AWS MCP and MongoDB MCP; replace indicative pricing with the official AWS cost MCP (Price List API
fallback, constitution v1.1.0) and Atlas pricing; add the AWS IAM Identity Center SSO connection
flow; connect email delivery and enforce the email-verification gate (clarified FR-004); and add
export. Single shared workspace tenancy; no AI generation rate limits in the MVP (deferred). The
approach follows the constitution: official integrations first, a plugin-based provider model,
API-first and secure by default, and verify-before-done.

## Technical Context

**Language/Version**: TypeScript 5, Node.js runtime (route handlers), React 19

**Primary Dependencies**: Next.js 16 (App Router); Mongoose 9 (MongoDB ODM); jose (JWT) + bcryptjs
(passwords); @xyflow/react (React Flow canvas); Tailwind CSS v4; lucide-react; cva/clsx/tailwind-merge.
Planned additions: official AWS Labs MCP (architecture + cost) and MongoDB MCP clients; an LLM SDK
for the chat orchestrator (provider/model via `LLM_*` env, research.md R11); AWS SDK v3 (Price List
fallback, SSO/SSO-OIDC); an email provider SDK (e.g. Resend/SES); html-to-image + jsPDF + mermaid
for export; zod for input validation.

**Storage**: MongoDB (local dev at `mongodb://127.0.0.1:27017/cloud_architecture_studio`) via Mongoose.

**Testing**: `next build` (compile + typecheck + prerender) as the baseline gate; API flows verified
with scripted HTTP calls against a running server; UI flows verified via headless screenshots at
desktop + mobile. Unit tests for pure logic (RBAC, pricing math, provider adapters) added as those
modules are built.

**Target Platform**: Responsive web app (desktop + mobile browsers); Node server for route handlers;
edge runtime for the routing proxy.

**Project Type**: Web application (single Next.js app under `app/`, backend via route handlers).

**Performance Goals**: Architecture generation displayed within 30s (SC-001); cost estimates within
±5% of official pricing (SC-002); instant UI feedback on configuration change (FR-020).

**Constraints**: No long-term AWS credentials stored (temporary SSO sessions only); all provider
credentials and authorization enforced server-side; HTTPS in production; httpOnly session cookie;
secrets encrypted at rest; responsive + accessible UI floor.

**Scale/Scope**: Target 100,000 users / 10,000 projects (SC-007); 7 user stories, 26 functional
requirements; ~10 primary screens plus the admin panel.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Official Integrations First | Generation/recommendations use AWS Labs MCP + MongoDB MCP; pricing uses the official AWS cost MCP (Price List API approved fallback, v1.1.0) + Atlas pricing; community deps justified in research.md | PASS (planned) — no community provider substitutes chosen |
| II. Plugin-Based, Extensible Providers | Each provider is a plugin (catalog + pricing adapter + MCP adapter + auth adapter) behind a common interface; core has no hard-coded provider logic | PASS (planned) — see data-model.md provider-registry design |
| III. API-First & Secure by Default | All provider access via backend route handlers; RBAC + ownership checks server-side; temporary AWS sessions; no creds in browser | PASS — established pattern (proxy + route guards) extended to new entities |
| IV. Spec-Driven Delivery | This plan derives from spec.md; tasks will trace to FR/SC/US ids | PASS |
| V. Verify Before Done | `next build` + driven flows are the completion gate for every task group | PASS |

No violations. Complexity Tracking table intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-mvp-baseline/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities, provider-plugin model
├── quickstart.md        # Phase 1 output — how to run & validate
├── contracts/           # Phase 1 output — API contracts
│   ├── README.md        # conventions + built auth/users endpoints + verification gate
│   ├── projects.md
│   ├── connections.md
│   ├── generation.md    # conversational generation (per-project chat)
│   ├── pricing.md
│   └── export.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The application lives under `app/` (a single Next.js App Router project). New work extends the
existing structure; nothing here is greenfield-only.

```text
app/
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # authed workspace: home, projects, studio, connections, settings
│   │   ├── admin/                # admin panel (built): overview, users, roles
│   │   ├── login/ register/ forgot-password/ reset-password/   # auth pages (built)
│   │   └── api/
│   │       ├── auth/             # login, logout, me, register, forgot, reset (built)
│   │       ├── users/            # user CRUD with RBAC (built)
│   │       ├── projects/         # NEW — CRUD, duplicate, archive, share (per-user)
│   │       │   └── [id]/chat/    # NEW — resume thread + append message (conversational generation)
│   │       ├── chat/start/       # NEW — creation-page bootstrap (draft project + thread)
│   │       ├── connections/      # NEW — AWS SSO + Atlas connection lifecycle
│   │       ├── pricing/          # NEW — official pricing lookups
│   │       └── export/           # NEW — PNG/PDF/Mermaid/JSON
│   ├── components/               # ui/, layout/, admin/, studio/, auth/ (built) + project/, connections/ (extend)
│   │   └── studio/ChatPanel.tsx  # NEW — chat with provider tool attach chips; creation page + studio
│   ├── lib/
│   │   ├── db.ts rbac.ts auth.ts session.ts api.ts initials.ts   # built
│   │   ├── llm.ts                # NEW — LLM client for the chat orchestrator (R11)
│   │   ├── generate/             # NEW — orchestrator: message + attached tools → MCP calls → edits
│   │   ├── models/               # User (built) + Project, Connection, Architecture, CostEstimate, AIConversation (NEW)
│   │   ├── providers/            # NEW — plugin registry + aws/ and mongodb/ plugins
│   │   │   ├── registry.ts
│   │   │   ├── aws/              # catalog, pricing adapter (cost MCP), mcp adapter, sso auth adapter
│   │   │   └── mongodb/          # catalog, pricing adapter, mcp adapter, atlas auth adapter
│   │   ├── email/                # NEW — email provider abstraction (verification gate, reset)
│   │   ├── catalog.ts mock.ts    # built (catalog migrates into providers/*; mock retired as data persists)
│   └── proxy.ts                  # edge route gating (built)
└── scripts/seed.mjs              # super_admin seed (built)
```

**Structure Decision**: Single Next.js web application (Option 2 "web application" collapsed into one
app since backend is Next.js route handlers). Providers are isolated under `src/lib/providers/<name>/`
so a new provider is added by dropping in a plugin and registering it — no core edits (Constitution II).

## Complexity Tracking

No constitution violations; no entries required.
