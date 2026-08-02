import { serviceById } from '@/lib/catalog';

/**
 * Quick-connect suggestions (007 roadmap 2.1, Lucid/draw.io-style): when a
 * connection drag ends on empty canvas, offer the services that most commonly
 * FOLLOW the source service in real architectures. Curated adjacency — no LLM
 * on this hot path. Explicit per-service list first, then a category fallback
 * within the source's provider, always validated against the catalog.
 */

const NEXT: Record<string, string[]> = {
  // AWS request path
  'aws-route53': ['aws-cloudfront', 'aws-alb', 'aws-apigw'],
  'aws-waf': ['aws-cloudfront', 'aws-apigw', 'aws-alb'],
  'aws-cloudfront': ['aws-s3', 'aws-apigw', 'aws-alb', 'aws-waf'],
  'aws-apigw': ['aws-lambda', 'aws-fargate', 'aws-sqs', 'aws-dynamodb'],
  'aws-alb': ['aws-ec2', 'aws-fargate', 'aws-ecs', 'aws-eks'],
  'aws-lambda': ['aws-dynamodb', 'aws-s3', 'aws-sqs', 'aws-sns', 'atlas-cluster'],
  'aws-ec2': ['aws-rds', 'aws-elasticache', 'aws-s3', 'atlas-cluster'],
  'aws-fargate': ['aws-rds', 'aws-aurora', 'aws-elasticache', 'aws-sqs', 'atlas-cluster'],
  'aws-ecs': ['aws-rds', 'aws-elasticache', 'aws-sqs'],
  'aws-eks': ['aws-rds', 'aws-elasticache', 'aws-sqs'],
  'aws-sqs': ['aws-lambda', 'aws-fargate'],
  'aws-sns': ['aws-sqs', 'aws-lambda'],

  // MongoDB Atlas
  'atlas-cluster': ['atlas-search', 'atlas-vector', 'atlas-backup'],

  // Generic HLD request path
  'sys-user': ['sys-web-client', 'sys-mobile-client'],
  'sys-web-client': ['sys-cdn', 'sys-api-gateway', 'sys-load-balancer'],
  'sys-mobile-client': ['sys-api-gateway', 'sys-cdn'],
  'sys-desktop-client': ['sys-api-gateway'],
  'sys-dns': ['sys-cdn', 'sys-load-balancer'],
  'sys-cdn': ['sys-load-balancer', 'sys-api-gateway', 'sys-blob-storage'],
  'sys-load-balancer': ['sys-api-gateway', 'sys-service', 'sys-websocket'],
  'sys-api-gateway': ['sys-service', 'sys-function', 'sys-auth'],
  'sys-rate-limiter': ['sys-api-gateway', 'sys-service'],
  'sys-firewall': ['sys-load-balancer', 'sys-api-gateway'],
  'sys-service': ['sys-relational-db', 'sys-cache', 'sys-message-queue', 'sys-nosql-db', 'sys-pub-sub'],
  'sys-monolith': ['sys-relational-db', 'sys-cache', 'sys-blob-storage'],
  'sys-function': ['sys-nosql-db', 'sys-blob-storage', 'sys-message-queue'],
  'sys-websocket': ['sys-cache', 'sys-pub-sub'],
  'sys-message-queue': ['sys-worker'],
  'sys-pub-sub': ['sys-worker', 'sys-stream-processor'],
  'sys-stream-processor': ['sys-warehouse', 'sys-nosql-db'],
  'sys-worker': ['sys-relational-db', 'sys-blob-storage', 'sys-external-api'],
  'sys-scheduler': ['sys-worker', 'sys-service'],
  'sys-ml-inference': ['sys-nosql-db', 'sys-blob-storage'],
  'sys-auth': ['sys-relational-db', 'sys-cache'],

  // Generic LLD inward dependencies
  'sys-endpoint': ['sys-controller'],
  'sys-controller': ['sys-service-class', 'sys-dto'],
  'sys-service-class': ['sys-repository', 'sys-interface', 'sys-dto'],
  'sys-repository': ['sys-entity', 'sys-db-table'],
  'sys-event-handler': ['sys-service-class'],
  'sys-module': ['sys-component'],
  'sys-component': ['sys-interface', 'sys-repository'],
  'sys-interface': ['sys-class'],
  'sys-entity': ['sys-db-table'],
};

/** provider → category → fallback suggestions (used when no explicit entry hits) */
const CATEGORY_FALLBACK: Record<string, Record<string, string[]>> = {
  aws: {
    Compute: ['aws-dynamodb', 'aws-s3', 'aws-sqs', 'aws-elasticache'],
    Containers: ['aws-rds', 'aws-elasticache', 'aws-sqs'],
    Networking: ['aws-lambda', 'aws-ec2', 'aws-fargate'],
    Database: ['aws-lambda', 'aws-fargate'],
    Storage: ['aws-lambda', 'aws-cloudfront'],
    default: ['aws-lambda', 'aws-dynamodb', 'aws-s3', 'aws-sqs'],
  },
  mongodb: {
    default: ['atlas-search', 'atlas-backup'],
  },
  system: {
    'Low-Level Design': ['sys-service-class', 'sys-repository', 'sys-db-table'],
    default: ['sys-service', 'sys-relational-db', 'sys-cache', 'sys-message-queue'],
  },
};

export function suggestNextServices(sourceServiceId: string, limit = 5): string[] {
  const def = serviceById(sourceServiceId);
  const explicit = NEXT[sourceServiceId] ?? [];
  const byCategory = def ? (CATEGORY_FALLBACK[def.provider]?.[def.category] ?? CATEGORY_FALLBACK[def.provider]?.default ?? []) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...explicit, ...byCategory]) {
    if (id === sourceServiceId || seen.has(id) || !serviceById(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
