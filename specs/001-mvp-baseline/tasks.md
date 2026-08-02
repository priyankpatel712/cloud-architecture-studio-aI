---
description: "Task list for Cloud Architecture Studio AI — MVP"
---

# Tasks: Cloud Architecture Studio AI — MVP

**Input**: Design documents from `specs/001-mvp-baseline/` (revised 2026-07-06: chat-based
generation, clarifications session, constitution v1.1.0)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not TDD-mandated by the spec; unit tests are included as targeted Polish tasks for pure
logic (RBAC, pricing, adapters). Flow verification per Constitution V is the primary gate.

**Organization**: Grouped by user story. All paths are under `app/` (single Next.js project).

> **Legend**: `[x]` = already implemented before Spec Kit adoption (predates this spec; a later
> `/speckit-converge` will reconcile any gaps). `[ ]` = remaining actionable work. `[P]` = parallelizable.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Add dependencies to `app/package.json`: official AWS Labs MCP clients (architecture + **cost MCP**), official MongoDB MCP client, an LLM SDK for the chat orchestrator (research.md R11), AWS SDK v3 (`@aws-sdk/client-pricing` as Price List fallback, `@aws-sdk/client-sso-oidc`, `@aws-sdk/client-sso`), `zod`, `html-to-image`, `jspdf`, `mermaid`, and an email provider SDK (Resend or `@aws-sdk/client-sesv2`).
- [X] T002 [P] Add + document env vars in `app/.env.local`: `AWS_SSO_*`, `ATLAS_*`, `EMAIL_*`, `LLM_*` (provider/model for the orchestrator), and `ENCRYPTION_KEY` (for connection secrets at rest).
- [X] T003 [P] Create secrets encryption helper `app/src/lib/crypto.ts` (authenticated encrypt/decrypt for stored connection session material) per Constitution III.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Blocks US2, US3, US4, US5. Must complete first.

- [X] T004 Define the provider plugin interface + registry in `app/src/lib/providers/registry.ts` (`Provider { id, label, accent, catalog, pricingAdapter, mcpAdapter, authAdapter }`) per research.md R7 / Constitution II.
- [X] T005 [P] Migrate `app/src/lib/catalog.ts` into `app/src/lib/providers/aws/catalog.ts` and `app/src/lib/providers/mongodb/catalog.ts`; re-export a compatibility surface so existing studio imports keep working.
- [X] T006 [P] Add `zod` request schemas + extend `app/src/lib/api.ts` with a shared validation error shape (research.md R10).
- [X] T007 [P] Create `Project` model in `app/src/lib/models/Project.ts` (data-model.md).
- [X] T008 [P] Create `Architecture` model (embedded `ServiceNode`/`ServiceEdge`, `version`, `guidance`, `generatedFrom`) in `app/src/lib/models/Architecture.ts`.
- [X] T009 [P] Create `Connection` model (AWS + Atlas variants, encrypted fields `select:false`) in `app/src/lib/models/Connection.ts`.
- [X] T010 [P] Create `CostEstimate`, `AIConversation`, and `Export` models in `app/src/lib/models/`. `AIConversation` is the **per-project message thread** (unique `projectId`; embedded messages with `role`, `text`, `attachedTools`, `mcpCalls`, `editsApplied`) per data-model.md.
- [X] T011 Create email abstraction `app/src/lib/email/` (provider interface + dev transport that logs/returns the link in non-prod, real provider in prod) per research.md R5.

**Checkpoint**: Persistence, provider registry, validation, encryption, and email are available.

---

## Phase 3: User Story 1 - Account & access (Priority: P1) 🎯 MVP

**Goal**: Secure, personal, authenticated workspace with a verified email gate. **Independent
Test**: register → verify email (gate enforced) → sign out → sign in → reset password → gated
navigation → edit profile. *(Auth core built; verification gate + profile are new.)*

