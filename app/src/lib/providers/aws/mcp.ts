import 'server-only';
import { McpUnavailableError, type McpAdapter } from '@/lib/providers/types';
import { callServerTool, mcpServersForPurpose } from '@/lib/providers/mcp-client';
import type { McpServerConfig } from '@/lib/providers/mcp-registry';
import { ServiceRegionAvailability } from '@/lib/models/ServiceRegionAvailability';
import { AWS_REGION_AVAILABILITY_CACHE_TTL_MS } from '@/lib/generate/loop-config';

/**
 * AWS MCP adapter (FR-014b, FR-015, research R1; 008 FR-028).
 * Grounds AWS service selection + Well-Architected guidance in an official AWS
 * MCP server, resolved through the MCP registry. Default: the AWS-hosted
 * Knowledge MCP (via `npx mcp-remote https://knowledge-mcp.global.api.aws` —
 * free, no AWS account), whose tools this adapter uses:
 *   - aws___search_documentation      → topic-scoped doc/best-practice search
 *   - aws___get_regional_availability → validated product availability per region
 * When a non-default AWS_MCP_TOOL is configured (e.g. suggest_aws_commands from
 * aws-api-mcp-server), a single { query } call is made instead.
 *
 * The registry can also supply the AWS Labs documentation server as a SECOND
 * knowledge rung. It is tried only when the first returns nothing usable, and
 * it is called with its own tool and argument shape — a fallback that forwarded
 * the primary's arguments would fail on arrival, which is worse than not having
 * one, since the failure looks like the documentation being empty.
 *
 * The raw MCP answer is returned for the LLM orchestrator to structure; when
 * no server is configured or all fail, McpUnavailableError is thrown and the
 * orchestrator reports the failed provider distinctly (spec edge case) or
 * degrades to the clearly-labelled indicative mode (spec Assumptions).
 */

/** Per-provider cap so MCP guidance can't blow the plan prompt's token budget
 * (Groq's free tier 413s on oversized requests; see lib/llm.ts). */
const RAW_TEXT_CAP = 6000;

const KNOWLEDGE_SEARCH_TOOL = 'aws___search_documentation';
const AVAILABILITY_TOOL = 'aws___get_regional_availability';

/**
 * Search one knowledge server. Each server gets the argument shape ITS tool
 * accepts: the Knowledge MCP takes topic filters, the AWS Labs documentation
 * server takes a phrase and a limit only.
 */
async function searchServer(server: McpServerConfig, request: string, context: string): Promise<string[]> {
  const tool = server.tools[0];
  // Search indexes take a phrase, not an essay; the free-text branch below gets
  // the request in full because a model on the other end can use the detail.
  const phrase = request.slice(0, 260);

  if (server.id === 'aws-documentation') {
    const raw = await callServerTool(server, { search_phrase: phrase, limit: 4 }, 'search_documentation');
    return raw.trim() ? [`[AWS documentation]\n${raw.slice(0, RAW_TEXT_CAP)}`] : [];
  }

  // A custom tool means a different server with a different contract; ask it
  // once, in prose, rather than guessing at filter arguments it may not accept.
  // This is the one shape that takes the canvas context — a free-text tool can
  // use it, whereas a search index only gets noisier for it.
  if (tool !== KNOWLEDGE_SEARCH_TOOL) {
    const raw = await callServerTool(server, {
      query: `Design the AWS portion of this architecture following Well-Architected guidance.\nRequest: ${request}\n\nCurrent architecture:\n${context}`,
    });
    return raw.trim() ? [raw.slice(0, RAW_TEXT_CAP)] : [];
  }

  // Three topic-scoped searches over the Knowledge MCP, in parallel:
  // reference docs for the established best practices, agent_skills for
  // AWS's curated architecture patterns (each ships a concrete service
  // list), and current_awareness for the newest guidance/features the
  // model's training may lack. The request text carries the intent;
  // canvas context stays with the LLM, not the search index.
  const [practices, skills, latest] = await Promise.allSettled([
    callServerTool(server, {
      search_phrase: `AWS Well-Architected architecture best practices, VPC network topology, Availability Zone placement: ${phrase}`.slice(0, 300),
      topics: ['reference_documentation', 'general'],
      limit: 3,
    }),
    callServerTool(server, { search_phrase: phrase, topics: ['agent_skills'], limit: 2 }),
    callServerTool(server, {
      search_phrase: `recommended AWS services and recent features for: ${phrase}`.slice(0, 300),
      topics: ['current_awareness'],
      limit: 2,
    }),
  ]);

  const sections: string[] = [];
  if (practices.status === 'fulfilled' && practices.value.trim()) {
    sections.push(`[Well-Architected & reference docs]\n${practices.value.slice(0, RAW_TEXT_CAP * 0.5)}`);
  }
  if (skills.status === 'fulfilled' && skills.value.trim()) {
    sections.push(`[AWS curated architecture patterns (agent skills)]\n${skills.value.slice(0, RAW_TEXT_CAP * 0.3)}`);
  }
  if (latest.status === 'fulfilled' && latest.value.trim()) {
    sections.push(`[Latest AWS announcements]\n${latest.value.slice(0, RAW_TEXT_CAP * 0.2)}`);
  }
  // Every search failing is a server problem, not an empty result set — say so,
  // so the caller can try the next rung with a real reason to report.
  if (sections.length === 0 && practices.status === 'rejected') {
    throw practices.reason instanceof Error ? practices.reason : new Error(String(practices.reason));
  }
  return sections;
}

