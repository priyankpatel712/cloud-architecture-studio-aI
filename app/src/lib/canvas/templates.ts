import type { ArchDocument, DocContainer, DocEdge, DocNode } from '@/lib/canvas/model';

/**
 * Starter templates (Lucid-parity templates gallery) — curated, ready-made
 * diagrams a project can start from instead of a blank canvas or a prompt.
 * Each is a complete ArchDocument with hand-placed positions (no arrange pass
 * needed) using only real catalog serviceIds, so pricing, icons, quick-connect
 * and the AI refinement loop all work on it immediately — templates.test.ts
 * pins both invariants.
 *
 * Loading goes through the studio's existing import path (replace canvas →
 * user presses Save), so history, versioning, and the 409 machinery behave
 * exactly as for any other import.
 */

export interface DiagramTemplate {
  id: string;
  title: string;
  tagline: string;
  /** short service labels for the picker card */
  services: string[];
  doc: ArchDocument;
}

function node(
  nodeId: string,
  serviceId: string,
  provider: DocNode['provider'],
  x: number,
  y: number,
  displayName?: string,
  opts?: { containerId?: string; config?: Record<string, string | number> }
): DocNode {
  return {
    nodeId,
    serviceId,
    provider,
    position: { x, y },
    config: opts?.config ?? {},
    cost: 0,
    ...(displayName ? { displayName } : {}),
    ...(opts?.containerId ? { containerId: opts.containerId } : {}),
  };
}

function edge(edgeId: string, source: string, target: string, label?: string): DocEdge {
  return { edgeId, source, target, ...(label ? { label } : {}) };
}