- [x] T012 [US1] Register/login/logout/me APIs in `app/src/app/api/auth/*` (built — FR-001, FR-002, FR-006).
- [x] T013 [US1] Forgot/reset APIs with one-time, expiring token in `app/src/app/api/auth/{forgot,reset}` (built — FR-003).
- [x] T014 [US1] Auth pages + edge proxy gating + account menu (`app/src/app/{login,register,forgot-password,reset-password}`, `app/src/proxy.ts`, `AccountMenu`) (built — FR-006).
- [X] T015 [US1] Send the real password-reset email via `lib/email` and remove the dev-only link from the response in production (FR-003).
- [X] T016 [US1] Email verification model + APIs: add `verifyTokenHash`/`verifyTokenExpires`/`emailVerifiedAt` to `app/src/lib/models/User.ts`; registration sends a time-limited verification link via `lib/email`; `POST /api/auth/verify/request` (resend) + `POST /api/auth/verify/confirm` in `app/src/app/api/auth/verify/` (FR-004).
- [X] T017 [US1] Enforce the verification **gate**: edge proxy (`app/src/proxy.ts`) + server guards refuse workspace access for unverified accounts, redirecting to a verify-pending page (`app/src/app/verify/page.tsx`) with a resend button (FR-004 as clarified, US1/AC1).
- [X] T018 [US1] Profile view/edit: wire the settings page (`app/src/app/(dashboard)/settings/page.tsx`) to load and update name, email, organization, role label, avatar via the users API (FR-005).

**Checkpoint**: Full account lifecycle including the verified-email gate and profile management.

---

## Phase 4: User Story 2 - Generate an architecture via chat (Priority: P1)

**Goal**: Persistent per-project AI chat with attachable provider tools → costed, best-practice,
editable architecture (contracts/generation.md). **Independent Test**: attach AWS + MongoDB tools,
send a prompt → diagram + guidance + estimate within 30s; follow-up message updates in place;
no-tool prompt → assistant asks to attach; direct edit reflected in next reply; thread resumes on reopen.

- [X] T019 [P] [US2] AWS MCP adapter `app/src/lib/providers/aws/mcp.ts` calling the official AWS Labs MCP for service recommendations + Well-Architected guidance (research.md R1, FR-014b, FR-015).
- [X] T020 [P] [US2] MongoDB MCP adapter `app/src/lib/providers/mongodb/mcp.ts` for Atlas recommendations via the official MongoDB MCP (R2, FR-014c).
- [X] T021 [P] [US2] LLM client `app/src/lib/llm.ts` — provider/model from `LLM_*` env, used only by the backend orchestrator (research.md R11, Constitution III).
- [X] T022 [US2] Chat orchestrator `app/src/lib/generate/orchestrator.ts` — receives a message + attached tools, invokes ONLY the attached providers' MCP adapters, applies results to the CURRENT architecture in place (never a fresh start), prices affected nodes via the pricing adapters, and returns the assistant message with `mcpCalls` + `editsApplied`; per-provider MCP failure is reported distinctly for retry/continue (FR-014a–d, FR-015; R11).
- [X] T023 [US2] Conversation APIs per contracts/generation.md: `POST /api/chat/start` (draft project + thread) in `app/src/app/api/chat/start/route.ts`; `GET /api/projects/[id]/chat` + `POST /api/projects/[id]/chat/messages` in `app/src/app/api/projects/[id]/chat/` — persist the `AIConversation` thread, bump `Architecture.version`, return updated architecture + estimate; no tool attached → assistant asks to attach (no MCP calls); unsatisfiable → `422 { error, partial? }` (FR-014, FR-014a/d).
- [X] T024 [US2] `ChatPanel` component `app/src/components/studio/ChatPanel.tsx` — message thread, provider tool attach chips (AWS / MongoDB Atlas), progress state, thread resume — mounted on the creation page (`app/src/app/(dashboard)/projects/new/page.tsx`, replacing the simulated step sequence) AND alongside the studio canvas (FR-014, Clarifications 2026-07-06).
- [X] T025 [US2] Chat edge-case UX in `ChatPanel`: no-tool prompt shows the assistant's attach request; a failed provider MCP shows which provider failed with retry / continue-with-available actions; unsatisfiable requests show what couldn't be done + the partial result (spec edge cases; US2/AC3).
- [X] T026 [US2] Direct-edit context sync: `PUT /api/projects/[id]/architecture` (T031) appends a `system` message to the project's thread summarizing the edit, so follow-up chat builds on the edited architecture; latest completed change wins when an edit lands mid-generation (FR-016a; US2/AC4; spec edge case). Depends on T023 + T031.

