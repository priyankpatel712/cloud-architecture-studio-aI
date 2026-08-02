/**
 * Provider plugin model (Constitution II, research R7).
 *
 * Each cloud provider is an independent plugin: catalog + pricing adapter + MCP
 * adapter + auth adapter behind this common interface. Core code iterates the
 * registry and never hard-codes a provider's services, regions, or pricing.
 *
 * This file is isomorphic (types + catalog shapes only). Server-only adapter
 * implementations live in `providers/<id>/` and are wired in `registry.ts`
 * (server-only) so client bundles never pull in SDKs.
 */

export type ProviderId = 'aws' | 'mongodb' | 'system';

export type FieldType = 'number' | 'select' | 'text';

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  default: string | number;
  options?: string[];
  min?: number;
  max?: number;
}

export interface ServiceDef {
  id: string;
  name: string;
  provider: ProviderId;
  category: string;
  /** lucide-react icon name (fallback when no official icon asset exists) */
  icon: string;
  /**
   * Official provider architecture icon, as a public asset URL
   * (e.g. '/icons/aws/aws-lambda.svg' — the official AWS Architecture Icon).
   * When set, the canvas/palette render it instead of the lucide fallback.
   */
  iconUrl?: string;
  /** brand accent used for the node chip */
  accent: string;
  blurb: string;
  fields: ConfigField[];
  /**
   * Which config key is this service's quantity dimension (e.g. 'count' for EC2).
   * Drives attach-duplicate merging and quantity cost-overrides (003 R3/R9);
   * absent = the service has no natural quantity and only supports a flat
   * total-cost override.
   */
  quantityField?: string;
  /** indicative monthly USD cost from a config record (labelled fallback — FR-021) */
  estimate: (c: Record<string, string | number>) => number;
}

export type ServiceConfig = Record<string, string | number>;

/**
 * Typed boundary container declared by a provider plugin (002 FR-005,
 * Constitution II). The canvas renders whatever types the registry exposes;
 * the generic 'group' type is core-provided, everything else lives here.
 */
export interface ContainerTypeDef {
  /** stable id stored on Container.type (e.g. 'vpc', 'region', 'cluster') */
  id: string;
  label: string;
  provider: ProviderId;
  /** border/badge accent for rendering */
  accent: string;
  /** official group/boundary icon asset URL (AWS Architecture Icons group set) */
  iconUrl?: string;
  blurb: string;
}

export type CostBasis = 'exact' | 'indicative';

export interface PriceQuote {
  monthly: number;
  basis: CostBasis;
  /** pricing region actually used (per-node region, USD — Clarification 2026-07-06) */
  region: string;
}

/** Official pricing source behind each provider (research R3). */
export interface PricingAdapter {
  estimate(serviceId: string, config: ServiceConfig, defaultRegion: string): Promise<PriceQuote>;
}

export interface McpRecommendation {
  serviceId: string;
  rationale: string;
  config?: ServiceConfig;
}

export interface McpRecommendResult {
  recommendations: McpRecommendation[];
  guidance: Partial<Record<'network' | 'security' | 'ha' | 'dr' | 'scaling', string>>;
  /** raw text returned by the official MCP — the orchestrator structures it */
  rawText?: string;
  /** which official MCP tools were invoked (recorded on the chat message) */
  toolsInvoked: string[];
  /** true when the official MCP answered; false = labelled indicative degraded mode */
  official: boolean;
}

/** Official MCP source for architecture recommendations (research R1/R2). */
export interface McpAdapter {
  recommend(request: string, context: string): Promise<McpRecommendResult>;
}

export interface ProviderPlugin {
  id: ProviderId;
  label: string;
  accent: string;
  icon: string;
  catalog: ServiceDef[];
  /** typed boundary containers this provider contributes (002 FR-005) */
  containerTypes: ContainerTypeDef[];
  pricing: PricingAdapter;
  mcp: McpAdapter;
  /**
   * 008 FR-038 — best-practice rules this provider contributes to the knowledge
   * store. Declared here (not in core) so adding a provider never requires
   * editing shared generation logic — constitution Principle II.
   */
  rules: import('@/lib/knowledge/types').KnowledgeSeed[];
}

export class McpUnavailableError extends Error {
  constructor(public provider: ProviderId, message: string) {
    super(message);
  }
}
