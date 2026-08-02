import 'server-only';
import type { ProviderId, ProviderPlugin } from '@/lib/providers/types';
import { AWS_SERVICES, AWS_CONTAINER_TYPES } from '@/lib/providers/aws/catalog';
import { MONGODB_SERVICES, MONGODB_CONTAINER_TYPES } from '@/lib/providers/mongodb/catalog';
import { awsPricing } from '@/lib/providers/aws/pricing';
import { mongodbPricing } from '@/lib/providers/mongodb/pricing';
import { awsMcp } from '@/lib/providers/aws/mcp';
import { mongodbMcp } from '@/lib/providers/mongodb/mcp';
import { SYSTEM_SERVICES, SYSTEM_CONTAINER_TYPES, SYSTEM_ACCENT } from '@/lib/providers/system/catalog';
import { systemPricing } from '@/lib/providers/system/pricing';
import { systemMcp } from '@/lib/providers/system/mcp';
import { AWS_RULES } from '@/lib/providers/aws/rules';
import { MONGODB_RULES } from '@/lib/providers/mongodb/rules';
import { SYSTEM_RULES } from '@/lib/providers/system/rules';

/**
 * Provider plugin registry (Constitution II, research R7).
 * Core code (generation, pricing, connections) iterates this registry and never
 * hard-codes a provider. Adding a provider = a new `providers/<id>/` folder plus
 * one entry here. Server-only — client code uses `lib/catalog.ts`.
 */
const plugins: Record<ProviderId, ProviderPlugin> = {
  aws: {
    id: 'aws',
    label: 'AWS',
    accent: '#FF9900',
    icon: 'Cloud',
    catalog: AWS_SERVICES,
    containerTypes: AWS_CONTAINER_TYPES,
    pricing: awsPricing,
    mcp: awsMcp,
    rules: AWS_RULES,
  },
  mongodb: {
    id: 'mongodb',
    label: 'MongoDB Atlas',
    accent: '#00ED64',
    icon: 'Leaf',
    catalog: MONGODB_SERVICES,
    containerTypes: MONGODB_CONTAINER_TYPES,
    pricing: mongodbPricing,
    mcp: mongodbMcp,
    rules: MONGODB_RULES,
  },
  // Generic provider-neutral system design (HLD/LLD) — no vendor, no SKUs;
  // guidance comes from a built-in design-principles brief instead of a live MCP.
  system: {
    id: 'system',
    label: 'System Design',
    accent: SYSTEM_ACCENT,
    icon: 'DraftingCompass',
    catalog: SYSTEM_SERVICES,
    containerTypes: SYSTEM_CONTAINER_TYPES,
    pricing: systemPricing,
    mcp: systemMcp,
    rules: SYSTEM_RULES,
  },
};

/** All container types across plugins plus the core generic 'group' (002 FR-005). */
export function allContainerTypes() {
  return Object.values(plugins).flatMap((p) => p.containerTypes);
}

export function getProvider(id: ProviderId): ProviderPlugin {
  return plugins[id];
}

export function allProviders(): ProviderPlugin[] {
  return Object.values(plugins);
}

/**
 * 008 FR-038 — every provider's rules, tagged with the provider that owns them.
 * The seeding script walks this instead of a core list, so a new provider's
 * rules ship with its plugin.
 */
export function allProviderRules(): { provider: ProviderId; seed: import('@/lib/knowledge/types').KnowledgeSeed }[] {
  return Object.values(plugins).flatMap((p) => p.rules.map((seed) => ({ provider: p.id, seed })));
}
