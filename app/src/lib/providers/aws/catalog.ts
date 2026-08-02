import type { ServiceDef } from '@/lib/providers/types';

/**
 * AWS service catalog (migrated from lib/catalog.ts — 001 T005).
 * `estimate()` is the clearly-labelled indicative fallback (FR-021); exact pricing
 * comes from the AWS pricing adapter (official AWS cost MCP, Price List API fallback).
 */

const num = (v: string | number | undefined, fallback = 0) =>
  typeof v === 'number' ? v : v ? parseFloat(v) || fallback : fallback;

// Rough on-demand hourly rates (us-east-1), indicative only.
const EC2_HOURLY: Record<string, number> = {
  't3.micro': 0.0104,
  't3.small': 0.0208,
  't3.medium': 0.0416,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'c5.xlarge': 0.17,
};

const HOURS = 730;

export const AWS_ACCENT = '#FF9900';

/**
 * Official AWS Architecture Icons category colors (aws.amazon.com/architecture/icons,
 * 2023+ palette) — each service's accent matches its official icon so borders,
 * minimap dots, and selection rings agree with the icon artwork.
 */
const COMPUTE = '#ED7100';
const NETWORKING = '#8C4FFF';
const DATABASE = '#C925D1';
const STORAGE = '#7AA116';
const SECURITY = '#DD344C';
const INTEGRATION = '#E7157B'; // App Integration + Management & Governance
const ANALYTICS = '#8C4FFF';
const ML = '#01A88D';
const IOT = '#7AA116';

export const AWS_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'];

/** Typed boundary containers AWS contributes to the canvas (002 FR-005), using the
 * official group-icon colors + assets (public/icons/aws/group-*.svg). */
export const AWS_CONTAINER_TYPES = [
  { id: 'cloud', label: 'AWS Cloud', provider: 'aws' as const, accent: '#232F3E', blurb: 'Outermost AWS account/cloud boundary — wraps every AWS-hosted resource.' },
  { id: 'region', label: 'Region', provider: 'aws' as const, accent: '#00A4A6', iconUrl: '/icons/aws/group-region.svg', blurb: 'AWS geographic region boundary.' },
  { id: 'vpc', label: 'VPC', provider: 'aws' as const, accent: '#8C4FFF', iconUrl: '/icons/aws/group-vpc.svg', blurb: 'Virtual private cloud network boundary.' },
  { id: 'az', label: 'Availability Zone', provider: 'aws' as const, accent: '#147EBA', blurb: 'Isolated availability zone within a region.' },
  { id: 'subnet', label: 'Subnet', provider: 'aws' as const, accent: '#7AA116', iconUrl: '/icons/aws/group-subnet.svg', blurb: 'Public or private subnet within a VPC, scoped to one Availability Zone.' },
];