export const awsMcp: McpAdapter = {
  async recommend(request, context) {
    const servers = mcpServersForPurpose('aws', 'knowledge');
    if (servers.length === 0) {
      throw new McpUnavailableError('aws', 'Official AWS MCP is not configured (AWS_MCP_COMMAND).');
    }

    let lastError: unknown = 'empty MCP response';

    for (const server of servers) {
      try {
        const sections = await searchServer(server, request, context);
        if (sections.length === 0) continue; // nothing usable — try the next rung
        return {
          recommendations: [],
          guidance: {},
          rawText: sections.join('\n\n').slice(0, RAW_TEXT_CAP),
          toolsInvoked: [server.tools[0]],
          official: true,
        };
      } catch (e) {
        lastError = e;
      }
    }
    throw new McpUnavailableError('aws', lastError instanceof Error ? lastError.message : String(lastError));
  },
};

/**
 * serviceId → official AWS product-catalog name, validated live against the
 * Knowledge MCP's regional-availability catalog (2026-07-18) — filter values
 * must match EXACTLY or the whole call is rejected. Only curated catalog
 * services are listed; dynamic/AI-added services are skipped by the check.
 */
const AWS_PRODUCT_NAMES: Record<string, string> = {
  'aws-lambda': 'AWS Lambda',
  'aws-ec2': 'Amazon EC2',
  'aws-apigw': 'Amazon API Gateway',
  'aws-cloudfront': 'Amazon CloudFront',
  'aws-dynamodb': 'Amazon DynamoDB',
  'aws-rds': 'Amazon RDS',
  'aws-fargate': 'AWS Fargate',
  'aws-alb': 'Elastic Load Balancing (ELB)',
  'aws-elasticache': 'Amazon ElastiCache',
  'aws-waf': 'AWS WAF',
  'aws-cognito': 'Amazon Cognito',
  'aws-kms': 'AWS Key Management Service (KMS)',
  'aws-secrets': 'AWS Secrets Manager',
  'aws-sqs': 'Amazon Simple Queue Service (SQS)',
  'aws-sns': 'Amazon Simple Notification Service (SNS)',
  'aws-stepfunctions': 'AWS Step Functions',
  'aws-kinesis': 'Amazon Kinesis Data Streams',
  'aws-iot-core': 'AWS IoT Core',
  'aws-sagemaker': 'Amazon SageMaker AI',
  'aws-cloudwatch': 'Amazon CloudWatch',
  'aws-cloudtrail': 'AWS CloudTrail',
  'aws-s3': 'Amazon Simple Storage Service (S3)',
  'aws-efs': 'Amazon EFS',
  'aws-backup': 'AWS Backup',
  'aws-route53': 'Amazon Route 53',
  'aws-ecs': 'Amazon Elastic Container Service (ECS)',
  'aws-eks': 'Amazon Elastic Kubernetes Service (EKS)',
  'aws-ecr': 'Amazon Elastic Container Registry (ECR)',
  'aws-aurora': 'Amazon Aurora',
  'aws-opensearch': 'Amazon OpenSearch Service',
  'aws-redshift': 'Amazon Redshift',
  'aws-athena': 'Amazon Athena',
  'aws-glue': 'AWS Glue',
  'aws-msk': 'Amazon Managed Streaming for Apache Kafka (MSK)',
  'aws-eventbridge': 'Amazon EventBridge',
  'aws-appsync': 'AWS AppSync',
  'aws-ses': 'Amazon Simple Email Service (SES)',
  'aws-guardduty': 'Amazon GuardDuty',
  'aws-acm': 'AWS Certificate Manager (ACM)',
  'aws-batch': 'AWS Batch',
  'aws-bedrock': 'Amazon Bedrock',
  'aws-xray': 'AWS X-Ray',
  'aws-config': 'AWS Config',
};

