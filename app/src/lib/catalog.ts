/**
 * Client-safe catalog compatibility surface (001 T005).
 *
 * The per-provider catalogs now live in the provider plugins
 * (`lib/providers/aws/catalog.ts`, `lib/providers/mongodb/catalog.ts` — Constitution II);
 * this module re-exports the combined view so existing studio imports keep working.
 * Server-only adapters (pricing, MCP) are wired in `lib/providers/registry.ts` —
 * never import that from client components.
 *
 * `estimate()` values remain clearly-labelled indicative fallbacks (FR-021); live
 * figures come from `POST /api/pricing/estimate`.
 */

import { AWS_SERVICES, AWS_CONTAINER_TYPES } from '@/lib/providers/aws/catalog';
import { AWS_EXTENDED_SERVICES } from '@/lib/providers/aws/catalog-extended';
import { MONGODB_SERVICES, MONGODB_CONTAINER_TYPES } from '@/lib/providers/mongodb/catalog';
import { SYSTEM_SERVICES, SYSTEM_CONTAINER_TYPES, SYSTEM_ACCENT, SYSTEM_CATEGORY_ACCENTS } from '@/lib/providers/system/catalog';
import { officialAwsIcon } from '@/lib/providers/aws/icons';
import type { ContainerTypeDef, ProviderId, ServiceDef, ServiceConfig } from '@/lib/providers/types';

export type { FieldType, ConfigField, ServiceDef, ContainerTypeDef } from '@/lib/providers/types';
export type Provider = ProviderId;

/**
 * Curated services (config fields + cost models) first, then the extended AWS
 * set — every remaining official Architecture Icon as a draggable service.
 * The extended set is palette/canvas only: the server registry (and therefore
 * every LLM prompt) still sees just the curated catalogs.
 */
export const SERVICES: ServiceDef[] = [...AWS_SERVICES, ...AWS_EXTENDED_SERVICES, ...MONGODB_SERVICES, ...SYSTEM_SERVICES];

/**
 * Container types the canvas can draw (002 FR-005): the core generic group plus
 * every provider-declared boundary type (Constitution II — read from the plugins,
 * never hard-coded in canvas code). `provider: null` marks the core type.
 */
export const CONTAINER_TYPES: (Omit<ContainerTypeDef, 'provider'> & { provider: ProviderId | null })[] = [
  { id: 'group', label: 'Group', provider: null, accent: '#5f6368', blurb: 'Generic grouping boundary.' },
  ...AWS_CONTAINER_TYPES,
  ...MONGODB_CONTAINER_TYPES,
  ...SYSTEM_CONTAINER_TYPES,
];

export function containerTypeById(id: string) {
  return CONTAINER_TYPES.find((t) => t.id === id);
}

export const PROVIDERS: Record<Provider, { label: string; accent: string; icon: string }> = {
  aws: { label: 'AWS', accent: '#FF9900', icon: 'Cloud' },
  mongodb: { label: 'MongoDB Atlas', accent: '#00ED64', icon: 'Leaf' },
  system: { label: 'System Design', accent: SYSTEM_ACCENT, icon: 'DraftingCompass' },
};

export function serviceById(id: string) {
  return SERVICES.find((s) => s.id === id);
}

/** Official AWS Architecture Icons category palette (fallback for dynamic services). */
export const CATEGORY_ACCENTS: Record<string, string> = {
  Compute: '#ED7100',
  Containers: '#ED7100',
  Networking: '#8C4FFF',
  Analytics: '#8C4FFF',
  Database: '#C925D1',
  Storage: '#7AA116',
  IoT: '#7AA116',
  Security: '#DD344C',
  'App Integration': '#E7157B',
  Management: '#E7157B',
  'Machine Learning': '#01A88D',
  // Extended-catalog categories (official icon-set palette).
  'Developer Tools': '#C925D1',
  Migration: '#01A88D',
  Media: '#ED7100',
  'Business Apps': '#DD344C',
  'Front-End & Mobile': '#DD344C',
  'End User Computing': '#01A88D',
  'Cost Management': '#7AA116',
  Healthcare: '#01A88D',
  Games: '#8C4FFF',
  Quantum: '#ED7100',
  Blockchain: '#ED7100',
  Satellite: '#C925D1',
  'Support & Enablement': '#C925D1',
};

