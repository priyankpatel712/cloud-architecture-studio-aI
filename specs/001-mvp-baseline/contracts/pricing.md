# Contract: Live Pricing (FR-019, FR-020, FR-021)

Pricing is computed server-side by the per-provider pricing adapters (AWS: official AWS cost MCP,
with the AWS Price List API as approved direct fallback per constitution v1.1.0; Atlas pricing).
Every returned figure includes a `basis`: `'exact'` (from official source) or `'indicative'` (fallback,
must be visibly marked in the UI — FR-021).

## `POST /api/pricing/estimate`
Body: `{ nodes: [{ serviceId, provider, config }] }`.
→ `200 { monthly, annual, perService: [{ serviceId, cost, basis }], basis }`
where top-level `basis` is `'exact'` only if all services priced exactly, else `'indicative'`.

Notes:
- Results are cached briefly per (serviceId, config) to stay within latency and rate limits.
- Client updates a single node's config → may call this with just that node for instant feedback
  (FR-020), then reconcile the total.
- Target accuracy: within ±5% of official pricing for the same configuration (SC-002).

**Acceptance mapping**: US3/AC3, FR-019–021; "pricing unavailable" edge case.