/** The regional-availability tool rejects calls with too many filter values. */
const AVAILABILITY_BATCH = 5;

export interface RegionalAvailability {
  serviceId: string;
  product: string;
  available: boolean;
}

/** Best-effort read-through: rows already cached (and not yet expired) for this region. */
async function readCachedAvailability(
  serviceIds: string[],
  region: string
): Promise<Map<string, RegionalAvailability>> {
  const hits = new Map<string, RegionalAvailability>();
  try {
    const rows = await ServiceRegionAvailability.find({
      provider: 'aws',
      serviceId: { $in: serviceIds },
      region,
      expiresAt: { $gt: new Date() }, // explicit guard — Mongo's TTL sweep can lag ~60s behind expiresAt
    }).lean();
    for (const r of rows) hits.set(r.serviceId, { serviceId: r.serviceId, product: r.product, available: r.available });
  } catch {
    /* cache is best-effort — a read failure just means every entry falls through to a live check */
  }
  return hits;
}

/** Best-effort persist: never let a cache write failure affect the caller's result. */
async function writeCachedAvailability(fresh: RegionalAvailability[], region: string): Promise<void> {
  if (fresh.length === 0) return;
  try {
    const expiresAt = new Date(Date.now() + AWS_REGION_AVAILABILITY_CACHE_TTL_MS);
    await ServiceRegionAvailability.bulkWrite(
      fresh.map((r) => ({
        updateOne: {
          filter: { provider: 'aws', serviceId: r.serviceId, region },
          update: { $set: { available: r.available, product: r.product, checkedAt: new Date(), expiresAt } },
          upsert: true,
        },
      }))
    );
  } catch {
    /* best-effort — a failed cache write must never fail the generation turn */
  }
}

/**
 * Check which planned AWS services are actually offered in the target region
 * via the Knowledge MCP's `aws___get_regional_availability` (official, free).
 * Read-through cached against ServiceRegionAvailability first (near-static
 * fact, TTL-bounded) — only cache misses reach the live MCP call. Best-effort
 * throughout: unknown serviceIds are skipped, any batch/cache failure is
 * dropped silently — this must never block or fail a generation turn.
 */
export async function checkAwsRegionalAvailability(
  serviceIds: string[],
  region: string
): Promise<RegionalAvailability[]> {
  // Selected by DECLARED TOOL, not by server id: only the AWS Knowledge MCP
  // answers regional availability, and the registry is where that fact lives.
  const server = mcpServersForPurpose('aws', 'knowledge').find((s) => s.tools.includes(AVAILABILITY_TOOL));
  if (!server || !region) return [];
  const entries = [...new Set(serviceIds)]
    .filter((id) => AWS_PRODUCT_NAMES[id])
    .map((id) => ({ serviceId: id, product: AWS_PRODUCT_NAMES[id] }));
  if (entries.length === 0) return [];

  const cached = await readCachedAvailability(entries.map((e) => e.serviceId), region);
  const misses = entries.filter((e) => !cached.has(e.serviceId));
  const results: RegionalAvailability[] = [...cached.values()];
  const fresh: RegionalAvailability[] = [];

  for (let i = 0; i < misses.length; i += AVAILABILITY_BATCH) {
    const batch = misses.slice(i, i + AVAILABILITY_BATCH);
    try {
      const raw = await callServerTool(
        server,
        {
          resource_type: 'product',
          regions: [region],
          filters: batch.map((b) => b.product),
        },
        AVAILABILITY_TOOL
      );
      // Response shape (validated live): {"content":{"result":{"products":{"<name>":{"status":"isAvailableIn"}}}}}
      const parsed = JSON.parse(raw) as {
        content?: { result?: { products?: Record<string, { status?: string }> } };
      };
      const products = parsed.content?.result?.products ?? {};
      for (const b of batch) {
        const status = products[b.product]?.status;
        if (!status) continue; // product not in the answer — no claim either way
        const entry = { ...b, available: status === 'isAvailableIn' };
        results.push(entry);
        fresh.push(entry);
      }
    } catch {
      /* best-effort: skip the batch */
    }
  }
  await writeCachedAvailability(fresh, region);
  return results;
}
