import type { ServiceDef } from '@/lib/providers/types';

/**
 * Generic system-design catalog (provider 'system') — the vocabulary pack for
 * provider-neutral HIGH-LEVEL design (HLD: C4 Level 1/2 + system-design-interview
 * component set) and LOW-LEVEL design (LLD: C4 Level 3 component/package
 * vocabulary) diagrams. Research grounding: c4model.com (context/container/
 * component abstractions, "every element gets a description, every container a
 * technology tag"), donnemartin/system-design-primer and ByteByteGo's component
 * taxonomy.
 *
 * None of these carry a price: generic components have no SKU, so `estimate`
 * is 0 and the system pricing adapter quotes $0 'exact' (definitional, not an
 * estimate) — the UI omits the price badge for system nodes entirely.
 *
 * The `tech` field is the C4 technology tag ("Node.js", "PostgreSQL", "Kafka");
 * the canvas shows it via the config inspector like any other field.
 */

export const SYSTEM_ACCENT = '#6366F1';

/** Category accents — one hue per palette group so HLD diagrams read in layers. */
export const SYSTEM_CATEGORY_ACCENTS: Record<string, string> = {
  Clients: '#0EA5E9',
  'Edge & Delivery': '#8B5CF6',
  Application: '#F97316',
  Data: '#10B981',
  'Messaging & Streaming': '#E7157B',
  Platform: '#64748B',
  'Low-Level Design': '#6366F1',
};

const tech = (placeholder: string) => ({ key: 'tech', label: 'Technology', type: 'text' as const, default: placeholder });
const zero = () => 0;

function svc(
  id: string,
  name: string,
  category: keyof typeof SYSTEM_CATEGORY_ACCENTS,
  icon: string,
  blurb: string,
  opts?: { fields?: ServiceDef['fields']; quantityField?: string }
): ServiceDef {
  return {
    id,
    name,
    provider: 'system',
    category,
    icon,
    accent: SYSTEM_CATEGORY_ACCENTS[category] ?? SYSTEM_ACCENT,
    blurb,
    fields: opts?.fields ?? [tech('')],
    ...(opts?.quantityField ? { quantityField: opts.quantityField } : {}),
    estimate: zero,
  };
}

/** Typed boundary containers for generic designs (system boundary / tier / package). */
export const SYSTEM_CONTAINER_TYPES = [
  {
    id: 'system-boundary',
    label: 'System Boundary',
    provider: 'system' as const,
    accent: '#475569',
    blurb: 'Boundary separating YOUR system from its users and external systems (C4 context/container convention).',
  },
  {
    id: 'tier',
    label: 'Tier / Layer',
    provider: 'system' as const,
    accent: '#0EA5E9',
    blurb: 'Architecture tier: Client, Edge, Application, or Data in HLD; Controller, Service, or Data layer in LLD.',
  },
  {
    id: 'package',
    label: 'Package / Module',
    provider: 'system' as const,
    accent: '#6366F1',
    blurb: 'Code-level package/module boundary grouping related components (LLD).',
  },
];

