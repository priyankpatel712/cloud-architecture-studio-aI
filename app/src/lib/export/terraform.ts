import type { ExportNode, ExportEdge, ExportContainer } from '@/lib/export/serialize';

/**
 * One-way Terraform export (007 roadmap 3.3, Brainboard-inspired): serialize
 * the diagram's AWS/Atlas services into a starter .tf file — sensible
 * defaults, sizing carried from node configs where a clean mapping exists,
 * and explicit `# TODO` markers for everything that cannot be derived from a
 * diagram (IAM, networking wiring, code artifacts). Generic system-design
 * components and connections are emitted as comments: the diagram's intent
 * travels with the file without pretending to be deployable.
 *
 * Pure module (serialize.ts style) — unit-testable, no imports beyond types.
 */

const num = (v: string | number | undefined, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

function tfName(node: ExportNode): string {
  const base = (node.displayName || node.nodeId).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return base || node.nodeId.toLowerCase();
}

type Emitter = (node: ExportNode, name: string) => string;

/** serviceId → Terraform block emitter (config-aware where mappings are clean). */
const AWS_EMITTERS: Record<string, Emitter> = {
  'aws-s3': (_n, name) => `resource "aws_s3_bucket" "${name}" {
  bucket = "${name.replace(/_/g, '-')}" # TODO: globally unique bucket name
}`,
  'aws-lambda': (n, name) => `resource "aws_lambda_function" "${name}" {
  function_name = "${name}"
  memory_size   = ${num(n.config?.memory, 512)}
  runtime       = "nodejs20.x" # TODO: runtime
  handler       = "index.handler" # TODO: handler
  filename      = "deploy.zip" # TODO: deployment package
  role          = aws_iam_role.${name}_role.arn # TODO: define IAM role
}`,
  'aws-dynamodb': (_n, name) => `resource "aws_dynamodb_table" "${name}" {
  name         = "${name}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk" # TODO: key schema
  attribute {
    name = "pk"
    type = "S"
  }
}`,
  'aws-rds': (n, name) => `resource "aws_db_instance" "${name}" {
  identifier        = "${name.replace(/_/g, '-')}"
  engine            = "postgres" # TODO: engine
  instance_class    = "${String(n.config?.instance ?? n.config?.class ?? 'db.t3.medium')}"
  allocated_storage = ${num(n.config?.storage, 50)}
  username          = "app" # TODO: credentials via secrets manager
  password          = "CHANGE_ME" # TODO: never commit real credentials
  skip_final_snapshot = true
}`,
  'aws-ec2': (n, name) => `resource "aws_instance" "${name}" {
  ami           = "ami-CHANGE_ME" # TODO: AMI for your region
  instance_type = "${String(n.config?.type ?? n.config?.instance ?? 't3.medium')}"
  count         = ${Math.max(1, Math.round(num(n.config?.count, 1)))}
}`,
  'aws-apigw': (_n, name) => `resource "aws_apigatewayv2_api" "${name}" {
  name          = "${name}"
  protocol_type = "HTTP"
}`,
  'aws-sqs': (_n, name) => `resource "aws_sqs_queue" "${name}" {
  name = "${name}"
}`,
  'aws-sns': (_n, name) => `resource "aws_sns_topic" "${name}" {
  name = "${name}"
}`,
  'aws-cloudfront': (_n, name) => `resource "aws_cloudfront_distribution" "${name}" {
  enabled = true
  # TODO: origin, default_cache_behavior, viewer_certificate
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "primary" # TODO
    viewer_protocol_policy = "redirect-to-https"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}`,
  'aws-elasticache': (_n, name) => `resource "aws_elasticache_cluster" "${name}" {
  cluster_id      = "${name.replace(/_/g, '-')}"
  engine          = "redis"
  node_type       = "cache.t3.micro" # TODO: size
  num_cache_nodes = 1
}`,
  'aws-alb': (_n, name) => `resource "aws_lb" "${name}" {
  name               = "${name.replace(/_/g, '-')}"
  load_balancer_type = "application"
  # TODO: subnets, security_groups
}`,
  'aws-fargate': (_n, name) => `resource "aws_ecs_service" "${name}" {
  name        = "${name}"
  launch_type = "FARGATE"
  # TODO: cluster, task_definition, network_configuration
}`,
  'aws-cognito': (_n, name) => `resource "aws_cognito_user_pool" "${name}" {
  name = "${name}"
}`,
  'aws-route53': (_n, name) => `resource "aws_route53_zone" "${name}" {
  name = "example.com" # TODO: your domain
}`,
  'aws-waf': (_n, name) => `resource "aws_wafv2_web_acl" "${name}" {
  name  = "${name}"
  scope = "REGIONAL" # TODO: CLOUDFRONT for edge
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${name}"
    sampled_requests_enabled   = true
  }
}`,
};

const ATLAS_EMITTERS: Record<string, Emitter> = {
  'atlas-cluster': (n, name) => `resource "mongodbatlas_advanced_cluster" "${name}" {
  project_id   = var.atlas_project_id
  name         = "${name.replace(/_/g, '-')}"
  cluster_type = "REPLICASET"
  replication_specs {
    region_configs {
      electable_specs {
        instance_size = "${String(n.config?.tier ?? 'M30')}"
        node_count    = ${Math.max(1, Math.round(num(n.config?.nodes, 3)))}
      }
      provider_name = "AWS"
      priority      = 7
      region_name   = "US_EAST_1" # TODO: region
    }
  }
}`,
};

export function toTerraform(input: {
  name: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  containers?: ExportContainer[];
  defaultRegion?: string;
}): string {
  const { nodes, edges } = input;
  const hasAws = nodes.some((n) => n.provider === 'aws');
  const hasAtlas = nodes.some((n) => n.provider === 'mongodb');
  const generic = nodes.filter((n) => n.provider === 'system');

  const lines: string[] = [
    `# ${input.name} — generated by Cloud Architecture Studio (one-way export)`,
    '# Review every TODO before applying: IAM, networking, and credentials are',
    '# never derivable from a diagram.',
    '',
    'terraform {',
    '  required_providers {',
    ...(hasAws ? ['    aws = { source = "hashicorp/aws", version = "~> 5.0" }'] : []),
    ...(hasAtlas ? ['    mongodbatlas = { source = "mongodb/mongodbatlas", version = "~> 1.0" }'] : []),
    '  }',
    '}',
    '',
  ];
  if (hasAws) {
    lines.push('provider "aws" {', `  region = "${input.defaultRegion ?? 'us-east-1'}"`, '}', '');
  }
  if (hasAtlas) {
    lines.push(
      'variable "atlas_project_id" {',
      '  description = "MongoDB Atlas project id"',
      '  type        = string',
      '}',
      ''
    );
  }

  const usedNames = new Set<string>();
  for (const n of nodes) {
    if (n.provider === 'system') continue;
    let name = tfName(n);
    while (usedNames.has(name)) name = `${name}_2`;
    usedNames.add(name);
    const emitter = n.provider === 'mongodb' ? ATLAS_EMITTERS[n.serviceId] : AWS_EMITTERS[n.serviceId];
    if (emitter) {
      lines.push(emitter(n, name), '');
    } else {
      lines.push(
        `# TODO: no Terraform mapping for ${n.serviceId} (${n.displayName || name}) yet —`,
        `# add the matching resource manually.`,
        ''
      );
    }
  }

  if (generic.length > 0) {
    lines.push('# Generic design components (not deployable — carried as intent):');
    for (const n of generic) lines.push(`#   - ${n.displayName || n.serviceId}`);
    lines.push('');
  }

  if (edges.length > 0) {
    lines.push('# Connections from the diagram (wire up IAM/networking/env accordingly):');
    const byId = new Map(nodes.map((n) => [n.nodeId, n.displayName || n.serviceId]));
    for (const e of edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (s && t) lines.push(`#   ${s} -> ${t}${e.label ? ` (${e.label})` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
