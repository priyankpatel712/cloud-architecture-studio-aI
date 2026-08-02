# Contract: Projects & Architecture (FR-022, FR-023)

## `GET /api/projects`
List the caller's projects (owned + shared-with). Query: `?status=active|draft|archived`.
→ `200 { projects: ProjectSummary[] }` where ProjectSummary = `{ id, name, description, status,
providers, services, monthly, updatedAt }`.

## `POST /api/projects`
Create a project. Body: `{ name, description? }`. → `201 { project }`. 400 on invalid name.

## `GET /api/projects/[id]`
Load a project + its current architecture. Owner or `sharedWith` only, else 403 (404 if not found).
→ `200 { project, architecture: { nodes, edges, guidance, version } }`.

## `PATCH /api/projects/[id]`
Owner-only. Body may include `{ name?, description?, status? }` (status: draft|active|archived).
→ `200 { project }`.

## `POST /api/projects/[id]/duplicate`
Owner-only. Deep-copies project + architecture, new name "… (copy)". → `201 { project }`.

## `POST /api/projects/[id]/share`
Owner-only. Body `{ email }` — grants read to that workspace user. → `200 { sharedWith }`.
Removing: `DELETE /api/projects/[id]/share` body `{ userId }`.

## `DELETE /api/projects/[id]`
Owner-only. Removes project + architecture. → `200 { ok: true }`.

## `PUT /api/projects/[id]/architecture`
Owner-only. Save the architecture. Body `{ nodes, edges, guidance?, version }`.
- If `version` ≠ stored version → `409 { error: "conflict", currentVersion }` (R9).
- Else persists, increments version, recomputes `currentEstimateMonthly`, and appends a `system`
  message to the project's AIConversation summarizing the edit so subsequent chat builds on the
  edited architecture (FR-016a; see [generation.md](./generation.md)).
→ `200 { version }`.

**Acceptance mapping**: US5/AC1–3, FR-022, FR-023, FR-016a; concurrency edge case.
