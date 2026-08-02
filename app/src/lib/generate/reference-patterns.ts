/**
 * Local reference-architecture pattern library — curated from AWS Architecture
 * Center / Well-Architected reference patterns and MongoDB Atlas architecture
 * guidance, expressed in THIS app's catalog service ids so the planner can map
 * them 1:1 onto the canvas. Matched patterns are appended to the plan grounding
 * alongside the live MCP guidance; unlike the MCP they also work offline, so
 * even degraded turns get best-practice structure.
 *
 * Keep entries short: the whole matched block enters the plan prompt.
 */

export interface ReferencePattern {
  id: string;
  name: string;
  /** lowercase keywords scored against the request text */
  keywords: string[];
  /** catalog service ids that typically make up the pattern */
  services: string[];
  /** canonical request flow, as "a -> b" service-id hops */
  flow: string[];
  /** 1-3 lines of Well-Architected notes specific to the pattern */
  notes: string;
}

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    id: 'serverless-api',
    name: 'Serverless REST API',
    keywords: ['api', 'rest', 'serverless', 'crud', 'backend', 'endpoint', 'microservice'],
    services: ['aws-apigw', 'aws-lambda', 'aws-dynamodb', 'aws-cognito', 'aws-cloudwatch', 'aws-waf'],
    flow: ['aws-waf -> aws-apigw', 'aws-apigw -> aws-lambda', 'aws-lambda -> aws-dynamodb'],
    notes:
      'Front the API with WAF; authenticate via Cognito authorizers; keep Lambdas single-purpose; DynamoDB on-demand for spiky MVP traffic; alarms on p95 latency and error rate.',
  },
  {
    id: 'event-ingestion',
    name: 'Streaming / IoT ingestion pipeline',
    keywords: ['iot', 'telemetry', 'sensor', 'stream', 'ingest', 'kinesis', 'event', 'device', 'mqtt', 'clickstream'],
    services: ['aws-iot-core', 'aws-kinesis', 'aws-lambda', 'atlas-cluster', 'aws-s3', 'aws-athena', 'aws-cloudwatch', 'aws-sns'],
    flow: ['aws-iot-core -> aws-kinesis', 'aws-kinesis -> aws-lambda', 'aws-lambda -> atlas-cluster', 'aws-lambda -> aws-s3'],
    notes:
      'Buffer through Kinesis so consumers can fail without losing data; dead-letter invalid messages to SQS; hot store in Atlas time-series, cold archive in S3 queried by Athena; alarm on iterator age (ingestion lag).',
  },
  {
    id: 'rag-ai-assistant',
    name: 'RAG / AI assistant',
    keywords: ['rag', 'chatbot', 'assistant', 'llm', 'embedding', 'vector', 'semantic', 'knowledge', 'bedrock', 'ai'],
    services: ['aws-s3', 'aws-eventbridge', 'aws-stepfunctions', 'aws-lambda', 'aws-bedrock', 'atlas-vector', 'atlas-cluster', 'aws-apigw', 'aws-cognito'],
    flow: ['aws-s3 -> aws-eventbridge', 'aws-eventbridge -> aws-stepfunctions', 'aws-stepfunctions -> aws-bedrock', 'aws-bedrock -> atlas-vector', 'aws-apigw -> aws-lambda', 'aws-lambda -> atlas-vector'],
    notes:
      'Separate the ingestion pipeline (S3 → Step Functions → embed → index) from the serving path; store chunks + embeddings + access metadata together in Atlas Vector Search; enforce access filters at retrieval time, never in the prompt.',
  },
  {
    id: 'ecommerce',
    name: 'E-commerce storefront',
    keywords: ['ecommerce', 'e-commerce', 'shop', 'store', 'storefront', 'cart', 'checkout', 'catalog', 'order', 'product'],
    services: ['aws-cloudfront', 'aws-route53', 'aws-waf', 'aws-ecs', 'aws-alb', 'aws-elasticache', 'atlas-cluster', 'atlas-search', 'aws-sqs', 'aws-ses', 'aws-s3'],
    flow: ['aws-route53 -> aws-cloudfront', 'aws-cloudfront -> aws-waf', 'aws-waf -> aws-alb', 'aws-alb -> aws-ecs', 'aws-ecs -> aws-elasticache', 'aws-ecs -> atlas-cluster', 'aws-ecs -> aws-sqs'],
    notes:
      'Scale cart/checkout independently of catalog; sessions in ElastiCache with Atlas write-through; order processing event-driven via SQS with DLQ + replay; product search via Atlas Search facets.',
  },
  {
    id: 'data-analytics',
    name: 'Data lake & analytics platform',
    keywords: ['analytics', 'data lake', 'warehouse', 'etl', 'bi', 'dashboard', 'report', 'glue', 'redshift', 'athena'],
    services: ['aws-kinesis', 'aws-lambda', 'aws-s3', 'aws-glue', 'aws-athena', 'aws-redshift', 'aws-opensearch', 'aws-cloudwatch'],
    flow: ['aws-kinesis -> aws-lambda', 'aws-lambda -> aws-s3', 'aws-s3 -> aws-glue', 'aws-glue -> aws-redshift', 'aws-s3 -> aws-athena'],
    notes:
      'S3 is the source of truth (partitioned, compressed columnar); Glue catalogs + compacts nightly; Athena for ad-hoc, Redshift only for curated BI marts; near-real-time views from OpenSearch on a rolling window.',
  },
  {
    id: 'media-vod',
    name: 'Video / media processing & delivery',
    keywords: ['video', 'media', 'streaming', 'vod', 'transcode', 'upload', 'course', 'playback'],
    services: ['aws-s3', 'aws-eventbridge', 'aws-stepfunctions', 'aws-batch', 'aws-cloudfront', 'aws-ecs', 'atlas-cluster', 'atlas-search'],
    flow: ['aws-s3 -> aws-eventbridge', 'aws-eventbridge -> aws-stepfunctions', 'aws-stepfunctions -> aws-batch', 'aws-batch -> aws-s3', 'aws-s3 -> aws-cloudfront'],
    notes:
      'Presigned multipart uploads straight to S3; renditions are derivable — archive masters, version the delivery bucket; signed CloudFront URLs for entitlement; metadata + watch progress in Atlas.',
  },
  {
    id: 'geo-logistics',
    name: 'Fleet / geospatial tracking',
    keywords: ['fleet', 'gps', 'tracking', 'delivery', 'logistics', 'vehicle', 'geospatial', 'route', 'eta'],
    services: ['aws-apigw', 'aws-kinesis', 'aws-lambda', 'atlas-cluster', 'aws-s3', 'aws-eventbridge', 'aws-sns', 'aws-elasticache'],
    flow: ['aws-apigw -> aws-kinesis', 'aws-kinesis -> aws-lambda', 'aws-lambda -> atlas-cluster', 'aws-lambda -> aws-eventbridge', 'aws-eventbridge -> aws-sns'],
    notes:
      'Latest-position doc + append-only history in Atlas with geospatial indexes; event-source dispatch state changes through EventBridge; cache hot tracking pages in ElastiCache; archive raw pings to S3.',
  },
  {
    id: 'saas-multitenant',
    name: 'Multi-tenant B2B SaaS',
    keywords: ['saas', 'tenant', 'multi-tenant', 'b2b', 'subscription', 'workspace'],
    services: ['aws-cloudfront', 'aws-alb', 'aws-ecs', 'aws-cognito', 'atlas-cluster', 'atlas-search', 'aws-elasticache', 'aws-sqs', 'aws-eventbridge', 'aws-ses', 'aws-backup', 'atlas-backup'],
    flow: ['aws-cloudfront -> aws-alb', 'aws-alb -> aws-ecs', 'aws-ecs -> atlas-cluster', 'aws-ecs -> aws-sqs', 'aws-eventbridge -> aws-lambda'],
    notes:
      'Tenant id on every document with compound indexes (tenant first); enforce isolation in a repository layer, verified by tests; async exports/imports via SQS with per-queue DLQs; point-in-time backups (AWS Backup + Atlas).',
  },
  {
    id: 'fintech-ledger',
    name: 'Payments / transactional ledger',
    keywords: ['payment', 'fintech', 'ledger', 'transaction', 'billing', 'invoice', 'fraud', 'bank'],
    services: ['aws-apigw', 'aws-lambda', 'aws-sqs', 'atlas-cluster', 'aws-kms', 'aws-cloudtrail', 'aws-guardduty', 'aws-waf', 'aws-sagemaker', 'aws-secrets'],
    flow: ['aws-waf -> aws-apigw', 'aws-apigw -> aws-lambda', 'aws-lambda -> atlas-cluster', 'aws-lambda -> aws-sqs'],
    notes:
      'Append-only events; the ledger is a derived projection — rebuildable by replay; idempotency keys on every mutation; FIFO queues for ordered settlement; customer-managed KMS keys, CloudTrail with integrity validation.',
  },
  {
    id: 'realtime-social',
    name: 'Social / community feed',
    keywords: ['social', 'feed', 'community', 'post', 'comment', 'follow', 'notification', 'moderation'],
    services: ['aws-alb', 'aws-ecs', 'aws-elasticache', 'atlas-cluster', 'atlas-search', 'aws-sqs', 'aws-eventbridge', 'aws-cloudfront', 'aws-s3', 'aws-bedrock'],
    flow: ['aws-cloudfront -> aws-alb', 'aws-alb -> aws-ecs', 'aws-ecs -> aws-sqs', 'aws-sqs -> aws-lambda', 'aws-ecs -> aws-elasticache'],
    notes:
      'Fan-out-on-write via SQS for normal accounts, fan-out-on-read for celebrities; precomputed feed pages in ElastiCache backed by Atlas; media behind CloudFront with edge resizing; AI moderation screens before publish.',
  },
];