/** Provider inferred from a dynamic serviceId slug ('aws-route53' → 'aws'). */
export function providerFromSlug(serviceId: string): Provider | null {
  if (serviceId.startsWith('aws-')) return 'aws';
  if (serviceId.startsWith('atlas-') || serviceId.startsWith('mongodb-')) return 'mongodb';
  if (serviceId.startsWith('sys-') || serviceId.startsWith('system-')) return 'system';
  return null;
}

export interface DynamicServiceMeta {
  displayName?: string;
  category?: string;
  provider?: Provider;
}

/**
 * Resolve a serviceId to a ServiceDef — the curated catalog entry when one
 * exists, else a SYNTHESIZED definition for an AI-added dynamic service
 * (follow-up to 003: the catalog no longer bounds what the AI can design).
 * Dynamic services carry their indicative monthly price in config.monthlyCost
 * (an editable field), render the official AWS icon when the name matches the
 * official icon set, and take the official category color as accent.
 */
export function resolveServiceDef(serviceId: string, meta?: DynamicServiceMeta): ServiceDef {
  const curated = serviceById(serviceId);
  if (curated) return curated;
  const provider = meta?.provider ?? providerFromSlug(serviceId) ?? 'aws';
  const name =
    meta?.displayName ||
    serviceId
      .replace(/^(aws|atlas|mongodb|sys|system)-/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  const category = meta?.category || 'Other';
  // Dynamic generic components: no vendor icon set — a neutral glyph on the
  // system accent (or its category accent), and no cost field (not priced).
  if (provider === 'system') {
    return {
      id: serviceId,
      name,
      provider,
      category,
      icon: 'Box',
      accent: SYSTEM_CATEGORY_ACCENTS[category] ?? SYSTEM_ACCENT,
      blurb: 'AI-added design component (not priced).',
      fields: [{ key: 'tech', label: 'Technology', type: 'text', default: '' }],
      estimate: () => 0,
    };
  }
  const icon = provider === 'mongodb' ? { url: undefined, color: PROVIDERS.mongodb.accent } : lookupAwsIcon(name, serviceId);
  return {
    id: serviceId,
    name,
    provider,
    category,
    icon: provider === 'mongodb' ? 'Leaf' : 'Box',
    iconUrl: icon.url,
    accent: icon.color ?? CATEGORY_ACCENTS[category] ?? PROVIDERS[provider].accent,
    blurb: 'AI-added service (indicative pricing — edit the monthly cost).',
    fields: [{ key: 'monthlyCost', label: 'Est. monthly cost', type: 'number', unit: 'USD', default: 0 }],
    estimate: (c) => {
      const v = c.monthlyCost;
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
      return Number.isFinite(n) ? n : 0;
    },
  };
}

function lookupAwsIcon(name: string, serviceId: string): { url?: string; color?: string } {
  const hit = officialAwsIcon(name) ?? officialAwsIcon(serviceId);
  return hit ? { url: hit.url, color: hit.color } : {};
}

export function defaultConfig(s: ServiceDef): Record<string, string | number> {
  return Object.fromEntries(s.fields.map((f) => [f.key, f.default]));
}

/**
 * A field's declared `min`/`max` win when set; a `unit: 'M'` field (already
 * denominated in millions/mo) additionally gets a generous default ceiling —
 * catches an AI-planned value that is actually a raw request count mistakenly
 * placed in a millions field (e.g. 1_000_000 meant as 1,000,000 requests, read
 * back as 1,000,000 million/mo) before it inflates the cost estimate 1e6x.
 * Cost realism for MVP-scale architectures (Clarification 2026-07-09).
 */
const MILLIONS_FIELD_CEILING = 10_000;

export function clampToFieldBounds(def: ServiceDef, config: ServiceConfig): ServiceConfig {
  const out = { ...config };
  for (const f of def.fields) {
    if (f.type !== 'number') continue;
    const raw = out[f.key];
    if (raw === undefined) continue;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n)) continue;
    const min = f.min ?? 0;
    const max = f.max ?? (f.unit === 'M' ? MILLIONS_FIELD_CEILING : Infinity);
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== n) out[f.key] = String(clamped);
  }
  return out;
}

export function formatUSD(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 });
}

/** Group services by category, preserving catalog order. */
export function servicesByProvider(provider: Provider) {
  const groups = new Map<string, ServiceDef[]>();
  for (const s of SERVICES.filter((x) => x.provider === provider)) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category)!.push(s);
  }
  return groups;
}