export const AWS_SERVICES: ServiceDef[] = [
  // ---- Compute ----
  {
    id: 'aws-lambda',
    name: 'Lambda',
    provider: 'aws',
    category: 'Compute',
    icon: 'Zap',
    iconUrl: '/icons/aws/aws-lambda.svg',
    accent: COMPUTE,
    blurb: 'Serverless functions, pay per invocation',
    fields: [
      { key: 'memory', label: 'Memory', type: 'select', unit: 'MB', default: 512, options: ['128', '256', '512', '1024', '2048'] },
      { key: 'requests', label: 'Requests / mo', type: 'number', unit: 'M', default: 2 },
      { key: 'duration', label: 'Avg duration', type: 'number', unit: 'ms', default: 120 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => {
      const reqM = num(c.requests, 2);
      const gbSec = (num(c.memory, 512) / 1024) * (num(c.duration, 120) / 1000) * reqM * 1e6;
      return reqM * 0.2 + gbSec * 0.0000166667;
    },
  },
  {
    id: 'aws-ec2',
    name: 'EC2',
    provider: 'aws',
    category: 'Compute',
    icon: 'Server',
    iconUrl: '/icons/aws/aws-ec2.svg',
    accent: COMPUTE,
    blurb: 'Virtual machines with full OS control',
    /** 003 R3/R9 — EC2's quantity dimension for attach-merge and quantity overrides */
    quantityField: 'count',
    fields: [
      { key: 'instance', label: 'Instance type', type: 'select', default: 'm5.large', options: Object.keys(EC2_HOURLY) },
      { key: 'count', label: 'Instances', type: 'number', default: 2, min: 1 },
      { key: 'storage', label: 'EBS storage', type: 'number', unit: 'GB', default: 100 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => {
      const rate = EC2_HOURLY[String(c.instance)] ?? 0.096;
      return rate * HOURS * num(c.count, 1) + num(c.storage, 0) * 0.08;
    },
  },
  // ---- Networking ----
  {
    id: 'aws-apigw',
    name: 'API Gateway',
    provider: 'aws',
    category: 'Networking',
    icon: 'Network',
    iconUrl: '/icons/aws/aws-apigw.svg',
    accent: NETWORKING,
    blurb: 'Managed REST / HTTP API front door',
    fields: [
      { key: 'requests', label: 'Requests / mo', type: 'number', unit: 'M', default: 5 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => num(c.requests, 5) * 1.0,
  },
  {
    id: 'aws-cloudfront',
    name: 'CloudFront',
    provider: 'aws',
    category: 'Networking',
    icon: 'Globe',
    iconUrl: '/icons/aws/aws-cloudfront.svg',
    accent: NETWORKING,
    blurb: 'Global CDN for low-latency delivery',
    fields: [{ key: 'transfer', label: 'Data out', type: 'number', unit: 'TB', default: 1 }],
    estimate: (c) => num(c.transfer, 1) * 1000 * 0.085,
  },
  // ---- Database ----
  {
    id: 'aws-dynamodb',
    name: 'DynamoDB',
    provider: 'aws',
    category: 'Database',
    icon: 'Table2',
    iconUrl: '/icons/aws/aws-dynamodb.svg',
    accent: DATABASE,
    blurb: 'Serverless key-value at any scale',
    fields: [
      { key: 'storage', label: 'Storage', type: 'number', unit: 'GB', default: 25 },
      { key: 'writes', label: 'Writes / mo', type: 'number', unit: 'M', default: 10 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => num(c.storage, 25) * 0.25 + num(c.writes, 10) * 1.25,
  },
  {
    id: 'aws-rds',
    name: 'RDS',
    provider: 'aws',
    category: 'Database',
    icon: 'Database',
    iconUrl: '/icons/aws/aws-rds.svg',
    accent: DATABASE,
    blurb: 'Managed relational database',
    fields: [
      { key: 'instance', label: 'Instance class', type: 'select', default: 'db.t3.medium', options: ['db.t3.small', 'db.t3.medium', 'db.m5.large'] },
      { key: 'storage', label: 'Storage', type: 'number', unit: 'GB', default: 100 },
      { key: 'multiaz', label: 'Multi-AZ', type: 'select', default: 'No', options: ['No', 'Yes'] },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => {
      const base = { 'db.t3.small': 0.034, 'db.t3.medium': 0.068, 'db.m5.large': 0.171 }[String(c.instance)] ?? 0.068;
      const mult = c.multiaz === 'Yes' ? 2 : 1;
      return base * HOURS * mult + num(c.storage, 0) * 0.115;
    },
  },
  // ---- Containers ----
  {
    id: 'aws-fargate',
    name: 'ECS on Fargate',
    provider: 'aws',
    category: 'Containers',
    icon: 'Container',
    iconUrl: '/icons/aws/aws-fargate.svg',
    accent: COMPUTE,
    blurb: 'Serverless containers for microservices',
    quantityField: 'tasks',
    fields: [
      { key: 'tasks', label: 'Tasks', type: 'number', default: 2, min: 1 },
      { key: 'vcpu', label: 'vCPU / task', type: 'select', default: '0.5', options: ['0.25', '0.5', '1', '2', '4'] },
      { key: 'memory', label: 'Memory / task', type: 'number', unit: 'GB', default: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.04048/vCPU-hr + $0.004445/GB-hr (us-east-1 on-demand)
    estimate: (c) => Math.max(1, num(c.tasks, 2)) * (num(c.vcpu, 0.5) * 0.04048 + num(c.memory, 1) * 0.004445) * HOURS,
  },
  // ---- Networking (cont.) ----
  {
    id: 'aws-alb',
    name: 'Application Load Balancer',
    provider: 'aws',
    category: 'Networking',
    icon: 'Scale',
    iconUrl: '/icons/aws/aws-alb.svg',
    accent: NETWORKING,
    blurb: 'Layer-7 load balancing for HTTP(S) traffic',
    fields: [
      { key: 'lcus', label: 'Avg LCUs', type: 'number', default: 5 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.0225/hr + $0.008/LCU-hr
    estimate: (c) => 0.0225 * HOURS + num(c.lcus, 5) * 0.008 * HOURS,
  },
  // ---- Database (cont.) ----
  {
    id: 'aws-elasticache',
    name: 'ElastiCache (Redis)',
    provider: 'aws',
    category: 'Database',
    icon: 'MemoryStick',
    iconUrl: '/icons/aws/aws-elasticache.svg',
    accent: DATABASE,
    blurb: 'In-memory cache for sessions and hot data',
    quantityField: 'nodes',
    fields: [
      { key: 'nodeType', label: 'Node type', type: 'select', default: 'cache.t3.medium', options: ['cache.t3.micro', 'cache.t3.medium', 'cache.m5.large'] },
      { key: 'nodes', label: 'Nodes', type: 'number', default: 2, min: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => {
      const rate = { 'cache.t3.micro': 0.017, 'cache.t3.medium': 0.068, 'cache.m5.large': 0.156 }[String(c.nodeType)] ?? 0.068;
      return rate * HOURS * Math.max(1, num(c.nodes, 2));
    },
  },
  // ---- Security, Identity & Compliance ----
  {
    id: 'aws-waf',
    name: 'WAF',
    provider: 'aws',
    category: 'Security',
    icon: 'Shield',
    iconUrl: '/icons/aws/aws-waf.svg',
    accent: SECURITY,
    blurb: 'Web application firewall for APIs and CDNs',
    fields: [
      { key: 'webAcls', label: 'Web ACLs', type: 'number', default: 1, min: 1 },
      { key: 'rules', label: 'Rules', type: 'number', default: 10 },
      { key: 'requests', label: 'Requests / mo', type: 'number', unit: 'M', default: 10 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $5/ACL + $1/rule + $0.60/M requests
    estimate: (c) => num(c.webAcls, 1) * 5 + num(c.rules, 10) * 1 + num(c.requests, 10) * 0.6,
  },
  {
    id: 'aws-cognito',
    name: 'Cognito',
    provider: 'aws',
    category: 'Security',
    icon: 'UserCheck',
    iconUrl: '/icons/aws/aws-cognito.svg',
    accent: SECURITY,
    blurb: 'User sign-up, sign-in, and token issuance',
    fields: [
      { key: 'mau', label: 'Monthly active users', type: 'number', default: 10000 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.0055/MAU beyond the 10k free tier
    estimate: (c) => Math.max(0, num(c.mau, 10000) - 10000) * 0.0055,
  },
  {
    id: 'aws-kms',
    name: 'KMS',
    provider: 'aws',
    category: 'Security',
    icon: 'KeyRound',
    iconUrl: '/icons/aws/aws-kms.svg',
    accent: SECURITY,
    blurb: 'Managed encryption keys for data at rest/in transit',
    fields: [
      { key: 'keys', label: 'Customer keys', type: 'number', default: 2, min: 1 },
      { key: 'requests', label: 'Requests / mo', type: 'number', unit: 'M', default: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $1/key + $0.03/10k requests
    estimate: (c) => num(c.keys, 2) * 1 + num(c.requests, 1) * 3,
  },
  {
    id: 'aws-secrets',
    name: 'Secrets Manager',
    provider: 'aws',
    category: 'Security',
    icon: 'LockKeyhole',
    iconUrl: '/icons/aws/aws-secrets.svg',
    accent: SECURITY,
    blurb: 'Rotated storage for credentials and API keys',
    fields: [
      { key: 'secrets', label: 'Secrets', type: 'number', default: 5, min: 1 },
      { key: 'apiCalls', label: 'API calls / mo', type: 'number', unit: 'M', default: 0.1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.40/secret + $0.05/10k calls
    estimate: (c) => num(c.secrets, 5) * 0.4 + num(c.apiCalls, 0.1) * 5,
  },
  // ---- App Integration ----
  {
    id: 'aws-sqs',
    name: 'SQS',
    provider: 'aws',
    category: 'App Integration',
    icon: 'ListOrdered',
    iconUrl: '/icons/aws/aws-sqs.svg',
    accent: INTEGRATION,
    blurb: 'Managed queues, incl. dead-letter queues',
    fields: [
      { key: 'requests', label: 'Requests / mo', type: 'number', unit: 'M', default: 10 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.40/M standard requests
    estimate: (c) => num(c.requests, 10) * 0.4,
  },
  {
    id: 'aws-sns',
    name: 'SNS',
    provider: 'aws',
    category: 'App Integration',
    icon: 'Megaphone',
    iconUrl: '/icons/aws/aws-sns.svg',
    accent: INTEGRATION,
    blurb: 'Pub/sub fan-out for events and notifications',
    fields: [
      { key: 'publishes', label: 'Publishes / mo', type: 'number', unit: 'M', default: 10 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.50/M publishes
    estimate: (c) => num(c.publishes, 10) * 0.5,
  },
  {
    id: 'aws-stepfunctions',
    name: 'Step Functions',
    provider: 'aws',
    category: 'App Integration',
    icon: 'Workflow',
    iconUrl: '/icons/aws/aws-stepfunctions.svg',
    accent: INTEGRATION,
    blurb: 'Serverless workflow orchestration',
    fields: [
      { key: 'transitions', label: 'State transitions / mo', type: 'number', unit: 'M', default: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $25/M standard state transitions
    estimate: (c) => num(c.transitions, 1) * 25,
  },
  // ---- Analytics ----
  {
    id: 'aws-kinesis',
    name: 'Kinesis Data Streams',
    provider: 'aws',
    category: 'Analytics',
    icon: 'Waves',
    iconUrl: '/icons/aws/aws-kinesis.svg',
    accent: ANALYTICS,
    blurb: 'High-throughput real-time data streaming',
    quantityField: 'shards',
    fields: [
      { key: 'shards', label: 'Shards', type: 'number', default: 2, min: 1 },
      { key: 'putUnits', label: 'PUT units / mo', type: 'number', unit: 'M', default: 50 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.015/shard-hr + $0.014/M PUT payload units
    estimate: (c) => Math.max(1, num(c.shards, 2)) * 0.015 * HOURS + num(c.putUnits, 50) * 0.014,
  },
  // ---- IoT ----
  {
    id: 'aws-iot-core',
    name: 'IoT Core',
    provider: 'aws',
    category: 'IoT',
    icon: 'Cpu',
    iconUrl: '/icons/aws/aws-iot-core.svg',
    accent: IOT,
    blurb: 'MQTT device connectivity and message brokering',
    fields: [
      { key: 'devices', label: 'Connected devices', type: 'number', default: 10000 },
      { key: 'messages', label: 'Messages / mo', type: 'number', unit: 'M', default: 250 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // connectivity $0.08/M connection-minutes (~43.8k min/mo per device) + $1.00/M messages
    estimate: (c) => (num(c.devices, 10000) * 43800 * 0.08) / 1e6 + num(c.messages, 250) * 1.0,
  },
  // ---- Machine Learning ----
  {
    id: 'aws-sagemaker',
    name: 'SageMaker Inference',
    provider: 'aws',
    category: 'Machine Learning',
    icon: 'Brain',
    iconUrl: '/icons/aws/aws-sagemaker.svg',
    accent: ML,
    blurb: 'Serverless model hosting and inference',
    fields: [
      { key: 'requests', label: 'Inferences / mo', type: 'number', unit: 'M', default: 1 },
      { key: 'memory', label: 'Memory', type: 'select', unit: 'GB', default: '2', options: ['1', '2', '4', '6'] },
      { key: 'duration', label: 'Avg duration', type: 'number', unit: 'ms', default: 100 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // serverless inference ≈ $0.00002/GB-second
    estimate: (c) => num(c.requests, 1) * 1e6 * (num(c.duration, 100) / 1000) * num(c.memory, 2) * 0.00002,
  },
  // ---- Management & Governance ----
  {
    id: 'aws-cloudwatch',
    name: 'CloudWatch',
    provider: 'aws',
    category: 'Management',
    icon: 'Activity',
    iconUrl: '/icons/aws/aws-cloudwatch.svg',
    accent: INTEGRATION,
    blurb: 'Metrics, logs, dashboards, and alarms',
    fields: [
      { key: 'metrics', label: 'Custom metrics', type: 'number', default: 50 },
      { key: 'logs', label: 'Log ingestion', type: 'number', unit: 'GB', default: 10 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.30/metric + $0.50/GB ingested
    estimate: (c) => num(c.metrics, 50) * 0.3 + num(c.logs, 10) * 0.5,
  },
  {
    id: 'aws-cloudtrail',
    name: 'CloudTrail',
    provider: 'aws',
    category: 'Management',
    icon: 'ScrollText',
    iconUrl: '/icons/aws/aws-cloudtrail.svg',
    accent: INTEGRATION,
    blurb: 'Audit logging of account and data events',
    fields: [
      { key: 'dataEvents', label: 'Data events / mo', type: 'number', unit: 'M', default: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // management events free (first copy); data events $0.10/100k
    estimate: (c) => num(c.dataEvents, 1) * 1.0,
  },
  // ---- Storage ----
  {
    id: 'aws-s3',
    name: 'S3',
    provider: 'aws',
    category: 'Storage',
    icon: 'HardDrive',
    iconUrl: '/icons/aws/aws-s3.svg',
    accent: STORAGE,
    blurb: 'Object storage for any file type',
    fields: [
      { key: 'storage', label: 'Storage', type: 'number', unit: 'GB', default: 500 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => num(c.storage, 500) * 0.023,
  },
  {
    id: 'aws-efs',
    name: 'EFS',
    provider: 'aws',
    category: 'Storage',
    icon: 'FolderTree',
    iconUrl: '/icons/aws/svc/AmazonEFS.svg',
    accent: STORAGE,
    blurb: 'Shared elastic NFS file system',
    fields: [{ key: 'storage', label: 'Storage', type: 'number', unit: 'GB', default: 100 }],
    // Standard storage ~$0.30/GB-mo
    estimate: (c) => num(c.storage, 100) * 0.3,
  },
  {
    id: 'aws-backup',
    name: 'AWS Backup',
    provider: 'aws',
    category: 'Storage',
    icon: 'Archive',
    iconUrl: '/icons/aws/svc/AWSBackup.svg',
    accent: STORAGE,
    blurb: 'Centralized, policy-based backups',
    fields: [{ key: 'storage', label: 'Backup storage', type: 'number', unit: 'GB', default: 200 }],
    // Warm backup storage ~$0.05/GB-mo
    estimate: (c) => num(c.storage, 200) * 0.05,
  },
  // ---- Networking (extended) ----
  {
    id: 'aws-route53',
    name: 'Route 53',
    provider: 'aws',
    category: 'Networking',
    icon: 'Signpost',
    iconUrl: '/icons/aws/svc/AmazonRoute53.svg',
    accent: NETWORKING,
    blurb: 'DNS, health checks, and traffic routing',
    fields: [
      { key: 'zones', label: 'Hosted zones', type: 'number', default: 1, min: 1 },
      { key: 'queries', label: 'Queries / mo', type: 'number', unit: 'M', default: 10 },
    ],
    // $0.50/zone + $0.40 per M standard queries
    estimate: (c) => num(c.zones, 1) * 0.5 + num(c.queries, 10) * 0.4,
  },
  // ---- Containers (extended) ----
  {
    id: 'aws-ecs',
    name: 'ECS',
    provider: 'aws',
    category: 'Containers',
    icon: 'Boxes',
    iconUrl: '/icons/aws/svc/AmazonElasticContainerService.svg',
    accent: COMPUTE,
    blurb: 'Container orchestration (Fargate launch)',
    quantityField: 'tasks',
    fields: [
      { key: 'tasks', label: 'Tasks', type: 'number', default: 4, min: 1 },
      { key: 'vcpu', label: 'vCPU / task', type: 'select', default: '0.5', options: ['0.25', '0.5', '1', '2', '4'] },
      { key: 'memory', label: 'Memory / task', type: 'number', unit: 'GB', default: 1 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // Fargate: ~$29.5/vCPU-mo + ~$3.24/GB-mo
    estimate: (c) => num(c.tasks, 4) * (num(c.vcpu, 0.5) * 29.5 + num(c.memory, 1) * 3.24),
  },
  {
    id: 'aws-eks',
    name: 'EKS',
    provider: 'aws',
    category: 'Containers',
    icon: 'Ship',
    iconUrl: '/icons/aws/svc/AmazonElasticKubernetesService.svg',
    accent: COMPUTE,
    blurb: 'Managed Kubernetes control plane + nodes',
    quantityField: 'nodes',
    fields: [
      { key: 'clusters', label: 'Clusters', type: 'number', default: 1, min: 1 },
      { key: 'nodes', label: 'Worker nodes', type: 'number', default: 3, min: 1 },
      { key: 'instance', label: 'Node type', type: 'select', default: 'm5.large', options: Object.keys(EC2_HOURLY) },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    // $0.10/h per control plane + node EC2 cost
    estimate: (c) =>
      num(c.clusters, 1) * 0.1 * HOURS + num(c.nodes, 3) * (EC2_HOURLY[String(c.instance)] ?? 0.096) * HOURS,
  },
  {
    id: 'aws-ecr',
    name: 'ECR',
    provider: 'aws',
    category: 'Containers',
    icon: 'Package',
    iconUrl: '/icons/aws/svc/AmazonElasticContainerRegistry.svg',
    accent: COMPUTE,
    blurb: 'Private container image registry',
    fields: [{ key: 'storage', label: 'Image storage', type: 'number', unit: 'GB', default: 20 }],
    // $0.10/GB-mo
    estimate: (c) => num(c.storage, 20) * 0.1,
  },
  // ---- Database (extended) ----
  {
    id: 'aws-aurora',
    name: 'Aurora',
    provider: 'aws',
    category: 'Database',
    icon: 'Database',
    iconUrl: '/icons/aws/svc/AmazonAurora.svg',
    accent: DATABASE,
    blurb: 'MySQL/PostgreSQL-compatible cloud-native DB',
    quantityField: 'instances',
    fields: [
      { key: 'instance', label: 'Instance class', type: 'select', default: 'db.r6g.large', options: ['db.t4g.medium', 'db.r6g.large', 'db.r6g.xlarge'] },
      { key: 'instances', label: 'Instances', type: 'number', default: 2, min: 1 },
      { key: 'storage', label: 'Storage', type: 'number', unit: 'GB', default: 100 },
      { key: 'region', label: 'Region', type: 'select', default: 'us-east-1', options: AWS_REGIONS },
    ],
    estimate: (c) => {
      const rates: Record<string, number> = { 'db.t4g.medium': 0.073, 'db.r6g.large': 0.26, 'db.r6g.xlarge': 0.52 };
      return (rates[String(c.instance)] ?? 0.26) * HOURS * num(c.instances, 2) + num(c.storage, 100) * 0.1;
    },
  },
  // ---- Analytics (extended) ----
  {
    id: 'aws-opensearch',
    name: 'OpenSearch',
    provider: 'aws',
    category: 'Analytics',
    icon: 'ScanSearch',
    iconUrl: '/icons/aws/svc/AmazonOpenSearchService.svg',
    accent: ANALYTICS,
    blurb: 'Managed search and log analytics engine',
    quantityField: 'nodes',
    fields: [
      { key: 'nodes', label: 'Data nodes', type: 'number', default: 2, min: 1 },
      { key: 'instance', label: 'Node type', type: 'select', default: 't3.small.search', options: ['t3.small.search', 'm6g.large.search', 'r6g.large.search'] },
      { key: 'storage', label: 'EBS storage', type: 'number', unit: 'GB', default: 100 },
    ],
    estimate: (c) => {
      const rates: Record<string, number> = { 't3.small.search': 0.036, 'm6g.large.search': 0.128, 'r6g.large.search': 0.167 };
      return (rates[String(c.instance)] ?? 0.036) * HOURS * num(c.nodes, 2) + num(c.storage, 100) * 0.135;
    },
  },
  {
    id: 'aws-redshift',
    name: 'Redshift',
    provider: 'aws',
    category: 'Analytics',
    icon: 'BarChart3',
    iconUrl: '/icons/aws/svc/AmazonRedshift.svg',
    accent: ANALYTICS,
    blurb: 'Petabyte-scale data warehouse',
    quantityField: 'nodes',
    fields: [
      { key: 'nodes', label: 'Nodes', type: 'number', default: 2, min: 1 },
      { key: 'nodeType', label: 'Node type', type: 'select', default: 'dc2.large', options: ['dc2.large', 'ra3.xlplus'] },
    ],
    estimate: (c) => {
      const rates: Record<string, number> = { 'dc2.large': 0.25, 'ra3.xlplus': 1.086 };
      return (rates[String(c.nodeType)] ?? 0.25) * HOURS * num(c.nodes, 2);
    },
  },
  {
    id: 'aws-athena',
    name: 'Athena',
    provider: 'aws',
    category: 'Analytics',
    icon: 'FileSearch',
    iconUrl: '/icons/aws/svc/AmazonAthena.svg',
    accent: ANALYTICS,
    blurb: 'Serverless SQL over data in S3',
    fields: [{ key: 'scanned', label: 'Data scanned / mo', type: 'number', unit: 'TB', default: 1 }],
    // $5 per TB scanned
    estimate: (c) => num(c.scanned, 1) * 5,
  },
  {
    id: 'aws-glue',
    name: 'Glue',
    provider: 'aws',
    category: 'Analytics',
    icon: 'Layers',
    iconUrl: '/icons/aws/svc/AWSGlue.svg',
    accent: ANALYTICS,
    blurb: 'Serverless ETL and data catalog',
    fields: [{ key: 'dpuHours', label: 'DPU-hours / mo', type: 'number', default: 50 }],
    // $0.44/DPU-hour
    estimate: (c) => num(c.dpuHours, 50) * 0.44,
  },
  {
    id: 'aws-msk',
    name: 'MSK',
    provider: 'aws',
    category: 'Analytics',
    icon: 'Radio',
    iconUrl: '/icons/aws/svc/AmazonManagedStreamingforApacheKafka.svg',
    accent: ANALYTICS,
    blurb: 'Managed Apache Kafka event streaming',
    quantityField: 'brokers',
    fields: [
      { key: 'brokers', label: 'Brokers', type: 'number', default: 3, min: 1 },
      { key: 'instance', label: 'Broker type', type: 'select', default: 'kafka.t3.small', options: ['kafka.t3.small', 'kafka.m5.large'] },
      { key: 'storage', label: 'Storage / broker', type: 'number', unit: 'GB', default: 100 },
    ],
    estimate: (c) => {
      const rates: Record<string, number> = { 'kafka.t3.small': 0.0456, 'kafka.m5.large': 0.21 };
      return (rates[String(c.instance)] ?? 0.0456) * HOURS * num(c.brokers, 3) + num(c.brokers, 3) * num(c.storage, 100) * 0.1;
    },
  },
  // ---- App Integration (extended) ----
  {
    id: 'aws-eventbridge',
    name: 'EventBridge',
    provider: 'aws',
    category: 'App Integration',
    icon: 'Shuffle',
    iconUrl: '/icons/aws/svc/AmazonEventBridge.svg',
    accent: INTEGRATION,
    blurb: 'Serverless event bus and scheduler',
    fields: [{ key: 'events', label: 'Custom events / mo', type: 'number', unit: 'M', default: 5 }],
    // $1.00 per M custom events
    estimate: (c) => num(c.events, 5) * 1.0,
  },
  {
    id: 'aws-appsync',
    name: 'AppSync',
    provider: 'aws',
    category: 'App Integration',
    icon: 'Network',
    iconUrl: '/icons/aws/svc/AWSAppSync.svg',
    accent: INTEGRATION,
    blurb: 'Managed GraphQL APIs with subscriptions',
    fields: [{ key: 'requests', label: 'Queries / mo', type: 'number', unit: 'M', default: 5 }],
    // $4.00 per M query/mutation operations
    estimate: (c) => num(c.requests, 5) * 4,
  },
  {
    id: 'aws-ses',
    name: 'SES',
    provider: 'aws',
    category: 'App Integration',
    icon: 'Mail',
    iconUrl: '/icons/aws/svc/AmazonSimpleEmailService.svg',
    accent: INTEGRATION,
    blurb: 'Transactional and bulk email delivery',
    fields: [{ key: 'emails', label: 'Emails / mo', type: 'number', unit: 'K', default: 100 }],
    // $0.10 per 1k emails
    estimate: (c) => num(c.emails, 100) * 0.1,
  },
  // ---- Security (extended) ----
  {
    id: 'aws-guardduty',
    name: 'GuardDuty',
    provider: 'aws',
    category: 'Security',
    icon: 'ShieldAlert',
    iconUrl: '/icons/aws/svc/AmazonGuardDuty.svg',
    accent: SECURITY,
    blurb: 'Intelligent threat detection',
    fields: [{ key: 'analyzed', label: 'Logs analyzed / mo', type: 'number', unit: 'GB', default: 50 }],
    estimate: (c) => num(c.analyzed, 50) * 0.8,
  },
  {
    id: 'aws-acm',
    name: 'Certificate Manager',
    provider: 'aws',
    category: 'Security',
    icon: 'BadgeCheck',
    iconUrl: '/icons/aws/svc/AWSCertificateManager.svg',
    accent: SECURITY,
    blurb: 'Free public TLS certificates, auto-renewed',
    fields: [{ key: 'certs', label: 'Public certificates', type: 'number', default: 1, min: 1 }],
    // Public certificates are free with AWS services
    estimate: () => 0,
  },
  // ---- Compute (extended) ----
  {
    id: 'aws-batch',
    name: 'Batch',
    provider: 'aws',
    category: 'Compute',
    icon: 'ListChecks',
    iconUrl: '/icons/aws/svc/AWSBatch.svg',
    accent: COMPUTE,
    blurb: 'Managed batch compute jobs',
    fields: [{ key: 'vcpuHours', label: 'vCPU-hours / mo', type: 'number', default: 200 }],
    // Fargate-priced compute; the Batch service itself is free
    estimate: (c) => num(c.vcpuHours, 200) * 0.04,
  },
  // ---- Machine Learning (extended) ----
  {
    id: 'aws-bedrock',
    name: 'Bedrock',
    provider: 'aws',
    category: 'Machine Learning',
    icon: 'Sparkles',
    iconUrl: '/icons/aws/svc/AmazonBedrock.svg',
    accent: ML,
    blurb: 'Foundation-model APIs (LLMs, embeddings)',
    fields: [
      { key: 'inputTokens', label: 'Input tokens / mo', type: 'number', unit: 'M', default: 10 },
      { key: 'outputTokens', label: 'Output tokens / mo', type: 'number', unit: 'M', default: 2 },
    ],
    // Mid-range on-demand model pricing (~$1/M in, ~$3/M out)
    estimate: (c) => num(c.inputTokens, 10) * 1 + num(c.outputTokens, 2) * 3,
  },
  // ---- Management (extended) ----
  {
    id: 'aws-xray',
    name: 'X-Ray',
    provider: 'aws',
    category: 'Management',
    icon: 'Crosshair',
    iconUrl: '/icons/aws/svc/AWSXRay.svg',
    accent: INTEGRATION,
    blurb: 'Distributed tracing for requests',
    fields: [{ key: 'traces', label: 'Traces / mo', type: 'number', unit: 'M', default: 1 }],
    // $5 per M traces recorded
    estimate: (c) => num(c.traces, 1) * 5,
  },
  {
    id: 'aws-config',
    name: 'Config',
    provider: 'aws',
    category: 'Management',
    icon: 'SlidersHorizontal',
    iconUrl: '/icons/aws/svc/AWSConfig.svg',
    accent: INTEGRATION,
    blurb: 'Resource inventory and compliance rules',
    fields: [{ key: 'items', label: 'Config items / mo', type: 'number', unit: 'K', default: 10 }],
    // $0.003 per configuration item
    estimate: (c) => num(c.items, 10) * 3,
  },
];
