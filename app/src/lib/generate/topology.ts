/**
 * AWS network-placement classification + containerization structural checks
 * (prompt/loop-engineering improvement, grounded in AWS's documented
 * AWS Cloud > Region > VPC > Availability Zone > Subnet hierarchy and the
 * distinction between edge/global, region-scoped-managed, and VPC-resident
 * services — see specs/ research notes for sourcing). Pure and
 * dependency-free — unit-testable in isolation (validate.ts style).
 */

/** Global/edge services — never region- or VPC-scoped in a diagram. */
const AWS_EDGE_SERVICES = new Set(['aws-cloudfront', 'aws-route53', 'aws-waf', 'aws-acm']);

/** Network-attached services that live inside a VPC (→ an Availability Zone → a Subnet). */
const AWS_VPC_SERVICES = new Set([
  'aws-ec2',
  'aws-rds',
  'aws-aurora',
  'aws-fargate',
  'aws-ecs',
  'aws-eks',
  'aws-alb',
  'aws-elasticache',
  'aws-opensearch',
  'aws-redshift',
  'aws-msk',
  'aws-efs',
]);

export type AwsPlacement = 'edge' | 'vpc' | 'regional';

/**
 * Classify an AWS serviceId's normal network placement. Everything not
 * explicitly edge or VPC-resident defaults to 'regional' (a managed/serverless
 * service scoped to a region but not to any particular VPC) — e.g. Lambda
 * (unless VPC-attached, which this catalog doesn't model), S3, DynamoDB,
 * API Gateway, SQS/SNS, CloudWatch, Cognito, KMS.
 */
export function classifyAwsPlacement(serviceId: string): AwsPlacement {
  if (AWS_EDGE_SERVICES.has(serviceId)) return 'edge';
  if (AWS_VPC_SERVICES.has(serviceId)) return 'vpc';
  return 'regional';
}

/** Illustrative serviceId examples for the two placement rules that need a prompt cheat-sheet. */
export function awsPlacementExamples(): { vpc: string; edge: string } {
  return {
    vpc: [...AWS_VPC_SERVICES].join(', '),
    edge: [...AWS_EDGE_SERVICES].join(', '),
  };
}

export interface TopologyNode {
  nodeId: string;
  serviceId: string;
  provider: string;
  containerId?: string | null;
}
export interface TopologyContainer {
  containerId: string;
  type: string;
  parentContainerId?: string | null;
}

/** Every container type in a node's ancestry chain, walking parentContainerId up to the root. */
function ancestorTypes(containerId: string | null | undefined, containers: TopologyContainer[]): Set<string> {
  const types = new Set<string>();
  let cursor = containerId ?? null;
  let hops = 0;
  while (cursor != null && hops <= containers.length) {
    const c = containers.find((x) => x.containerId === cursor);
    if (!c) break;
    types.add(c.type);
    cursor = c.parentContainerId ?? null;
    hops++;
  }
  return types;
}

export interface PruneResult<C extends TopologyContainer> {
  containers: C[];
  /** containerIds removed because their whole subtree held no service node */
  removedIds: string[];
}

/**
 * Container hygiene (C4/AWS diagram style: a boundary box only earns its place
 * when it actually contains something). Removes every container whose subtree
 * — itself plus all descendant containers — holds no service node, EXCEPT the
 * protected ones (containers that pre-existed this turn: they are user work,
 * an intentionally empty user-drawn box is never deleted). Surviving children
 * of a pruned container re-parent up to the pruned container's own parent,
 * mirroring the plan-apply "remove keeps contents" rule.
 */
export function pruneEmptyContainers<C extends TopologyContainer>(
  nodes: Pick<TopologyNode, 'containerId'>[],
  containers: C[],
  protectedContainerIds?: Set<string>
): PruneResult<C> {
  // A container is non-empty iff at least one node's ancestor chain includes it.
  const occupied = new Set<string>();
  for (const n of nodes) {
    let cursor = n.containerId ?? null;
    let hops = 0;
    while (cursor != null && hops <= containers.length) {
      occupied.add(cursor);
      cursor = containers.find((c) => c.containerId === cursor)?.parentContainerId ?? null;
      hops++;
    }
  }
  const removedIds = containers
    .filter((c) => !occupied.has(c.containerId) && !protectedContainerIds?.has(c.containerId))
    .map((c) => c.containerId);
  if (removedIds.length === 0) return { containers, removedIds };

  const removedSet = new Set(removedIds);
  const parentOf = new Map(containers.map((c) => [c.containerId, c.parentContainerId ?? null]));
  const survivingParent = (id: string | null | undefined): string | null => {
    let cursor = id ?? null;
    let hops = 0;
    while (cursor != null && removedSet.has(cursor) && hops <= containers.length) {
      cursor = parentOf.get(cursor) ?? null;
      hops++;
    }
    return cursor;
  };
  const kept = containers
    .filter((c) => !removedSet.has(c.containerId))
    .map((c) =>
      c.parentContainerId != null && removedSet.has(c.parentContainerId)
        ? { ...c, parentContainerId: survivingParent(c.parentContainerId) }
        : c
    );
  return { containers: kept, removedIds };
}

