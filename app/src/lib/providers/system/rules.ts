import type { KnowledgeSeed } from '@/lib/knowledge/types';

/**
 * Provider-neutral system-design rules for HLD and LLD modes (feature 008 US3,
 * FR-018/FR-038). Migrated out of the hardcoded DESIGN_PRINCIPLES brief in
 * system/mcp.ts so they become editable data rather than a code constant, and
 * so they are graded by the reviewer like every other stored rule.
 *
 * `designMode` scopes each rule: an HLD diagram must not sprout vendor services,
 * and an LLD diagram must not stay at system-boundary altitude.
 */
export const SYSTEM_RULES: KnowledgeSeed[] = [
  {
    title: 'HLD stays vendor-neutral',
    content:
      'A high-level design (C4 levels 1-2) uses system boundaries, containers, and tiers — clients, edge, services, data, messaging. It never names a specific cloud vendor product.',
    keywords: ['hld', 'high level', 'system design', 'c4', 'context', 'container', 'tier'],
    designMode: 'hld',
  },
  {
    title: 'HLD shows the request path end to end',
    content:
      'A high-level design shows the full request path from client through edge and service tiers to data, with labelled directional edges, so the flow can be read without explanation.',
    keywords: ['hld', 'flow', 'request path', 'client', 'edge', 'service', 'data'],
    designMode: 'hld',
  },
  {
    title: 'LLD works at component altitude',
    content:
      'A low-level design (C4 level 3) shows components, modules, and packages with dependency edges, grouped by module boundary — not infrastructure.',
    keywords: ['lld', 'low level', 'component', 'module', 'package', 'class', 'dependency'],
    designMode: 'lld',
  },
  {
    title: 'LLD groups by responsibility',
    content:
      'Group low-level components by responsibility (controller, service, repository, model) so the layering is visible, and point dependency edges in one direction per layer.',
    keywords: ['lld', 'layer', 'controller', 'service', 'repository', 'model', 'responsibility'],
    designMode: 'lld',
  },
];
