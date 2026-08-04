# Contract: Standalone Cost Estimate Export (FR-016)

Extends `specs/001-mvp-baseline/contracts/export.md` — same endpoint
(`GET /api/projects/[id]/export?format=...`), one new format value.

## `GET /api/projects/[id]/export?format=estimate`

Server-serialized (like `mermaid`/`json` today — not client-rendered-from-canvas like `png`/`pdf`).
Reads the latest `CostEstimate` snapshot and current `CostEstimateOverride`s; **never reads
`Architecture`** (research R6 — a cost export must not require or embed diagram data, per FR-016 and
Edge Case "exporting the estimate while a line item is flagged as possibly outdated").

→
```
{
  filename: "<project-name>-estimate.json",
  mimeType: "application/json",
  content: {
    projectName: string,
    generatedAt: string,        // ISO timestamp
    monthly: number,
    annual: number,
    lineItems: [
      {
        serviceId: string,
        displayName: string,    // falls back to catalog service name
        cost: number,
        basis: 'exact' | 'indicative',
        overridden: boolean,
        overrideSource?: 'inline' | 'chat',
        stale: boolean,         // FR-012 — surfaced to the export's recipient too
      }
    ]
  }
}
```

The existing client PDF-rendering path (used today for `png`/`pdf`) can render this JSON into a
client-facing document exactly as it renders the canvas today, but from this cost-only payload — no
new rendering subsystem. Every export continues to be audited via the existing `ExportRecord` model,
same as `mermaid`/`json`/`png`/`pdf` today.

**Acceptance mapping**: User Story 4/AC1–3, FR-016, SC-007.
