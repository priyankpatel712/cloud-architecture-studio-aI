import type { ServiceDef } from '@/lib/providers/types';

/**
 * MongoDB Atlas service catalog (migrated from lib/catalog.ts — 001 T005).
 * `estimate()` is the clearly-labelled indicative fallback (FR-021); the MongoDB
 * pricing adapter is the official-pricing source.
 */

const num = (v: string | number | undefined, fallback = 0) =>
  typeof v === 'number' ? v : v ? parseFloat(v) || fallback : fallback;

export const ATLAS_MONTHLY: Record<string, number> = {
  M0: 0,
  M10: 57,
  M20: 147,
  M30: 388,
  M40: 748,
  M50: 1_490,
};

export const MONGODB_ACCENT = '#00ED64';

/** Typed boundary containers MongoDB Atlas contributes to the canvas (002 FR-005). */
export const MONGODB_CONTAINER_TYPES = [
  { id: 'project', label: 'Atlas Project', provider: 'mongodb' as const, accent: '#001E2B', blurb: 'Outermost Atlas project boundary — maps 1:1 to a peered VPC; wraps every Atlas resource.' },
  { id: 'cluster', label: 'Atlas Cluster', provider: 'mongodb' as const, accent: '#00b34a', blurb: 'Atlas cluster boundary grouping database resources.' },
];

export const MONGODB_SERVICES: ServiceDef[] = [
  {
    id: 'atlas-cluster',
    name: 'Atlas Cluster',
    provider: 'mongodb',
    category: 'Clusters',
    icon: 'Leaf',
    accent: MONGODB_ACCENT,
    blurb: 'Fully-managed MongoDB cluster',
    fields: [
      { key: 'tier', label: 'Cluster tier', type: 'select', default: 'M30', options: Object.keys(ATLAS_MONTHLY) },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: ['us-east-1', 'eu-west-1', 'ap-south-1'] },
      { key: 'nodes', label: 'Replica nodes', type: 'number', default: 3, min: 1 },
    ],
    estimate: (c) => (ATLAS_MONTHLY[String(c.tier)] ?? 388) * (num(c.nodes, 3) / 3),
  },
  {
    id: 'atlas-search',
    name: 'Atlas Search',
    provider: 'mongodb',
    category: 'Search',
    icon: 'Search',
    accent: MONGODB_ACCENT,
    blurb: 'Lucene full-text search on your data',
    fields: [{ key: 'indexes', label: 'Search indexes', type: 'number', default: 2 }],
    estimate: (c) => num(c.indexes, 2) * 30,
  },
  {
    id: 'atlas-vector',
    name: 'Vector Search',
    provider: 'mongodb',
    category: 'Vector Search',
    icon: 'Boxes',
    accent: MONGODB_ACCENT,
    blurb: 'Semantic search for AI applications',
    fields: [{ key: 'dims', label: 'Vector dimensions', type: 'number', default: 1536 }],
    estimate: (c) => Math.max(1, num(c.dims, 1536) / 1536) * 65,
  },
  {
    id: 'atlas-backup',
    name: 'Cloud Backup',
    provider: 'mongodb',
    category: 'Backup',
    icon: 'DatabaseBackup',
    accent: MONGODB_ACCENT,
    blurb: 'Continuous cluster backups with PITR',
    fields: [{ key: 'storage', label: 'Backup storage', type: 'number', unit: 'GB', default: 50 }],
    // ~$0.20/GB-mo of backup storage (region-dependent)
    estimate: (c) => num(c.storage, 50) * 0.2,
  },
  {
    id: 'atlas-data-federation',
    name: 'Data Federation',
    provider: 'mongodb',
    category: 'Data Federation',
    icon: 'Combine',
    accent: MONGODB_ACCENT,
    blurb: 'Query across clusters and S3 in place',
    fields: [{ key: 'scanned', label: 'Data processed / mo', type: 'number', unit: 'TB', default: 0.5 }],
    // ~$5/TB processed
    estimate: (c) => num(c.scanned, 0.5) * 5,
  },
];