export const SYSTEM_SERVICES: ServiceDef[] = [
  // ---- Clients (HLD) --------------------------------------------------------
  svc('sys-user', 'User / Actor', 'Clients', 'User', 'A person or role interacting with the system (C4 person).'),
  svc('sys-web-client', 'Web Client', 'Clients', 'Globe', 'Browser single-page or server-rendered web app.', { fields: [tech('React SPA')] }),
  svc('sys-mobile-client', 'Mobile Client', 'Clients', 'Smartphone', 'iOS/Android mobile application.', { fields: [tech('iOS/Android')] }),
  svc('sys-desktop-client', 'Desktop Client', 'Clients', 'Monitor', 'Installed desktop application.', { fields: [tech('')] }),

  // ---- Edge & Delivery (HLD) -----------------------------------------------
  svc('sys-dns', 'DNS', 'Edge & Delivery', 'Route', 'Domain name resolution routing users to the nearest entry point.'),
  svc('sys-cdn', 'CDN', 'Edge & Delivery', 'Cloudy', 'Edge cache for static assets and cacheable responses.'),
  svc('sys-load-balancer', 'Load Balancer', 'Edge & Delivery', 'Scale', 'Distributes traffic across service instances (L4/L7).', { fields: [tech('L7')] }),
  svc('sys-api-gateway', 'API Gateway', 'Edge & Delivery', 'Waypoints', 'Single entry point: routing, auth offload, throttling.'),
  svc('sys-rate-limiter', 'Rate Limiter', 'Edge & Delivery', 'Gauge', 'Protects downstream services from overload/abuse.'),
  svc('sys-firewall', 'WAF / Firewall', 'Edge & Delivery', 'Shield', 'Filters malicious traffic before it reaches the system.'),

  // ---- Application (HLD) ----------------------------------------------------
  svc('sys-service', 'Service', 'Application', 'Server', 'A microservice owning one business capability.', {
    fields: [tech(''), { key: 'instances', label: 'Instances', type: 'number', default: 1, min: 1 }],
    quantityField: 'instances',
  }),
  svc('sys-monolith', 'Monolith', 'Application', 'Building2', 'Single deployable application containing all business logic.', { fields: [tech('')] }),
  svc('sys-worker', 'Worker', 'Application', 'Cog', 'Background job processor consuming from a queue.', {
    fields: [tech(''), { key: 'instances', label: 'Instances', type: 'number', default: 1, min: 1 }],
    quantityField: 'instances',
  }),
  svc('sys-scheduler', 'Scheduler / Cron', 'Application', 'Clock', 'Time-triggered jobs (batch, cleanup, reports).'),
  svc('sys-websocket', 'WebSocket Server', 'Application', 'Radio', 'Persistent bidirectional connections for realtime features.'),
  svc('sys-function', 'Serverless Function', 'Application', 'Zap', 'Event-triggered stateless compute.'),
  svc('sys-ml-inference', 'ML Inference', 'Application', 'Brain', 'Model-serving endpoint for predictions/embeddings.', { fields: [tech('')] }),

  // ---- Data (HLD) -----------------------------------------------------------
  svc('sys-relational-db', 'Relational DB', 'Data', 'Database', 'ACID relational database (primary + replicas).', { fields: [tech('PostgreSQL')] }),
  svc('sys-nosql-db', 'NoSQL DB', 'Data', 'DatabaseZap', 'Document/key-value/wide-column store for flexible or high-scale data.', { fields: [tech('')] }),
  svc('sys-cache', 'Cache', 'Data', 'MemoryStick', 'In-memory cache for hot reads and sessions.', { fields: [tech('Redis')] }),
  svc('sys-blob-storage', 'Blob Storage', 'Data', 'HardDrive', 'Object store for files, images, and backups.'),
  svc('sys-search', 'Search Engine', 'Data', 'Search', 'Full-text/faceted search index.', { fields: [tech('Elasticsearch')] }),
  svc('sys-warehouse', 'Data Warehouse', 'Data', 'BarChart3', 'Analytical store for reporting and BI.', { fields: [tech('')] }),

  // ---- Messaging & Streaming (HLD) -----------------------------------------
  svc('sys-message-queue', 'Message Queue', 'Messaging & Streaming', 'ListOrdered', 'Point-to-point async work queue decoupling producers from consumers.', { fields: [tech('')] }),
  svc('sys-pub-sub', 'Pub/Sub', 'Messaging & Streaming', 'RadioTower', 'Fan-out topic delivering events to many subscribers.'),
  svc('sys-stream-processor', 'Stream Processor', 'Messaging & Streaming', 'Waves', 'Continuous event-stream processing/aggregation.', { fields: [tech('Kafka + Flink')] }),

  // ---- Platform / cross-cutting (HLD) --------------------------------------
  svc('sys-auth', 'Auth / Identity', 'Platform', 'KeyRound', 'Authentication and authorization (sessions, tokens, SSO).'),
  svc('sys-external-api', 'External API', 'Platform', 'Plug', 'Third-party system outside your boundary (payments, email, maps).'),
  svc('sys-monitoring', 'Monitoring', 'Platform', 'Activity', 'Metrics, logs, traces, and alerting.'),

  // ---- Low-Level Design (LLD: C4 component / package vocabulary) -----------
  svc('sys-module', 'Module / Package', 'Low-Level Design', 'Package', 'A cohesive group of related components (package/namespace).'),
  svc('sys-component', 'Component', 'Low-Level Design', 'Puzzle', 'A code component with one responsibility (C4 Level 3).'),
  svc('sys-controller', 'Controller / Handler', 'Low-Level Design', 'Inbox', 'Receives requests, validates input, delegates to services.'),
  svc('sys-endpoint', 'API Endpoint', 'Low-Level Design', 'Link', 'A single exposed route/operation (method + path).'),
  svc('sys-service-class', 'Service (class)', 'Low-Level Design', 'Braces', 'Domain/application service holding business logic.'),
  svc('sys-repository', 'Repository / DAO', 'Low-Level Design', 'Archive', 'Data-access component isolating persistence.'),
  svc('sys-entity', 'Entity / Model', 'Low-Level Design', 'Shapes', 'Domain entity or persistence model.'),
  svc('sys-dto', 'DTO', 'Low-Level Design', 'FileJson', 'Data-transfer object crossing a boundary.'),
  svc('sys-interface', 'Interface', 'Low-Level Design', 'Split', 'Contract implemented by one or more components.'),
  svc('sys-class', 'Class', 'Low-Level Design', 'Code', 'Generic class when no more specific component type fits.'),
  svc('sys-event-handler', 'Event Handler', 'Low-Level Design', 'BellRing', 'Consumer reacting to a domain/integration event.'),
  svc('sys-db-table', 'DB Table', 'Low-Level Design', 'Table', 'A database table/collection a component reads or writes.'),
  svc('sys-library', 'External Dependency', 'Low-Level Design', 'Package2', 'Third-party library/SDK the code depends on.'),
];
