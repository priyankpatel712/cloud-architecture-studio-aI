# API Contracts — Cloud Architecture Studio AI MVP

All endpoints are Next.js route handlers under `app/src/app/api/`. Conventions:

- **Auth**: session is read from the httpOnly cookie via `requireSession` / `requireCan`. Unauthenticated
  → `401 {"error"}`; insufficient role/ownership → `403 {"error"}`. The edge proxy also redirects
  unauthenticated page navigation to `/login`.
- **Errors**: JSON `{ "error": string }` with an appropriate status (400 validation, 401, 403, 404, 409
  conflict, 500). Input validated with zod at the boundary (R10).
- **Ownership**: every domain route checks `ownerId === session.sub` (or `sharedWith` for read) in
  addition to role.
- **Runtime**: `export const runtime = 'nodejs'` for handlers using Mongoose.

## Already built (documented for completeness)

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `POST /api/auth/forgot` · `POST /api/auth/reset`
- `GET/POST /api/users` · `PATCH/DELETE /api/users/[id]` (RBAC-gated; admin sees only `user` role)

## New for this feature

- [projects.md](./projects.md) — project CRUD, duplicate, archive, share; architecture save/load
- [connections.md](./connections.md) — AWS SSO + Atlas connection lifecycle
- [generation.md](./generation.md) — conversational generation: persistent per-project chat with
  attachable provider tools, via the LLM orchestrator + official provider MCP adapters
- [pricing.md](./pricing.md) — official pricing lookups (AWS cost MCP; Price List API fallback)
- [export.md](./export.md) — PNG/PDF/Mermaid/JSON
- Email verification (hard gate — FR-004 as clarified): `POST /api/auth/verify/request`,
  `POST /api/auth/verify/confirm`; the edge proxy and server guards refuse workspace access for
  unverified accounts, redirecting to a verify-pending page with resend
