# Phase 1 Data Model — Cloud Architecture Studio AI MVP

Persistence is MongoDB via Mongoose. Every user-owned document carries `ownerId` and is access-checked
server-side (Constitution III). **Built** entities are marked; the rest are new.

## Entities

### User *(built — `lib/models/User.ts`)*

| Field | Type | Notes |
|-------|------|-------|
| name | string | required |
| email | string | unique, lowercase |
| passwordHash | string | select:false |
| role | 'super_admin' \| 'admin' \| 'user' | RBAC (built) |
| status | 'active' \| 'suspended' \| 'invited' | |
| organization | string | |
| emailVerifiedAt | Date \| null | **NEW** — supports FR-004 |
| lastLoginAt | Date \| null | |
| resetTokenHash / resetTokenExpires | string / Date | select:false (built) |
| verifyTokenHash / verifyTokenExpires | string / Date | **NEW** — select:false, email verification |

### Project *(new)*

| Field | Type | Notes |
|-------|------|-------|
| ownerId | ObjectId → User | required, indexed |
| name | string | required |
| description | string | |
| status | 'draft' \| 'active' \| 'archived' | FR-022 |
| providers | ('aws' \| 'mongodb')[] | derived from architecture |
| sharedWith | ObjectId[] → User | read access (Assumptions) |
| currentEstimateMonthly | number | denormalized for list views |
| createdAt / updatedAt | Date | timestamps |

Relationships: a Project has one current **Architecture** (embedded or referenced). Access: owner or a
user in `sharedWith` (read); mutations owner-only.

### Architecture *(new)*

| Field | Type | Notes |
|-------|------|-------|
| projectId | ObjectId → Project | required, indexed |
| nodes | ServiceNode[] | embedded |
| edges | ServiceEdge[] | embedded |
| guidance | { network, security, ha, dr, scaling: string } | from generation (FR-014) |
| version | number | optimistic concurrency (R9) |
| generatedFrom | ObjectId → AIConversation \| null | provenance |

**ServiceNode** (embedded): `nodeId`, `provider`, `serviceId` (catalog key), `category`, `position {x,y}`,
`config: Record<string,string|number>`, `cost: number`, `costBasis: 'indicative' | 'exact'`.

**ServiceEdge** (embedded): `edgeId`, `source` (nodeId), `target` (nodeId), `label?`.

### Connection *(new)*

Base: `ownerId`, `provider` ('aws' | 'mongodb'), `status` ('connected' | 'expired' | 'disconnected'),
`createdAt`.

- **AWS (IAM Identity Center)**: `accountId`, `alias`, `region`, `permissionSet`, `sessionExpiresAt`,
  `encryptedSession` (select:false) — **temporary only**, never long-term keys (FR-012).
- **MongoDB Atlas**: `orgId`, `orgName`, `encryptedApiKey` (select:false, scoped read), `projectsCount`.

### CostEstimate *(new — may be embedded snapshot on Architecture)*

`architectureId`, `monthly`, `annual`, `perService: {serviceId, cost, basis}[]`, `basis`
('indicative' | 'exact'), `computedAt`. Supports FR-019/FR-021.

### AIConversation *(new — one persistent thread per project)*

`ownerId`, `projectId` (unique index — the project's chat thread, resumable any time), `status`
('idle' | 'generating' | 'failed'), `messages[]`, `createdAt` / `updatedAt`. Supports FR-014a–d.

**Message** (embedded): `role` ('user' | 'assistant' | 'system'), `text`,
`attachedTools: ('aws' | 'mongodb')[]` (on user messages — the provider tools attached to that
prompt), `mcpCalls: { provider, tool, status: 'ok' | 'failed' }[]` (on assistant messages — the
official MCP tools invoked), `editsApplied: string[]` (summary of node/edge/config changes applied
to the Architecture), `createdAt`.

The orchestrator updates the linked Architecture **in place** on each turn (FR-014d);
`Architecture.generatedFrom` links back to this thread. Direct canvas saves append a `system`
message summarizing the edit so the assistant's context stays in sync (FR-016a). On the creation
page the first message creates a draft Project + this thread.

### Export *(new — lightweight/audit)*

`ownerId`, `architectureId`, `format` ('png' | 'pdf' | 'mermaid' | 'json'), `createdAt`. The artifact
itself is streamed to the user; only the audit record persists.

## Provider plugin model *(new — `lib/providers/`)*

```text
Provider (interface)
├── id: 'aws' | 'mongodb'
├── label, accent
├── catalog: ServiceDef[]                     # migrated from lib/catalog.ts
├── pricingAdapter.estimate(serviceId, config) # official pricing (R3), returns {cost, basis}
├── mcpAdapter.recommend(request)              # official MCP (R1/R2)
└── authAdapter.{ connect, refresh, revoke }   # SSO / Atlas key lifecycle (R4)
```

`registry.ts` maps id → Provider. Core (generation, pricing, catalog UI) iterates the registry;
**no provider name is hard-coded in core** (Constitution II). Adding Azure later = new `providers/azure/`
+ one registry entry.

## Validation rules (selected)

- Project `name` required, 1–120 chars; `status` transitions: draft→active→archived (archive reversible).
- Architecture save rejected if incoming `version` ≠ stored `version` (409 conflict, R9).
- Connection AWS session must have future `sessionExpiresAt` to be `connected`; expired → actions blocked.
- Every cost display MUST include `basis`; missing price ⇒ `basis: 'indicative'` and a visible marker.
- Role assignment obeys `canManageRole(actor, target)` (built RBAC) — unchanged.
