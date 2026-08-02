import type { KnowledgeSeed } from '@/lib/knowledge/types';

/**
 * AWS best-practice rules (feature 008 US3, FR-018/FR-038).
 *
 * These live INSIDE the AWS plugin, not in the knowledge layer, because
 * constitution Principle II requires that adding a provider be achievable by
 * implementing a provider plugin — never by editing core code. A core file
 * enumerating CloudFront, Cognito and WAF would mean adding Azure requires
 * touching core. The seeding script collects these through the registry, so a
 * new provider contributes rules the same way it contributes a catalog.
 *
 * Each rule is written to be (a) checkable against a diagram by the reviewer,
 * and (b) short enough that six of them fit the prompt budget.
 */
export const AWS_RULES: KnowledgeSeed[] = [
  {
    title: 'Public traffic enters through an edge service',
    content:
      'Public-facing workloads sit behind an edge service (CloudFront, ALB, or API Gateway). Clients never connect directly to compute.',
    keywords: ['public', 'internet', 'api', 'web', 'edge', 'cloudfront', 'alb', 'api gateway'],
  },
  {
    title: 'Data stores stay private',
    content:
      'Databases and caches live in private subnets and are never internet-exposed. Only application tiers may reach them.',
    keywords: ['database', 'rds', 'dynamodb', 'cache', 'elasticache', 'private', 'subnet', 'security'],
  },
  {
    title: 'Containment hierarchy',
    content:
      'VPC-bound services nest cloud > region > vpc > az > subnet. Serverless and managed services (Lambda, S3, DynamoDB, SQS, CloudFront) sit at region level unless private networking is explicitly requested.',
    keywords: ['vpc', 'subnet', 'az', 'region', 'containment', 'network', 'serverless'],
  },
  {
    title: 'High availability means at least two AZs',
    content:
      'A high-availability requirement means at least two availability-zone containers with mirrored subnets, and a load balancer distributing across them.',
    keywords: ['high availability', 'ha', 'availability zone', 'az', 'redundant', 'failover', 'load balancer'],
  },
  {
    title: 'Disaster recovery means a second region',
    content:
      'Disaster recovery or multi-region means a second region container, a replication edge for every stateful service, and Route 53 failover in front.',
    keywords: ['disaster recovery', 'dr', 'multi-region', 'replication', 'failover', 'route 53', 'rto', 'rpo'],
  },
  {
    title: 'Accounts imply an auth service',
    content:
      'A user-facing application with accounts or sign-in gets an authentication service (Cognito) between the client and the API.',
    keywords: ['auth', 'authentication', 'login', 'sign in', 'users', 'accounts', 'cognito', 'oauth'],
  },
  {
    title: 'Production-ready implies observability',
    content:
      'A production-ready or observable system includes monitoring (CloudWatch) with edges from the key services it observes.',
    keywords: ['production', 'observability', 'monitoring', 'logs', 'metrics', 'alerting', 'cloudwatch'],
  },
  {
    title: 'Security and compliance implies WAF and encryption',
    content:
      'Security or compliance requirements put a WAF in front of the public entry point, and note KMS for encryption at rest.',
    keywords: ['security', 'compliance', 'waf', 'encryption', 'kms', 'pci', 'hipaa', 'gdpr'],
  },
  {
    title: 'Compute is connected to its data',
    content:
      'Every compute node that persists or reads data has an explicit edge to its datastore. No node is left unconnected unless it is genuinely standalone.',
    keywords: ['edge', 'connection', 'data flow', 'lambda', 'compute', 'database'],
  },
  {
    title: 'Strict private networking uses VPC endpoints',
    content:
      'When no public egress is allowed, reach S3 and DynamoDB through VPC endpoints rather than a NAT gateway.',
    keywords: ['private', 'no egress', 'vpc endpoint', 'nat', 'privatelink', 's3', 'dynamodb'],
  },
];
