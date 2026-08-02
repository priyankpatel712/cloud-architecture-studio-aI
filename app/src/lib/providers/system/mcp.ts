import 'server-only';
import type { McpAdapter } from '@/lib/providers/types';
import { SYSTEM_RULES } from '@/lib/providers/system/rules';

/**
 * Guidance adapter for the generic 'system' provider. There is no official
 * vendor MCP for provider-neutral system design, so this adapter serves a
 * curated, built-in design-principles brief (C4 model conventions + standard
 * system-design-interview structure) instead of a live tool call. It reports
 * official: true — the guidance is deterministic and source-grounded, and
 * generic components carry no pricing, so nothing here can present a cost as
 * more authoritative than it is.
 */

const DESIGN_PRINCIPLES = [
  'GENERIC SYSTEM-DESIGN PRINCIPLES (C4 model + system-design conventions):',
  '- Flow direction: arrange the request path left to right — Clients → Edge (DNS/CDN/LB/API',
  '  gateway) → Application services → Data stores. Async/background paths branch off via',
  '  queues or pub/sub to workers.',
  '- Every component gets a clear responsibility; every connection a label saying WHAT flows',
  '  and HOW (e.g. "REST/HTTPS", "publishes events · Kafka", "reads/writes · SQL").',
  '- HIGH-LEVEL DESIGN (HLD, C4 L1/L2): show deployable containers and data stores, not code.',
  '  Wrap the components you own in a System Boundary; keep users and third-party/external',
  '  APIs outside it. Group by tier (Client / Edge / Application / Data) when it aids reading.',
  '  Add a cache in front of hot read paths, a queue between producers and slow consumers,',
  '  and separate read/write paths when scale demands it.',
  '- LOW-LEVEL DESIGN (LLD, C4 L3): show components inside ONE container — controllers/',
  '  handlers delegating to service classes, services using repositories/DAOs, repositories',
  '  reading/writing DB tables, DTOs crossing boundaries, interfaces where substitution',
  '  matters. Group by layer (Controller / Service / Data) or by package. Dependencies point',
  '  inward: controller → service → repository → table; never the reverse.',
  '- Keep diagrams honest and small: only components that exist in the described design, no',
  '  decorative boxes, at most ~10-15 elements per diagram level.',
].join('\n');

/**
 * 008 FR-018/FR-038 — the same HLD/LLD rules that are seeded into the knowledge
 * store, appended to the built-in brief so this adapter and the store never
 * drift apart. `providers/system/rules.ts` is the single source: editing a rule
 * there changes both what is seeded and what this adapter serves.
 */
const SEEDED_RULES_BRIEF = SYSTEM_RULES.map((r) => `- ${r.content}`).join('\n');

export const systemMcp: McpAdapter = {
  async recommend() {
    return {
      recommendations: [],
      guidance: {},
      rawText: `${DESIGN_PRINCIPLES}\n${SEEDED_RULES_BRIEF}`,
      toolsInvoked: ['design-principles'],
      official: true,
    };
  },
};