**Checkpoint**: Real conversational generation grounded in official MCP, persistent per project.

---

## Phase 5: User Story 3 - Build & cost an architecture (Priority: P1)

**Goal**: Interactive canvas with official live pricing and persistence. **Independent Test**: drag +
connect + configure services → costs update; save → reload → persists; stale save → conflict UX.

- [X] T027 [P] [US3] AWS pricing adapter `app/src/lib/providers/aws/pricing.ts` via the **official AWS cost MCP**, with the AWS Price List API (SDK v3) as approved direct fallback, returning `{cost, basis:'exact'}` (research.md R3, FR-019, constitution v1.1.0).
- [X] T028 [P] [US3] MongoDB/Atlas pricing adapter `app/src/lib/providers/mongodb/pricing.ts` (FR-019).
- [X] T029 [US3] `POST /api/pricing/estimate` in `app/src/app/api/pricing/route.ts` — per-service + totals with `basis` exact/indicative (FR-019, FR-021, contracts/pricing.md).
- [X] T030 [US3] Replace the studio's local `catalog.estimate()` calls with `/api/pricing/estimate`; keep an indicative fallback that is clearly labelled (FR-020, FR-021).
- [X] T031 [US3] Architecture persistence: `PUT/GET /api/projects/[id]/architecture` with optimistic `version` conflict (`409 { error, currentVersion }`) per research.md R9 (FR-023; Clarifications 2026-07-06).
- [X] T032 [US3] Wire the studio load/save to persistence (replace `lib/mock`), including the version-conflict UX (reload + re-apply prompt).

**Checkpoint**: Designs are official-priced and durable.

---

## Phase 6: User Story 4 - Connect provider accounts (Priority: P2)

**Goal**: AWS SSO + Atlas connections with no long-term credentials. **Independent Test**: complete
AWS SSO → session with account/region/expiry, no stored keys; connect Atlas → list projects.

- [X] T033 [US4] AWS SSO auth adapter `app/src/lib/providers/aws/auth.ts` — IAM Identity Center device/authorization flow (research.md R4, FR-011).
- [X] T034 [US4] AWS connection APIs `app/src/app/api/connections/aws/{start,poll,disconnect}` storing only the encrypted temporary session (FR-012); expired → `409 aws_session_expired`.
- [X] T035 [US4] Atlas auth adapter + `POST/GET/DELETE /api/connections/mongodb` with scoped read key (FR-013).
- [X] T036 [US4] Wire the connections UI (`app/src/app/(dashboard)/connections/page.tsx`) to the real flows, replacing `lib/mock` `CONNECTIONS`.
- [X] T037 [US4] Re-authentication prompt when an AWS session expires mid-task; in-progress design work is preserved — spec edge case.

**Checkpoint**: Real, secure provider connections.

---

## Phase 7: User Story 5 - Manage projects (Priority: P2)

**Goal**: Per-user project CRUD, duplicate, archive, share (single shared workspace — any registered
user can be a share target). **Independent Test**: create → edit → duplicate → archive; another
user cannot open it unless shared.

- [X] T038 [US5] Projects CRUD APIs `app/src/app/api/projects/route.ts` + `.../[id]/route.ts` (list/create/get/patch/delete), owner + `sharedWith` scoped (FR-022, contracts/projects.md).
- [X] T039 [US5] Duplicate/archive/share endpoints `.../[id]/{duplicate,share}` (FR-022).
- [X] T040 [US5] Wire the projects list + dashboard (`app/src/app/(dashboard)/{page.tsx,projects/page.tsx}`) to real data, replacing `lib/mock` `PROJECTS`.
- [X] T041 [US5] Enforce + verify ownership/share access (US5/AC3, SC-009).

**Checkpoint**: Durable, organized, access-controlled projects.

---

## Phase 8: User Story 6 - Administer users and roles (Priority: P2)

**Goal**: Separate super_admin/admin/user with server-side RBAC. **Independent Test**: admin manages
only standard users; user cannot reach `/admin`. *(Built.)*

