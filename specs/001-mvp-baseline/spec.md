# Feature Specification: Cloud Architecture Studio AI — MVP

**Feature Branch**: `001-mvp-baseline`

**Created**: 2026-07-06

**Status**: Draft

**Input**: Product Requirements Document at repo root (`prd.md`), scoped to the MVP (AWS + MongoDB Atlas).

## Overview

Cloud Architecture Studio AI lets people design cloud architectures with the help of AI and
official cloud-provider integrations. On the project-creation page the user talks to an AI
assistant in a **chat interface** — describing their application and **attaching provider tools**
(AWS and/or MongoDB Atlas) to the prompt, the way modern AI chat apps let you attach tools or
context. The assistant uses the **official AWS MCP** to design the AWS architecture, the
**official AWS cost MCP** to price it, and the **official MongoDB MCP** for MongoDB services. The
result is rendered as an **editable** architecture diagram with a live cost estimate; the user
keeps refining it through further chat or by editing the diagram directly. The MVP supports two
providers only — **AWS** and **MongoDB Atlas** — while remaining extensible to more providers later.

## Clarifications

### Session 2026-07-06

- Q: What is the workspace/tenancy model for the MVP — who do admins govern and who can projects be shared with? → A: Single shared workspace — one deployment-wide workspace; all registered users belong to it; admin-tier roles govern all users; a project can be shared with any registered user.
- Q: Can users continue the AI chat when reopening an existing project, or is chat only available during initial project creation? → A: Persistent per-project chat — the chat panel lives alongside the builder canvas in every project; the conversation thread persists with the project and can be resumed any time.
- Q: How should concurrent edits to the same project from two sessions be handled? → A: Optimistic versioning — each save carries the version it was based on; a stale save is rejected and the user is told the project changed elsewhere and can reload and re-apply.
- Q: Does email verification gate access, or is it non-blocking in the MVP? → A: Required before workspace — after registering, the user must follow the emailed verification link before they can enter the workspace.
- Q: Should AI architecture generation be rate-limited per user in the MVP? → A: No limits in MVP — generations are unlimited; abuse/cost controls are deferred to a future feature.
- Q: When a user attaches a provider tool (AWS / MongoDB Atlas) to a chat prompt, how long does the attachment last? → A: Sticky per conversation — once attached, the tool stays active for all subsequent messages in that project's conversation until the user detaches it; the composer shows the current active set.
- Q: When a follow-up chat message updates the architecture in place, what must the assistant preserve? → A: Preserve user work — untouched nodes keep their manual positions, configuration overrides, and connections; generation changes only what the request requires, and the reply summarizes what changed.
- Q: Does the email-verification gate apply to accounts that never self-register (the seeded super admin, admin-created users)? → A: Pre-verified — seeded and admin-created accounts are marked verified at creation; the gate applies only to self-registered accounts.
- Q: Which region and currency do cost estimates use? → A: Per-node region, USD — each service is priced in its own configured region (falling back to a project default, initially us-east-1, when unset); all figures in USD; ±5% is measured against the same region's official price.
- Q: What happens to the project's chat thread when the project is shared, duplicated, or deleted? → A: View/fresh/cascade — shared (read-access) users can view the thread but only the owner can post; duplicating starts a fresh thread with a system note pointing at the source project; deleting the project deletes its thread.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Account & access (Priority: P1)

A new visitor creates an account, signs in, and manages their profile; if they forget their
password they can reset it. Access to the workspace requires being signed in.

**Why this priority**: Nothing else in the product is usable without an authenticated,
identified user to own projects and connections. It is the foundation for every other story.

**Independent Test**: Register a new account, sign out, sign back in, trigger a password reset
and complete it, and confirm that visiting any workspace page while signed out redirects to
sign-in. Delivers a secure, personal workspace on its own.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they register with name, email, and a valid
   password, **Then** an account is created and a verification email is sent; workspace access is
   refused until they follow the verification link, after which they are signed in and land in the
   workspace. An unverified user is shown a prompt to verify with an option to resend the link.
2. **Given** a registered user, **When** they sign in with correct credentials, **Then** they
   reach their workspace; with incorrect credentials they see an error and remain signed out.
3. **Given** a user who forgot their password, **When** they request a reset and follow the
   emailed link, **Then** they can set a new password and the old one no longer works.
4. **Given** a signed-out visitor, **When** they open any workspace URL, **Then** they are
   redirected to sign-in and returned to that URL after signing in.

---

### User Story 2 - Generate an architecture from a description (Priority: P1)

