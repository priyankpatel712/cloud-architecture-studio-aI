# Contract: Knowledge Store Administration

**Feature**: `008-multi-agent-knowledge-pipeline` | **Serves**: FR-032, FR-033, and US3 acceptance scenario 4

Lets an administrator review, edit, disable, and delete stored knowledge — including lessons the system taught itself — without a code deployment. All handlers are server-side under existing RBAC (constitution III).

---

## `GET /api/settings/knowledge`

**Auth**: verified session; `settings:manage` required for the mutating verbs below. Read is permitted for any verified user so the trace's "consulted knowledge" references can be inspected.

**Query**
| Param | Values | Default |
|---|---|---|
| `provider` | `aws \| mongodb \| system \| any` | all |
| `kind` | `rule \| pattern \| guidance \| lesson \| service-note` | all |
| `source` | `seed \| mcp \| web \| learned` | all |
| `enabled` | `true \| false` | all |
| `limit` | 1–100 | 50 |

**200 response**
```json
{
  "entries": [
    {
      "id": "…",
      "kind": "rule",
      "provider": "aws",
      "designMode": "cloud",
      "title": "Databases stay in private subnets",
      "content": "Databases and caches live in private subnets and are never internet-exposed.",
      "keywords": ["database", "rds", "private", "subnet"],
      "source": "seed",
      "confidence": 1,
      "usageCount": 142,
      "lastUsedAt": "2026-07-30T09:14:00.000Z",
      "enabled": true
    }
  ],
  "total": 23
}
```

---

## `PATCH /api/settings/knowledge/:id`

**Auth**: `settings:manage`.

Editable: `title`, `content` (≤600 chars), `keywords`, `designMode`, `enabled`.

Immutable: `source`, `hash`, `usageCount`, `lastUsedAt`. Editing `content` recomputes `hash`; if the new hash collides with an existing entry the request fails **409** rather than silently merging two rules.

**Effect**: takes hold on the next generation with no redeploy (FR-032, US3 AS-4). Setting `enabled: false` retains the entry but excludes it from all retrieval.

---

## `DELETE /api/settings/knowledge/:id`

**Auth**: `settings:manage`.

Hard delete. Deleting a `seed` entry is permitted but it will be **restored by the next seeding run** — the response includes `"willReseed": true` so the UI can warn that disabling is the durable choice for seeded rules.

---

## `POST /api/settings/knowledge/reseed`

**Auth**: `settings:manage`.

Re-runs seeding from the provider rule modules and core rules. Idempotent by content hash.

```json
{ "created": 3, "updated": 17, "pruned": 0 }
```

Optional body `{ "prune": true }` also removes entries with `confidence < 0.5` or unused for 60+ days.

---

## Error Semantics

`401` unauthenticated · `403` lacking `settings:manage` · `404` unknown id · `409` hash collision on edit · `422` validation failure (content >600 chars, empty keywords, unknown enum) · `500` generic message with server-side logging.

---

## Non-Goals

- No creation endpoint. Entries originate from seeding, provider integrations, web research, or distillation — hand-authored one-offs would bypass the provenance and confidence model.
- No bulk import/export in this feature.
- Provider-specific rules are **not** authored here; they live in `providers/<id>/rules.ts` under version control (FR-038, constitution II). This surface manages the *stored* copy and can disable an entry, but the durable source of a provider rule remains its plugin module.