- [x] T042 [US6] `User` model + RBAC (`app/src/lib/{models/User.ts,rbac.ts}`) with `canManageRole` strict-rank rule (built — FR-007).
- [x] T043 [US6] Users CRUD APIs with role gating + admin panel (`app/src/app/api/users/*`, `app/src/app/admin/*`) (built — FR-008, FR-009).
- [x] T044 [US6] Safety rails: no self-delete, no removing last super admin (built — FR-010).

**Checkpoint**: Role separation enforced and verified.

---

## Phase 9: User Story 7 - Export an architecture (Priority: P3)

**Goal**: Export to PNG/PDF/Mermaid/JSON. **Independent Test**: export each format → valid file
reflecting the design.

- [X] T045 [P] [US7] Serialization `app/src/lib/export/serialize.ts` — architecture → Mermaid text and → JSON document (FR-024).
- [X] T046 [US7] PNG via `html-to-image` on the canvas + PDF via `jsPDF` (diagram image + cost summary) (FR-024, US7/AC1).
- [X] T047 [US7] `GET /api/projects/[id]/export?format=...` + `Export` audit record; wire the studio Export button (currently JSON-only) to all four formats (FR-024, contracts/export.md).

**Checkpoint**: Full export.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T048 [P] Retire `app/src/lib/mock.ts` once every screen reads real data.
- [X] T049 [P] Responsive + accessibility pass on all new screens including `ChatPanel` and the verify-pending page (focus states, reduced motion, mobile) (FR-026).
- [X] T050 [P] Unit tests for pure logic: RBAC (`rbac.ts`), pricing math (adapters), provider registry, orchestrator tool-attachment rules (no-tool → ask; only attached providers invoked).
- [X] T051 [P] Pricing-accuracy check: compare `/api/pricing/estimate` for a sample of AWS + Atlas configurations against official published pricing; assert within ±5% (SC-002).
- [X] T052 Run `specs/001-mvp-baseline/quickstart.md` validation; `npm run build` + `npm run lint` green (Constitution V).
- [X] T053 Security pass: assert no provider credentials appear in any client response; API-level tests that role/ownership rules cannot be bypassed (SC-009); confirm the LLM orchestrator and MCP calls run server-side only (Constitution III).

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** blocks all stories.
- **US1**: auth core built; T015/T016 depend on T011 (email); T017 depends on T016; T018 independent.
- **US2** depends on Foundational (registry, models incl. `AIConversation`), pricing adapters
  (T027/T028) for cost-in-results, and T031 (architecture persistence) for in-place updates —
  sequence T027/T028/T031 before T022/T023. T026 depends on T023 + T031.
- **US3** depends on Foundational + pricing adapters (T027/T028) and the architecture model (T008).
- **US4, US5** depend on Foundational (models, crypto). US5 persistence (T031/T038) underpins saving
  generated architectures from US2.
- **US6 (built)** independent. **US7** depends on an architecture existing (US2/US3).
- **Polish** last.

## Parallel Opportunities

- Setup T001–T003 in parallel.
- Foundational models T007–T010 in parallel (different files); T005/T006 in parallel.
- Provider adapters per story marked [P] (T019/T020/T021, T027/T028, T045) in parallel.
- After Foundational, US4, US5, and US7 can be staffed in parallel; US2 and US3 share pricing and
  persistence, so sequence T027/T028 (pricing) and T031 (persistence) before T022–T026.

## Implementation Strategy

**MVP (P1) first**: finish Setup + Foundational, then US1 gaps (T015–T018), then the shared
US3 substrate (T027–T031), then US2 conversational generation (T019–T026) and the studio wiring
(T030/T032) — that is the demoable core (chat → costed, editable, saved architecture that survives
reload). Then layer P2 (connections, projects; admin already done) and P3 (export). Validate each
story with `npm run build` + a driven flow before moving on (Constitution V).

## Notes

- `[x]` tasks predate Spec Kit; run `/speckit-converge` after an `/speckit-implement` pass to surface
  any gaps between these artifacts and the built code as fresh convergence tasks.
- Migrate off `lib/catalog.ts` / `lib/mock.ts` incrementally — keep them as labelled indicative
  fallbacks until the real sources are wired (FR-021).
- No AI generation rate limits in the MVP — explicitly deferred (Clarifications 2026-07-06); do not
  add throttling to the chat APIs.