/**
 * Score candidates against the request text by keyword hits; return the top
 * matches (0-2), or [] when nothing clears the threshold — a wrong pattern is
 * worse than none. Extracted from `matchReferencePatterns` (008 T079) so the
 * store-backed and built-in pattern sets go through IDENTICAL selection: a
 * pattern must not match differently depending on where it was loaded from.
 */
export function selectPatterns(text: string, candidates: ReferencePattern[], max = 2): ReferencePattern[] {
  const t = text.toLowerCase();
  return candidates
    .map((p) => ({
      p,
      score: p.keywords.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ p }) => p);
}

/** Match against the built-in library — the offline fallback path (T079). */
export function matchReferencePatterns(text: string, max = 2): ReferencePattern[] {
  return selectPatterns(text, REFERENCE_PATTERNS, max);
}

// ---------------------------------------------------------------------------
// Knowledge-store representation (008 T079, FR-032).
//
// Stored as KnowledgeEntry rows (kind 'pattern') so an operator can edit or
// disable a pattern in Settings → AI Knowledge and have the next generation
// respect it — the property the hardcoded array alone cannot provide. The
// entry's 600-char content field carries the structured fields in a fixed
// order with NOTES LAST: notes are the only free prose, so if an edit ever
// pushes past the store cap, truncation costs note text — never the service
// list or flow the planner maps onto the canvas.
// ---------------------------------------------------------------------------

