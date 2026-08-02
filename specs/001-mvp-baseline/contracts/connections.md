# Contract: Provider Connections (FR-011, FR-012, FR-013)

All connections belong to the caller (`ownerId = session.sub`). Secrets/session material are stored
encrypted and never returned to the client.

## `GET /api/connections`
→ `200 { aws: AwsConnState | null, mongodb: AtlasConnState | null }`.
- `AwsConnState`: `{ status, accountId, alias, region, permissionSet, sessionExpiresAt }` (no token).
- `AtlasConnState`: `{ status, orgName, projectsCount }` (no key).

## AWS — IAM Identity Center (SSO)  (FR-011, FR-012)
1. `POST /api/connections/aws/start` → begins SSO device/authorization flow → `200 { verificationUri,
   userCode, deviceCode }`.
2. `POST /api/connections/aws/poll` body `{ deviceCode }` → polls for authorization; on success stores
   the **temporary** session (encrypted) with `sessionExpiresAt`. → `200 { status: 'connected',
   accountId, alias, region, permissionSet, sessionExpiresAt }`.
3. `POST /api/connections/aws/disconnect` → revokes + clears session. → `200 { ok }`.

Invariant: **no long-term credentials are persisted**; only the time-limited session. Expired session →
AWS-dependent routes return `409 { error: "aws_session_expired" }` prompting reconnect.

## MongoDB Atlas  (FR-013)
1. `POST /api/connections/mongodb` body `{ publicKey, privateKey, orgId }` — validates scoped read
   access, stores key encrypted. → `200 { status: 'connected', orgName, projectsCount }`.
2. `GET /api/connections/mongodb/projects` → `200 { projects: [{ id, name, clusters }] }`.
3. `DELETE /api/connections/mongodb` → `200 { ok }`.

**Acceptance mapping**: US4/AC1–3, FR-011–013; session-expiry edge case.