On the project-creation page, a signed-in user chats with an AI assistant to design their system.
They write a prompt describing the application (e.g. "a scalable e-commerce app for 100,000 monthly
users") and **attach the provider tools** they want the assistant to use — **AWS** and/or **MongoDB
Atlas** — the way a modern AI chat lets you attach tools/context to a message. The assistant uses
the **official AWS MCP** to select AWS services and design the architecture, the **official AWS cost
MCP** to price the underlying architecture, and the **official MongoDB MCP** for MongoDB services. It
replies with an **editable** architecture diagram (services, connections, network/security, HA/DR,
scaling guidance) and a live cost estimate. The user iterates by continuing the chat or by editing
the diagram directly, and the two stay in sync.

**Why this priority**: This chat-to-architecture experience is the product's core value proposition —
turning a conversation into a costed, best-practice, editable architecture grounded in official
provider tools — and the primary reason users adopt it.

**Independent Test**: On the creation page, attach the AWS and MongoDB tools, send a prompt, and
confirm an editable diagram with services, connections, and a cost estimate appears within the target
time; then refine it via a follow-up chat message and via a direct edit, and confirm both take effect.

**Acceptance Scenarios**:

1. **Given** the project-creation chat, **When** the user attaches the AWS tool and sends a prompt,
   **Then** the assistant uses the official AWS MCP to produce AWS services and connections and the
   official AWS cost MCP to attach a monthly cost estimate.
2. **Given** the user also attaches the MongoDB tool, **When** they send a prompt, **Then** the
   assistant uses the official MongoDB MCP to add appropriate Atlas services to the same architecture.
3. **Given** a prompt with **no** provider tool attached, **When** the user sends it, **Then** the
   assistant asks the user to attach at least one provider tool rather than guessing.
4. **Given** a generated architecture, **When** the user edits the diagram directly (add/remove/
   reconfigure a service), **Then** the change is applied, the cost re-estimates, and the assistant's
   context reflects the edited architecture for subsequent messages.
5. **Given** a follow-up chat message (e.g. "make it multi-region"), **When** the user sends it,
   **Then** the assistant updates the existing architecture rather than starting over, and the result
   remains editable.
6. **Given** a generation request, **When** it is processing, **Then** the user sees progress and the
   result appears within the performance target (see Success Criteria), reflecting Well-Architected
   guidance including network, security, HA/DR, and scaling.

---

### User Story 3 - Visually build and cost an architecture (Priority: P1)

A user assembles or edits an architecture on a canvas: browsing a catalog of AWS and MongoDB
services, dragging services onto the canvas, connecting and configuring them, and watching the
estimated cost update as they change configuration.

**Why this priority**: The interactive builder is how users refine AI output and design from
scratch; live cost feedback is a core differentiator versus disconnected diagram/pricing tools.

**Independent Test**: Drag several services onto a blank canvas, connect them, open a service and
change its configuration, and confirm the per-service and total cost update accordingly. Delivers
a usable design-and-cost tool independent of AI generation.

**Acceptance Scenarios**:

1. **Given** the builder, **When** the user drags a service from the catalog onto the canvas,
   **Then** a configurable node appears with a default configuration and an indicative cost.
2. **Given** two services on the canvas, **When** the user connects them, **Then** a directed
   connection is drawn and persists with the design.
3. **Given** a selected service, **When** the user changes a configuration value (e.g. instance
   type, memory, cluster tier), **Then** that service's cost and the architecture's total cost
   update immediately.
4. **Given** a design in progress, **When** the user pans, zooms, or removes a service, **Then**
   the canvas responds and the totals stay consistent.

---

### User Story 4 - Connect provider accounts (Priority: P2)

A user connects their AWS account through AWS IAM Identity Center (SSO) and connects their
MongoDB Atlas organization, so recommendations and pricing can reflect their real environment.
No long-term cloud credentials are ever stored.

**Why this priority**: Connections unlock provider-accurate recommendations and pricing, but the
core design and estimate experience works with the catalog before a connection exists.

**Independent Test**: Complete the AWS SSO connection flow and see a live session with account,
region, and expiry; start the Atlas connection flow. Confirm no permanent credentials are
retained and that a session expires as stated.

**Acceptance Scenarios**:

1. **Given** a user with no AWS connection, **When** they complete the IAM Identity Center flow
   (select account and permission set, authorize), **Then** a temporary, time-limited session is
   established showing account ID, alias, region, and expiry.
2. **Given** an AWS session nearing expiry, **When** it expires, **Then** AWS-dependent actions
   require re-authentication and no permanent credentials remain stored.
3. **Given** a user with an Atlas organization, **When** they connect with scoped read access,
   **Then** the platform can list their projects and clusters.

---

### User Story 5 - Manage projects (Priority: P2)

A user organizes their work into projects they can create, rename, edit, duplicate, share,
archive, and delete. Each project belongs to its owner and is not visible to other users unless
shared.

**Why this priority**: Persistence and organization make the tool usable beyond a single session,
but a first-run user can generate and design before organizing.

**Independent Test**: Create a project, edit and save an architecture in it, duplicate it, archive
it, and confirm another user cannot access it. Delivers durable, organized work.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they create a project, **Then** it is saved to their
   workspace and appears in their project list with its provider mix and current cost estimate.
2. **Given** an existing project, **When** the user duplicates or archives it, **Then** a copy is
   created or the project moves to an archived state without data loss.
3. **Given** a project owned by user A, **When** user B who it was not shared with tries to open
   it, **Then** access is denied.

---

### User Story 6 - Administer users and roles (Priority: P2)

An administrator manages people in the workspace. There are three separate roles: **super admin**,
**admin**, and **user**. A super admin can manage admins and users; an admin can manage only
standard users and can never manage admins or super admins. Non-admins have no access to the admin
area.

**Why this priority**: Role separation and user management are required for team and organizational
use and for safe delegation, but the single-user product functions before administration is needed.

**Independent Test**: As a super admin, create an admin and a user; sign in as that admin and
confirm they can see and manage only standard users and cannot create or edit admins or super
admins; confirm a standard user cannot reach the admin area at all.

**Acceptance Scenarios**:

1. **Given** a super admin, **When** they open the admin area, **Then** they can list, create,
   edit, suspend, and delete users of any role, and assign any role.
2. **Given** an admin, **When** they open user management, **Then** they see only standard users,
   can create/edit/suspend/delete standard users, and cannot assign or manage admin-tier roles.
3. **Given** a standard user, **When** they attempt to reach the admin area, **Then** they are
   denied and redirected to their workspace.
4. **Given** any actor, **When** they attempt to delete their own account or remove the last super
   admin, **Then** the action is refused.

---

### User Story 7 - Export an architecture (Priority: P3)

A user exports a finished architecture to share or document it, in image, document, diagram-code,
or data form.

**Why this priority**: Export increases the tool's usefulness for handoff and documentation but is
not required to design and cost an architecture.

**Independent Test**: From a completed architecture, export to each supported format and confirm a
valid file is produced that represents the current design.

**Acceptance Scenarios**:

1. **Given** a completed architecture, **When** the user exports as an image or document, **Then**
   a file representing the current diagram and its cost summary is produced.
2. **Given** a completed architecture, **When** the user exports as diagram code or structured
   data, **Then** the exported content faithfully represents the services and connections.

---

### Edge Cases

- **Generation cannot satisfy the request** (unsupported provider, contradictory constraints): the
  user is told what could not be done and is offered a partial result or guidance rather than a
  silent failure.
- **Chat prompt with no provider tool attached**: the assistant asks the user to attach at least one
  provider (AWS and/or MongoDB) instead of guessing which cloud to design for.
- **An official MCP tool is unavailable or errors**: the assistant reports which provider tool failed
  and offers to retry or continue with the available provider(s), rather than failing the whole chat.
- **Direct edit conflicts with a pending chat generation**: the latest completed change wins and the
  user is shown the reconciled architecture; no edit is silently discarded.
- **Provider session expires mid-task**: the user is prompted to re-authenticate; in-progress design
  work is not lost.
- **Pricing source is unavailable or a service is unpriced**: costs shown are clearly marked as
  indicative/unavailable rather than presented as exact.
- **Duplicate email at registration**: registration is refused with a clear message; account
  existence is not leaked on password-reset requests.
- **Empty canvas or disconnected services**: totals read zero/partial correctly; the user can still
  save and export.
- **Concurrent edits to the same project**: saves use optimistic versioning — a save based on a
  stale version is rejected, and the user is told the project changed elsewhere and can reload and
  re-apply their change; no silent overwrites.
- **Admin self-management**: an admin/super admin cannot escalate their own role or lock the
  workspace out of all super admins.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication & user management**

- **FR-001**: System MUST let a visitor register with name, email, and password, creating a
  standard-role account.
- **FR-002**: System MUST authenticate users by email and password and establish a signed-in
  session; optional Google and GitHub sign-in MAY be offered.
- **FR-003**: Users MUST be able to request a password reset and set a new password via a
  time-limited, single-use link; the previous password MUST stop working.
- **FR-004**: System MUST verify a user's email address before granting workspace access:
  registration sends a time-limited verification link; unverified accounts are refused workspace
  access with a prompt to verify and an option to resend the link. The gate applies to
  **self-registered accounts only** — seeded and admin-created accounts are marked verified at
  creation.
- **FR-005**: Users MUST be able to view and edit their profile (name, email, organization, role
  label, avatar).
- **FR-006**: System MUST require authentication for all workspace areas and redirect
  unauthenticated visitors to sign-in, returning them to their intended destination afterward.
- **FR-007**: System MUST provide three separate roles — super admin, admin, user — where an actor
  can only manage roles strictly below their own (super admin manages admins and users; admin
  manages only users).
- **FR-008**: System MUST restrict the admin area to admin-tier roles and enforce all
  authorization on the server, not only in the interface.
- **FR-009**: Admins MUST be able to create, edit, suspend, and delete standard users; super admins
  MUST additionally be able to manage admins and super admins and assign any role.
- **FR-010**: System MUST prevent an actor from deleting their own account and MUST prevent removal
  of the last super admin.

**Provider connections**

- **FR-011**: Users MUST be able to connect an AWS account via AWS IAM Identity Center (SSO),
  selecting account and permission set and authorizing access.
- **FR-012**: System MUST establish only temporary AWS sessions and MUST NOT store long-term AWS
  credentials; sessions MUST show account ID, alias, region, and expiry and expire as stated.
- **FR-013**: Users MUST be able to connect a MongoDB Atlas organization with scoped read access
  and list projects and clusters.

**Design & generation (chat-based)**

- **FR-014**: System MUST present a conversational chat interface — on the project-creation page
  and alongside the canvas in every existing project — where a user sends a natural-language prompt
  and receives a generated architecture (diagram, recommended services, network, security, HA/DR,
  and scaling guidance) in reply.
- **FR-014a**: Users MUST be able to **attach one or more provider tools** (AWS, MongoDB Atlas) to
  the chat, the way modern AI chat interfaces attach tools/context; the assistant uses only the
  attached providers. An attachment is **sticky per conversation**: it stays active for all
  subsequent messages in that project's conversation until the user detaches it, and the composer
  always shows the currently active set. If the active set is empty when a message is sent, the
  assistant MUST ask the user to attach a provider rather than guessing.
- **FR-014b**: When the AWS tool is attached, the system MUST design the AWS portion of the
  architecture using the **official AWS MCP** (service selection + Well-Architected guidance).
- **FR-014c**: When the MongoDB tool is attached, the system MUST design the MongoDB Atlas portion of
  the architecture using the **official MongoDB MCP**.
- **FR-014d**: The chat MUST be **iterative** — a follow-up message updates the existing architecture
  in place (not a fresh start), keeping the assistant's context in sync with the current architecture.
  In-place updates MUST **preserve user work**: nodes not required to change by the request keep
  their manual positions, configuration overrides, and connections, and the assistant's reply
  summarizes what changed. The conversation thread persists with its project across sessions and can
  be resumed at any time.
- **FR-015**: System MUST base all provider recommendations on the official provider MCP tools and
  apply Well-Architected guidance (no hand-rolled recommendation rules).
- **FR-016**: The generated architecture MUST be **editable**: the same interactive canvas lets users
  add, remove, connect, configure, and lay out services, with zoom, pan, undo, and redo; direct edits
  and chat edits act on the same architecture.
- **FR-016a**: A direct edit to the diagram MUST re-estimate cost and MUST be reflected in the
  assistant's context so subsequent chat messages build on the edited architecture.
- **FR-017**: System MUST offer a catalog of AWS and MongoDB services organized by category, each
  addable to the canvas (for manual building alongside the chat).
- **FR-018**: Users MUST be able to configure per-service settings (e.g. compute memory/runtime,
  instance type and storage, database cluster tier/region/backup/search).

**Pricing**

- **FR-019**: System MUST price the underlying architecture using the **official AWS cost MCP** for
  AWS services and official Atlas pricing for MongoDB, presenting monthly cost, annual cost, and
  per-service cost. All figures are in **USD**; each service is priced in its **own configured
  region**, falling back to the project's default region (initially us-east-1) when unset.
- **FR-020**: System MUST update cost estimates immediately when a service's configuration changes or
  the architecture is edited (whether via chat or direct edit).
- **FR-021**: System MUST clearly mark any cost that is indicative or unavailable rather than
  presenting it as exact.

**Projects & export**

- **FR-022**: Users MUST be able to create, edit, rename, duplicate, share, archive, and delete
  projects; each project is owned by a user and private unless shared. Duplicating a project copies
  its architecture but starts a **fresh** conversation thread (with a system note referencing the
  source project); deleting a project deletes its thread.
- **FR-023**: System MUST persist an architecture (services, connections, configuration, and cost
  estimate) within its project across sessions.
- **FR-024**: Users MUST be able to export an architecture as image (PNG), document (PDF), diagram
  code (Mermaid), and structured data (JSON).

**Cross-cutting**

- **FR-025**: System MUST communicate all provider access and credentials through the backend; no
  provider credentials are exposed to the browser.
- **FR-026**: System MUST present a responsive, accessible interface across desktop and mobile.

### Key Entities *(include if feature involves data)*

- **User**: a person with a name, email, credentials, role (super admin/admin/user), status, and
  profile; owns projects and connections.
- **Project**: a named, owned container for an architecture, with status (draft/active/archived),
  provider mix, and a current cost estimate.
- **CloudConnection**: a link to a provider account, specialized as **AWSAccount** (SSO session:
  account ID, alias, region, permission set, expiry — temporary) and **MongoDBConnection** (Atlas
  organization with scoped read access).
- **Architecture**: the design within a project — a set of services and connections plus generated
  guidance (network, security, HA/DR, scaling).
- **ServiceNode**: a placed service with its provider, category, and configuration, carrying an
  estimated cost.
- **ServiceEdge**: a directed connection between two service nodes.
- **CostEstimate**: the computed monthly/annual/per-service cost for an architecture at a point in
  time, with an indicative/exact marker.
- **Export**: a produced artifact of an architecture in a chosen format.
- **AIConversation**: the ordered chat thread for a project's design — each message, the **provider
  tools attached** to it (AWS, MongoDB), which official MCP tools were invoked, and the resulting
  edits to the architecture. Links the chat to the architecture it produces and keeps them in sync.
  Shared (read-access) users can view the thread; only the owner can post. The thread is deleted
  with its project and is not copied on duplication.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from a natural-language description to a displayed, costed architecture
  in under 30 seconds for a typical request.
- **SC-002**: Displayed cost estimates are within ±5% of official provider pricing for the same
  configuration and region (USD).
- **SC-003**: At least 95% of AWS SSO connection attempts complete successfully.
- **SC-004**: At least 90% of AI-generated architectures are usable without manual correction.
- **SC-005**: A new user can create an account and reach their workspace in under 2 minutes.
- **SC-006**: A user can assemble a five-service architecture with live costs in under 5 minutes
  without assistance.
- **SC-007**: The platform supports at least 100,000 users and 10,000 projects with concurrent
  architecture generation and no functional degradation.
- **SC-008**: Overall user satisfaction with generated architectures averages above 4.5 out of 5.
- **SC-009**: 100% of authorization checks are enforced server-side (no admin action succeeds from
  the interface alone), verified by testing that role rules cannot be bypassed via the API.

## Assumptions

- **MVP providers are AWS and MongoDB Atlas only**; other providers (Azure, GCP, Cloudflare,
  Vercel, etc.) are out of scope for this baseline and are future work.
- **Official MCP tools are available and are the sole recommendation/pricing source**: the official
  AWS MCP for AWS architecture, the official AWS cost MCP for AWS pricing, and the official MongoDB
  MCP for Atlas. Where a tool is momentarily unavailable, indicative pricing/guidance is shown and
  clearly labelled, never presented as exact.
- **An LLM assistant orchestrates the chat**, invoking the attached provider MCP tools; the assistant
  turns tool results into the architecture and cost, and the provider MCP tools (not the LLM) are the
  authority for service selection and price.
- **Email delivery is available** for verification and password-reset links; until it is connected,
  a development-only fallback surfaces the verification and reset links so both flows are testable,
  and this fallback is disabled in production. Because verification gates workspace access, email
  delivery is a hard dependency for production sign-up.
- **Self-registration always creates a standard user**; elevated roles are granted only by an
  admin-tier user.
- **Single shared workspace**: the deployment has exactly one workspace; every registered user
  belongs to it, admin-tier roles govern all users platform-wide, and there is no Organization/
  multi-tenant entity in the MVP.
- **Project sharing in the MVP** grants read access to specified individual users (any registered
  user of the workspace); public links and real-time collaboration are future work.
- **Standard web/mobile expectations** apply for availability (target 99.9% uptime), transport
  security (encrypted in transit), and secret handling (secrets encrypted at rest).
- **No AI generation rate limits in the MVP**: users may run unlimited chat generations;
  per-user rate limiting, quotas, and cost controls are explicitly deferred to a future feature.
- **Undo/redo and layout state** apply to the current editing session of an architecture.