function cont(
  containerId: string,
  type: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentContainerId?: string
): DocContainer {
  return {
    containerId,
    type,
    label,
    position: { x, y },
    size: { width, height },
    ...(parentContainerId ? { parentContainerId } : {}),
  };
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'tpl-serverless-api',
    title: 'Serverless REST API',
    tagline: 'WAF-fronted API Gateway, Lambda handlers, DynamoDB, Cognito auth',
    services: ['WAF', 'API Gateway', 'Lambda', 'DynamoDB', 'Cognito', 'S3'],
    doc: {
      nodes: [
        node('t1-waf', 'aws-waf', 'aws', 0, 120),
        node('t1-apigw', 'aws-apigw', 'aws', 260, 120),
        node('t1-cognito', 'aws-cognito', 'aws', 260, 300),
        node('t1-lambda', 'aws-lambda', 'aws', 520, 120, 'API handlers'),
        node('t1-dynamo', 'aws-dynamodb', 'aws', 780, 40),
        node('t1-s3', 'aws-s3', 'aws', 780, 220, 'Assets & uploads'),
      ],
      edges: [
        edge('t1-e1', 't1-waf', 't1-apigw', 'filtered requests'),
        edge('t1-e2', 't1-apigw', 't1-lambda', 'invokes'),
        edge('t1-e3', 't1-apigw', 't1-cognito', 'authorizes'),
        edge('t1-e4', 't1-lambda', 't1-dynamo', 'reads/writes'),
        edge('t1-e5', 't1-lambda', 't1-s3', 'presigned uploads'),
      ],
      containers: [],
      annotations: [],
    },
  },
  {
    id: 'tpl-three-tier-web',
    title: 'Three-tier web application',
    tagline: 'CloudFront edge, ALB + ECS services, Aurora with a Redis cache',
    services: ['CloudFront', 'ALB', 'ECS', 'ElastiCache', 'Aurora', 'S3'],
    doc: {
      nodes: [
        node('t2-cdn', 'aws-cloudfront', 'aws', 0, 120),
        node('t2-s3', 'aws-s3', 'aws', 0, 300, 'Static assets'),
        node('t2-alb', 'aws-alb', 'aws', 260, 120),
        node('t2-ecs', 'aws-ecs', 'aws', 520, 120, 'App services'),
        node('t2-cache', 'aws-elasticache', 'aws', 780, 40, 'Session & hot data'),
        node('t2-db', 'aws-aurora', 'aws', 780, 220),
      ],
      edges: [
        edge('t2-e1', 't2-cdn', 't2-alb', 'dynamic requests'),
        edge('t2-e2', 't2-s3', 't2-cdn', 'origin'),
        edge('t2-e3', 't2-alb', 't2-ecs', 'load-balances'),
        edge('t2-e4', 't2-ecs', 't2-cache', 'cache-aside'),
        edge('t2-e5', 't2-ecs', 't2-db', 'reads/writes'),
      ],
      containers: [],
      annotations: [],
    },
  },
  {
    id: 'tpl-rag-chatbot',
    title: 'RAG chatbot on Atlas Vector Search',
    tagline: 'API + Lambda serving path, Bedrock embeddings/answers, Atlas vector store',
    services: ['API Gateway', 'Lambda', 'Bedrock', 'Atlas', 'Vector Search', 'S3'],
    doc: {
      nodes: [
        node('t3-apigw', 'aws-apigw', 'aws', 0, 120),
        node('t3-lambda', 'aws-lambda', 'aws', 260, 120, 'Chat orchestrator'),
        node('t3-bedrock', 'aws-bedrock', 'aws', 520, 20, 'Embeddings + answers'),
        node('t3-cluster', 'atlas-cluster', 'mongodb', 520, 200, 'Conversations'),
        node('t3-vector', 'atlas-vector', 'mongodb', 780, 120, 'Chunk embeddings'),
        node('t3-s3', 'aws-s3', 'aws', 260, 300, 'Document corpus'),
      ],
      edges: [
        edge('t3-e1', 't3-apigw', 't3-lambda', 'chat turn'),
        edge('t3-e2', 't3-lambda', 't3-bedrock', 'embed + generate'),
        edge('t3-e3', 't3-lambda', 't3-vector', 'semantic retrieval'),
        edge('t3-e4', 't3-lambda', 't3-cluster', 'history'),
        edge('t3-e5', 't3-s3', 't3-lambda', 'ingestion'),
      ],
      containers: [],
      annotations: [],
    },
  },
  {
    // Recreated 1:1 from the user's Lucidchart document (2026-08-06 import):
    // three sub-architectures on one page — a multi-region AWS SaaS (Mumbai
    // primary, Ireland as an empty DR shell), an AWS serverless edge chain,
    // and a "Scalable GCP Microservices Architecture" (GKE + Cloud SQL +
    // Pub/Sub, drawn with generic system components since GCP is not a
    // provider plugin). Layer/edge labels match the source document.
    id: 'tpl-multicloud-saas',
    title: 'Multi-cloud SaaS platform',
    tagline: 'Multi-region AWS SaaS (Mumbai + Ireland DR), serverless edge chain, and a GCP GKE microservices stack',
    services: ['CloudFront', 'Lambda', 'Step Functions', 'Aurora', 'DynamoDB', 'EventBridge', 'GKE', 'Cloud SQL', 'Pub/Sub'],
    doc: {
      nodes: [
        // ---- Multi-region AWS cluster (left) ----
        node('t5-users', 'sys-user', 'system', 10, 830, 'Users (10,000+ Merchants)'),
        node('t5-s3-mum', 'aws-s3', 'aws', 25, 120, 'Amazon S3', { containerId: 'c5-mum' }),
        node('t5-api-mum', 'aws-apigw', 'aws', 26, 300, 'Regional API Endpoint', { containerId: 'c5-mum' }),
        node('t5-lambda-mum', 'aws-lambda', 'aws', 24, 70, 'Lambda Functions', { containerId: 'c5-mum-compute' }),
        node('t5-sfn-mum', 'aws-stepfunctions', 'aws', 24, 195, 'Step Functions', { containerId: 'c5-mum-compute' }),
        node('t5-fargate-mum', 'aws-fargate', 'aws', 24, 320, 'ECS Fargate', { containerId: 'c5-mum-compute' }),
        node('t5-aurora-mum', 'aws-aurora', 'aws', 23, 70, 'Aurora MySQL (Primary)', { containerId: 'c5-mum-data' }),
        node('t5-redis-mum', 'aws-elasticache', 'aws', 23, 195, 'ElastiCache Redis', { containerId: 'c5-mum-data' }),
        node('t5-ddb-mum', 'aws-dynamodb', 'aws', 23, 320, 'DynamoDB — Tenant Metadata', { containerId: 'c5-mum-data' }),
        node('t5-eb-mum', 'aws-eventbridge', 'aws', 22, 70, 'EventBridge', { containerId: 'c5-mum-int' }),
        node('t5-sqs-mum', 'aws-sqs', 'aws', 22, 195, 'SQS', { containerId: 'c5-mum-int' }),
        node('t5-sns-mum', 'aws-sns', 'aws', 22, 320, 'Amazon SNS', { containerId: 'c5-mum-int' }),
        // ---- AWS serverless SaaS chain (right, upper) ----
        node('t5-acm', 'aws-acm', 'aws', 40, 60, 'Certificate Manager (ACM)', { containerId: 'c5-saas' }),
        node('t5-waf', 'aws-waf', 'aws', 280, 61, 'AWS WAF — DDoS Protection', { containerId: 'c5-saas' }),
        node('t5-cf', 'aws-cloudfront', 'aws', 40, 230, 'CloudFront CDN — <100ms edge', { containerId: 'c5-saas' }),
        node('t5-r53', 'aws-route53', 'aws', 280, 231, 'Latency-Based Routing', { containerId: 'c5-saas' }),
        node('t5-api', 'aws-apigw', 'aws', 520, 232, 'Regional API Endpoint', { containerId: 'c5-saas' }),
        node('t5-lambda', 'aws-lambda', 'aws', 760, 233, 'Lambda — Auto-scaling', { containerId: 'c5-saas' }),
        node('t5-sfn', 'aws-stepfunctions', 'aws', 1000, 234, 'Step Functions — Orchestration', { containerId: 'c5-saas' }),
        node('t5-fargate', 'aws-fargate', 'aws', 1240, 235, 'ECS Fargate (Optional)', { containerId: 'c5-saas' }),
        node('t5-s3', 'aws-s3', 'aws', 280, 400, 'S3 — Static assets', { containerId: 'c5-saas' }),
        node('t5-aurora', 'aws-aurora', 'aws', 760, 401, 'Aurora MySQL (Primary)', { containerId: 'c5-saas' }),
        node('t5-redis', 'aws-elasticache', 'aws', 1000, 402, 'ElastiCache Redis — Session & Query', { containerId: 'c5-saas' }),
        node('t5-ddb', 'aws-dynamodb', 'aws', 1240, 403, 'DynamoDB — Tenant Metadata', { containerId: 'c5-saas' }),
        node('t5-eb', 'aws-eventbridge', 'aws', 760, 560, 'EventBridge — Event-driven', { containerId: 'c5-saas' }),
        node('t5-sqs', 'aws-sqs', 'aws', 1000, 561, 'SQS/SNS — Message queuing', { containerId: 'c5-saas' }),
        node('t5-sns', 'aws-sns', 'aws', 1240, 562, 'SNS — Push notifications', { containerId: 'c5-saas' }),
        // ---- Scalable GCP microservices architecture (right, lower) ----
        node('t5-gusers', 'sys-user', 'system', 41, 62, 'End Users', { containerId: 'c5-gcp' }),
        node('t5-ssl', 'sys-firewall', 'system', 281, 63, 'SSL (HTTPS)', { containerId: 'c5-gcp' }),
        node('t5-glb', 'sys-load-balancer', 'system', 521, 64, 'Global HTTPS LB', { containerId: 'c5-gcp', config: { tech: 'GCP L7 LB' } }),
        node('t5-ingress', 'sys-api-gateway', 'system', 761, 65, 'GKE Ingress', { containerId: 'c5-gcp' }),
        node('t5-gcdn', 'sys-cdn', 'system', 1041, 66, 'Cloud CDN', { containerId: 'c5-gcp' }),
        node('t5-gstorage', 'sys-blob-storage', 'system', 1281, 67, 'Cloud Storage', { containerId: 'c5-gcp' }),
        node('t5-gapi', 'sys-service', 'system', 42, 70, 'API Service', { containerId: 'c5-gke' }),
        node('t5-gauth', 'sys-service', 'system', 242, 71, 'Auth Service', { containerId: 'c5-gke' }),
        node('t5-gworker', 'sys-worker', 'system', 142, 240, 'Worker Service', { containerId: 'c5-gke' }),
        node('t5-gsql', 'sys-relational-db', 'system', 1530, 250, 'Cloud SQL', { containerId: 'c5-gcp', config: { tech: 'Cloud SQL (MySQL)' } }),
        node('t5-gcache', 'sys-cache', 'system', 1531, 420, 'Memorystore', { containerId: 'c5-gcp', config: { tech: 'Memorystore (Redis)' } }),
        node('t5-gpubsub', 'sys-pub-sub', 'system', 1771, 330, 'Cloud Pub/Sub', { containerId: 'c5-gcp' }),
      ],
      edges: [
        // Multi-region cluster
        edge('t5-e1', 't5-users', 't5-api-mum', 'API requests'),
        edge('t5-e2', 't5-s3-mum', 't5-lambda-mum', 'event triggers'),
        edge('t5-e3', 't5-api-mum', 't5-lambda-mum', 'invokes'),
        edge('t5-e4', 't5-api-mum', 't5-sfn-mum', 'workflows'),
        edge('t5-e5', 't5-lambda-mum', 't5-aurora-mum', 'SQL'),
        edge('t5-e6', 't5-lambda-mum', 't5-redis-mum', 'cache'),
        edge('t5-e7', 't5-lambda-mum', 't5-ddb-mum', 'tenant metadata'),
        edge('t5-e8', 't5-sfn-mum', 't5-fargate-mum', 'long-running tasks'),
        edge('t5-e9', 't5-lambda-mum', 't5-eb-mum', 'publishes events'),
        edge('t5-e10', 't5-eb-mum', 't5-sqs-mum', 'fan-out'),
        edge('t5-e11', 't5-eb-mum', 't5-sns-mum', 'notifications'),
        edge('t5-e12', 't5-s3-mum', 't5-s3', 'CRR (High Availability)'),
        // Serverless SaaS chain
        edge('t5-f1', 't5-acm', 't5-cf', 'TLS certificates'),
        edge('t5-f2', 't5-waf', 't5-cf', 'DDoS protection'),
        edge('t5-f3', 't5-cf', 't5-r53', 'routes'),
        edge('t5-f4', 't5-r53', 't5-api', 'health checks & failover'),
        edge('t5-f5', 't5-api', 't5-lambda', 'rate-limited invoke'),
        edge('t5-f6', 't5-lambda', 't5-sfn', 'workflow orchestration'),
        edge('t5-f7', 't5-sfn', 't5-fargate', 'long-running tasks'),
        edge('t5-f8', 't5-cf', 't5-s3', 'static assets'),
        edge('t5-f9', 't5-lambda', 't5-aurora', 'SQL (Multi-AZ)'),
        edge('t5-f10', 't5-lambda', 't5-redis', 'session & query cache'),
        edge('t5-f11', 't5-lambda', 't5-ddb', 'tenant metadata'),
        edge('t5-f12', 't5-lambda', 't5-eb', 'event-driven'),
        edge('t5-f13', 't5-eb', 't5-sqs', 'publish events'),
        edge('t5-f14', 't5-ddb', 't5-sns', 'stream notifications'),
        // GCP microservices
        edge('t5-g1', 't5-gusers', 't5-ssl', 'HTTPS'),
        edge('t5-g2', 't5-ssl', 't5-glb', 'TLS termination'),
        edge('t5-g3', 't5-glb', 't5-ingress', 'HTTP(S)'),
        edge('t5-g4', 't5-ingress', 't5-gapi', 'routes'),
        edge('t5-g5', 't5-gapi', 't5-gauth', 'Internal RPC'),
        edge('t5-g6', 't5-gapi', 't5-gworker', 'Internal RPC'),
        edge('t5-g7', 't5-gapi', 't5-gsql', 'SQL queries'),
        edge('t5-g8', 't5-gapi', 't5-gcache', 'cache reads'),
        edge('t5-g9', 't5-gcache', 't5-gsql', 'cache miss'),
        edge('t5-g10', 't5-gapi', 't5-gpubsub', 'publish events'),
        edge('t5-g11', 't5-gpubsub', 't5-gworker', 'push/pull'),
        edge('t5-g12', 't5-glb', 't5-gcdn', 'static assets (images, CSS)'),
        edge('t5-g13', 't5-gcdn', 't5-gstorage', 'origin fetch'),
      ],
      containers: [
        cont('c5-cloud', 'cloud', 'AWS Cloud', 280, 260, 1180, 1190),
        cont('c5-vpc', 'vpc', 'Virtual private cloud (VPC)', 40, 60, 1100, 1090, 'c5-cloud'),
        cont('c5-eu', 'region', 'EU-WEST-1 (Ireland)', 40, 50, 1020, 440, 'c5-vpc'),
        cont('c5-eu-compute', 'tier', 'Compute Layer', 40, 60, 300, 340, 'c5-eu'),
        cont('c5-eu-data', 'tier', 'Data & Cache', 360, 60, 300, 340, 'c5-eu'),
        cont('c5-eu-int', 'tier', 'Integration', 680, 60, 300, 340, 'c5-eu'),
        cont('c5-mum', 'region', 'AP-SOUTH-1 (Mumbai)', 40, 520, 1020, 530, 'c5-vpc'),
        cont('c5-mum-compute', 'tier', 'Compute Layer', 250, 50, 240, 440, 'c5-mum'),
        cont('c5-mum-data', 'tier', 'Data & Cache', 510, 50, 240, 440, 'c5-mum'),
        cont('c5-mum-int', 'tier', 'Integration', 770, 50, 240, 440, 'c5-mum'),
        cont('c5-saas', 'group', 'AWS Serverless SaaS (Multi-Tenant)', 1620, 40, 1500, 700),
        cont('c5-gcp', 'group', 'Scalable GCP Microservices Architecture', 1620, 800, 2010, 660),
        cont('c5-gke', 'system-boundary', 'GKE Cluster', 1010, 210, 470, 400, 'c5-gcp'),
      ],
      annotations: [],
    },
  },
  {
    id: 'tpl-streaming-pipeline',
    title: 'Streaming analytics pipeline',
    tagline: 'Kinesis ingestion, Lambda processing, S3 lake with Glue + Athena',
    services: ['Kinesis', 'Lambda', 'S3', 'Glue', 'Athena'],
    doc: {
      nodes: [
        node('t4-kinesis', 'aws-kinesis', 'aws', 0, 120),
        node('t4-lambda', 'aws-lambda', 'aws', 260, 120, 'Validate & batch'),
        node('t4-s3', 'aws-s3', 'aws', 520, 120, 'Data lake'),
        node('t4-glue', 'aws-glue', 'aws', 780, 40, 'Catalog & ETL'),
        node('t4-athena', 'aws-athena', 'aws', 780, 220, 'Ad-hoc SQL'),
      ],
      edges: [
        edge('t4-e1', 't4-kinesis', 't4-lambda', 'consumes'),
        edge('t4-e2', 't4-lambda', 't4-s3', 'partitioned writes'),
        edge('t4-e3', 't4-glue', 't4-s3', 'crawls'),
        edge('t4-e4', 't4-athena', 't4-s3', 'queries'),
      ],
      containers: [],
      annotations: [],
    },
  },
];
