# Contract: AI Usage & Per-Role Model Settings

**Feature**: `008-multi-agent-knowledge-pipeline` | **Serves**: FR-010, FR-014, FR-016, FR-031, FR-033

Extends the existing `/api/settings/llm` surface. All endpoints are Node-runtime route handlers. Credentials never cross the wire in either direction beyond the existing write-only key field (constitution III).

---

## `GET /api/settings/llm/usage` *(new)*

Real per-connection usage, replacing the hardcoded mock figures currently rendered in Settings → Plan & Billing.

**Auth**: verified session required. Aggregate figures are visible to any verified user; per-role breakdown requires `settings:manage`.

**Query**: `window` — `24h` | `7d` | `30d` (default `30d`)

**200 response**
```json
{
  "window": "30d",
  "totals": { "requests": 1284, "promptTokens": 2841203, "completionTokens": 391044 },
  "byConnection": [
    {
      "provider": "nvidia",
      "model": "nvidia/llama-3.3-nemotron-super-49b-v1",
      "requests": 812,
      "promptTokens": 2103882,
      "completionTokens": 288130,
      "rateLimited": 4,
      "errors": 1,
      "meanLatencyMs": 4210
    }
  ],
  "byRole": [
    { "role": "plan", "requests": 402, "tier": "large" },
    { "role": "route", "requests": 210, "tier": "small" }
  ],
  "smallMidShare": 0.62
}
```

**Notes**
- `byRole` is omitted for users without `settings:manage`.
- `smallMidShare` is the fraction of requests served by small or mid tiers — the direct measurement for **SC-004**.
- Sourced entirely from `LlmUsage`; an empty collection returns zeroed totals, never an error.
- Contains counts and metadata only — no prompt or completion content is ever stored or returned.

---

## `PUT /api/settings/llm` *(extended)*

The existing endpoint gains an optional `roleModels` field. All current fields and semantics are unchanged.

**Auth**: `settings:manage` (unchanged).

**Request (new field only)**
```json
{
  "roleModels": {
    "route":  "groq/llama-3.1-8b-instant",
    "intent": "groq/llama-3.1-8b-instant",
    "plan":   "nvidia/nvidia/llama-3.3-nemotron-super-49b-v1"
  }
}
```

Each value is a single `"<provider>/<model>"` string rather than an object. Model ids
contain slashes of their own, so the split is on the FIRST slash only — everything
after it is the model. A string keeps the `<option value>` of the settings dropdown
identical to what is stored, with no assembly step to get wrong.

**Validation**
- Role keys must be members of the `LlmRole` union; unknown keys are rejected.
- The provider segment must be a known catalog provider; the model segment is a free
  string (live model lists change faster than the catalog). A value that does not
  parse is ignored at resolution time and the role falls back to its tier default.
- A role may be omitted, or sent empty, to clear the override and fall back to
  defaults (FR-015).
- An override names a connection only — **credentials continue to resolve from `encryptedKeys`/env**. No new secret storage is introduced.

**Response**: the existing settings view shape plus `roleModels`. Key material is never returned.

---

## `GET /api/settings/llm` *(extended)*

Adds to the existing response:

```json
{
  "roleTieringEnabled": true,
  "roleModels": { "route": "groq/llama-3.1-8b-instant" },
  "roleDefaults": [
    { "role": "route", "tier": "small", "resolved": { "provider": "groq",   "model": "llama-3.1-8b-instant" }, "overridden": true },
    { "role": "plan",  "tier": "large", "resolved": { "provider": "nvidia", "model": "nvidia/llama-3.3-nemotron-super-49b-v1" }, "overridden": false }
  ]
}
```

`roleDefaults` covers every role, in `LLM_ROLES` order, and `resolved` shows what each
one *would* use given current credentials, overrides and the tiering toggle — so an
operator can verify tiering without running a generation. `resolved` is `null` when no
connection is configured at all; `overridden` says whether the operator pinned it.

It is produced by `previewRoleResolution()` in `lib/llm.ts`, which calls the same
`selectRoleChain` the live path calls. The one deliberate difference is that the
short-term per-provider load reordering (`applyProviderBudget`) is **not** applied,
so the same configuration previews identically minute to minute.

`roleTieringEnabled` is `null` when never configured, which resolves to **off**. There
is no environment fallback: the toggle in Settings → AI Provider is the only switch.

---

## Error Semantics

Unchanged from the existing settings surface: `401` unauthenticated, `403` lacking `settings:manage`, `422` validation failure with field detail, `500` with a generic message and server-side detail logging. Provider error bodies are never forwarded to the client.
