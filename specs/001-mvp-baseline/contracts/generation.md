# Contract: Conversational Architecture Generation (FR-014, FR-014a–d, FR-015, FR-016a)

Generation is a **persistent per-project chat**. One `AIConversation` thread exists per project;
the chat panel is mounted on the project-creation page and beside the studio canvas in every
project. The backend LLM orchestrator (R11) invokes only the provider MCP adapters for the tools
attached to each message; the official MCPs — not the LLM — are the authority for service
selection, and pricing flows through the pricing adapters (see [pricing.md](./pricing.md)).

## `POST /api/chat/start`

Creation-page bootstrap: creates a draft Project plus its conversation thread.
Body: `{ name? }` (defaults to a generated draft name).
→ `201 { projectId, conversation }`.

## `GET /api/projects/[id]/chat`

Resume the project's thread (owner or `sharedWith` read). → `200 { conversation }` where
`conversation = { status, messages: [{ role, text, attachedTools, mcpCalls, editsApplied, createdAt }] }`.
A project with no thread yet returns an empty `messages` list.

## `POST /api/projects/[id]/chat/messages`

Owner-only. Append a user message and run the orchestrator.
Body: `{ text, attachedTools: ('aws'|'mongodb')[] }`.

Behavior:

- **No tool attached** → `200` with an assistant message asking the user to attach at least one
  provider tool; no MCP calls, no architecture change (FR-014a; US2/AC3).
- Invokes **only the attached providers'** `mcpAdapter.recommend(...)` for service selection +
  Well-Architected guidance (FR-014b/c, FR-015).
- Applies the result to the project's **current architecture in place** — follow-up messages
  update, never restart (FR-014d; US2/AC5). Prices affected nodes via the pricing adapters and
  refreshes the estimate (US2/AC1).
- Appends an assistant message recording `mcpCalls` and `editsApplied`; persists the updated
  `Architecture` (bumping `version`) and the thread.
- **Per-provider MCP failure** → `200` partial: the assistant message names the failed provider,
  keeps results from the available ones, and offers retry (`mcpCalls[].status: 'failed'`) — the
  chat never fails wholesale (spec edge case).
- **Unsatisfiable request** (unsupported provider, contradictory constraints) → `422
  { error, partial? }` with guidance and any partial result (spec edge case; US2/AC6 progress +
  30s target per SC-001).

→ `200 { message, architecture: { nodes, edges, guidance, version }, estimate }`

## Direct-edit context sync (FR-016a; US2/AC4)

`PUT /api/projects/[id]/architecture` (see [projects.md](./projects.md)) appends a `system`
message to the thread summarizing the edit, so subsequent chat messages build on the edited
architecture. If a direct edit lands while a generation is in flight, the **latest completed
change wins** and the reconciled architecture is returned to both surfaces (spec edge case).

**Acceptance mapping**: US2/AC1–6, FR-014, FR-014a–d, FR-015, FR-016a; edge cases "no tool
attached", "MCP unavailable", "unsatisfiable request", "edit vs pending generation".
No per-user rate limits in the MVP (clarified 2026-07-06).