export interface CheckTopologyOpts {
  /** nodeIds this turn may not restructure (FR-011 protected scope) — never
   * flagged as an orphan even if genuinely uncontained, since a refine pass
   * could never legally fix it this turn (would otherwise burn the full
   * iteration budget on an unfixable gap every subsequent turn). */
  exemptNodeIds?: Set<string>;
}

/**
 * Containerization structural gaps — fed into the review/refine loop's
 * hard-gate (reviewer.ts's validationGaps) alongside validate.ts's
 * correctness gaps, so poor structure (not just missing capabilities) drives
 * refinement. Deliberately conservative: only flags meaningful gaps, never
 * demands structure a trivial 1-2-service canvas doesn't need.
 */
export function checkTopologyStructure(
  nodes: TopologyNode[],
  containers: TopologyContainer[],
  opts?: CheckTopologyOpts
): string[] {
  const gaps: string[] = [];
  const awsNodes = nodes.filter((n) => n.provider === 'aws');
  const mongoNodes = nodes.filter((n) => n.provider === 'mongodb');
  // FR-011 protected scope: a node this turn may not restructure can never be
  // the reason a gap fires — every rule below excludes exemptNodeIds from the
  // set it inspects, so a pre-existing protected node is never flagged as an
  // unfixable gap that would burn the full iteration budget every subsequent
  // turn. Count-based thresholds (e.g. "3+ AWS services") still use the FULL
  // node set — whether a diagram is complex enough to warrant structure
  // doesn't depend on what's editable this particular turn.
  const notExempt = (n: TopologyNode): boolean => !opts?.exemptNodeIds?.has(n.nodeId);

  // VPC-resident services always need a vpc ancestor, regardless of count —
  // an RDS instance floating with no VPC is a real correctness/best-practice gap.
  const vpcResident = awsNodes.filter((n) => classifyAwsPlacement(n.serviceId) === 'vpc');
  const missingVpc = vpcResident.filter((n) => notExempt(n) && !ancestorTypes(n.containerId, containers).has('vpc'));
  if (missingVpc.length > 0) {
    gaps.push(
      `${[...new Set(missingVpc.map((n) => n.serviceId))].join(', ')} normally run inside a VPC — place them in a vpc container (nested under az/subnet for public vs. private tiers), not directly on the canvas`
    );
  }

  // Region grouping only matters once there's an actual multi-service architecture
  // — same 3+ threshold as the AWS Cloud boundary below, so a 2-service canvas
  // (e.g. "a function and a table") isn't forced into structure it doesn't need.
  const nonEdgeAws = awsNodes.filter((n) => classifyAwsPlacement(n.serviceId) !== 'edge');
  const missingRegion = (awsNodes.length >= 3 ? nonEdgeAws : []).filter(
    (n) => notExempt(n) && !ancestorTypes(n.containerId, containers).has('region')
  );
  if (missingRegion.length > 0) {
    gaps.push(`AWS services (${[...new Set(missingRegion.map((n) => n.serviceId))].join(', ')}) are not grouped under a region container`);
  }

  // The outer AWS Cloud boundary is most valuable once there's real structure
  // to distinguish, or when AWS and MongoDB Atlas are mixed on the same canvas.
  const wantsCloudBoundary = awsNodes.length >= 3 || (awsNodes.length > 0 && mongoNodes.length > 0);
  if (wantsCloudBoundary && awsNodes.some((n) => notExempt(n) && !ancestorTypes(n.containerId, containers).has('cloud'))) {
    gaps.push('AWS services are not wrapped in an outer "AWS Cloud" boundary container');
  }

  // Atlas resources always live inside a project + cluster in reality — this
  // one applies regardless of node count.
  if (mongoNodes.length > 0 && mongoNodes.some((n) => notExempt(n) && !ancestorTypes(n.containerId, containers).has('cluster'))) {
    gaps.push('MongoDB Atlas services are not grouped under an Atlas cluster container');
  }
  if (mongoNodes.length > 0 && mongoNodes.some((n) => notExempt(n) && !ancestorTypes(n.containerId, containers).has('project'))) {
    gaps.push('MongoDB Atlas services are not wrapped in an outer Atlas project container');
  }

  // Full-containment guarantee: once this diagram uses containers at all, no
  // node should be left floating outside every one of them. Conditional on
  // containers.length > 0 so a trivial containerless canvas is never forced
  // into structure it doesn't need (consistent with the rules above).
  if (containers.length > 0) {
    const orphans = nodes.filter((n) => notExempt(n) && ancestorTypes(n.containerId, containers).size === 0);
    if (orphans.length > 0) {
      gaps.push(
        `${orphans.length} service${orphans.length === 1 ? '' : 's'} (${[...new Set(orphans.map((n) => n.serviceId))].join(', ')}) sit outside every container even though this diagram uses containers elsewhere — nest them under the appropriate boundary rather than leaving them at canvas root`
      );
    }
  }

  return gaps;
}