const FIELD_SEP = ' | ';

/** A pattern as a knowledge-store seed. Pure; the store I/O lives in knowledge/. */
export function serializePattern(p: ReferencePattern): {
  title: string;
  content: string;
  keywords: string[];
} {
  return {
    title: p.name.slice(0, 120),
    content: [
      `id=${p.id}`,
      `services=${p.services.join(',')}`,
      `flow=${p.flow.join('; ')}`,
      `notes=${p.notes}`,
    ].join(FIELD_SEP),
    keywords: p.keywords,
  };
}

/**
 * Parse a stored entry back into a pattern. Null on anything malformed — a
 * pattern the planner cannot map onto real service ids is worse than no
 * pattern, so there is no best-effort partial parse here (except for notes,
 * which may be truncated by the store cap and are prose anyway).
 */
export function parsePatternEntry(entry: {
  title: string;
  content: string;
  keywords?: string[];
}): ReferencePattern | null {
  const fields = new Map<string, string>();
  for (const part of entry.content.split(FIELD_SEP)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  const id = fields.get('id')?.trim() ?? '';
  const services = (fields.get('services') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!id || services.length === 0) return null;
  return {
    id,
    name: entry.title,
    keywords: (entry.keywords ?? []).map((k) => k.toLowerCase()),
    services,
    flow: (fields.get('flow') ?? '').split(';').map((f) => f.trim()).filter(Boolean),
    notes: fields.get('notes') ?? '',
  };
}

/**
 * Stored rows → usable patterns, honouring the operator's enabled flags.
 *
 * The disabled filter is HERE, not in the database query, because the caller
 * must be able to tell "the store has no patterns" (fall back to the built-in
 * library) from "the store has patterns and the operator disabled some or all
 * of them" (respect that — resurrecting a disabled pattern from the fallback
 * array would defeat the reason the store backing exists).
 */
export function patternsFromEntries(
  entries: { title: string; content: string; keywords?: string[]; enabled?: boolean }[]
): ReferencePattern[] {
  return entries
    .filter((e) => e.enabled !== false)
    .map((e) => parsePatternEntry(e))
    .filter((p): p is ReferencePattern => p !== null);
}

/** One matched pattern → a compact grounding block for the plan prompt. */
export function patternGrounding(patterns: ReferencePattern[]): string {
  if (patterns.length === 0) return '';
  return patterns
    .map(
      (p) =>
        `Reference pattern "${p.name}": services [${p.services.join(', ')}]; typical flow ${p.flow.join('; ')}. ${p.notes}`
    )
    .join('\n');
}
