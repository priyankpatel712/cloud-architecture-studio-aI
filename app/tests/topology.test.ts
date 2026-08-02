import { describe, expect, it } from 'vitest';
import { classifyAwsPlacement, checkTopologyStructure, pruneEmptyContainers, type CheckTopologyOpts } from '@/lib/generate/topology';

/**
 * AWS network-placement classification + containerization structural checks
 * (prompt/loop-engineering improvement, grounded in AWS's documented
 * AWS Cloud > Region > VPC > Availability Zone > Subnet hierarchy).
 */

const node = (nodeId: string, serviceId: string, provider: string, containerId: string | null = null) => ({
  nodeId,
  serviceId,
  provider,
  containerId,
});
const container = (containerId: string, type: string, parentContainerId: string | null = null) => ({
  containerId,
  type,
  parentContainerId,
});

describe('classifyAwsPlacement', () => {
  it('classifies edge/global services', () => {
    expect(classifyAwsPlacement('aws-cloudfront')).toBe('edge');
    expect(classifyAwsPlacement('aws-route53')).toBe('edge');
    expect(classifyAwsPlacement('aws-waf')).toBe('edge');
    expect(classifyAwsPlacement('aws-acm')).toBe('edge');
  });

  it('classifies VPC-resident services', () => {
    expect(classifyAwsPlacement('aws-ec2')).toBe('vpc');
    expect(classifyAwsPlacement('aws-rds')).toBe('vpc');
    expect(classifyAwsPlacement('aws-fargate')).toBe('vpc');
    expect(classifyAwsPlacement('aws-elasticache')).toBe('vpc');
  });

  it('defaults everything else to regional (managed/serverless, not VPC-resident)', () => {
    expect(classifyAwsPlacement('aws-lambda')).toBe('regional');
    expect(classifyAwsPlacement('aws-s3')).toBe('regional');
    expect(classifyAwsPlacement('aws-dynamodb')).toBe('regional');
    expect(classifyAwsPlacement('aws-apigw')).toBe('regional');
  });
});

describe('checkTopologyStructure', () => {
  it('flags a VPC-resident service with no vpc ancestor, regardless of count', () => {
    const nodes = [node('n1', 'aws-rds', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('aws-rds') && g.includes('VPC'))).toBe(true);
  });

  it('does not flag a VPC-resident service correctly nested under vpc (even indirectly via az/subnet)', () => {
    const containers = [
      container('vpc1', 'vpc'),
      container('az1', 'az', 'vpc1'),
      container('sub1', 'subnet', 'az1'),
    ];
    const nodes = [node('n1', 'aws-rds', 'aws', 'sub1')];
    const gaps = checkTopologyStructure(nodes, containers);
    expect(gaps.some((g) => g.includes('aws-rds'))).toBe(false);
  });

  it('does not require a region container for a single trivial AWS service', () => {
    const nodes = [node('n1', 'aws-s3', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps).toHaveLength(0);
  });

  it('does not require a region container for just 2 non-edge AWS services', () => {
    const nodes = [node('n1', 'aws-s3', 'aws'), node('n2', 'aws-lambda', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('region container'))).toBe(false);
  });

  it('flags missing region grouping once there are 3+ non-edge AWS services', () => {
    const nodes = [node('n1', 'aws-s3', 'aws'), node('n2', 'aws-lambda', 'aws'), node('n3', 'aws-apigw', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('region container'))).toBe(true);
  });

  it('never requires a region container for edge-only services', () => {
    const nodes = [node('n1', 'aws-waf', 'aws'), node('n2', 'aws-cloudfront', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('region container'))).toBe(false);
  });

  it('recommends an outer AWS Cloud boundary once there are 3+ AWS services', () => {
    const containers = [container('r1', 'region')];
    const nodes = [
      node('n1', 'aws-s3', 'aws', 'r1'),
      node('n2', 'aws-lambda', 'aws', 'r1'),
      node('n3', 'aws-apigw', 'aws', 'r1'),
    ];
    const gaps = checkTopologyStructure(nodes, containers);
    expect(gaps.some((g) => g.includes('AWS Cloud'))).toBe(true);
  });

  it('recommends an outer AWS Cloud boundary when AWS and MongoDB Atlas are mixed, even with few AWS services', () => {
    const nodes = [node('n1', 'aws-s3', 'aws'), node('n2', 'atlas-cluster', 'mongodb')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('AWS Cloud'))).toBe(true);
  });

  it('does not recommend an AWS Cloud boundary for a lone AWS-only service', () => {
    const nodes = [node('n1', 'aws-s3', 'aws')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('AWS Cloud'))).toBe(false);
  });

  it('flags MongoDB Atlas nodes missing cluster/project containment, regardless of count', () => {
    const nodes = [node('n1', 'atlas-cluster', 'mongodb')];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('Atlas cluster container'))).toBe(true);
    expect(gaps.some((g) => g.includes('Atlas project container'))).toBe(true);
  });

  it('does not flag MongoDB Atlas nodes correctly nested under project > cluster', () => {
    const containers = [container('proj1', 'project'), container('clu1', 'cluster', 'proj1')];
    const nodes = [node('n1', 'atlas-cluster', 'mongodb', 'clu1')];
    const gaps = checkTopologyStructure(nodes, containers);
    expect(gaps).toHaveLength(0);
  });

  it('returns no gaps for a fully, correctly structured mixed-provider architecture', () => {
    const containers = [
      container('cloud1', 'cloud'),
      container('region1', 'region', 'cloud1'),
      container('vpc1', 'vpc', 'region1'),
      container('az1', 'az', 'vpc1'),
      container('sub1', 'subnet', 'az1'),
      container('proj1', 'project'),
      container('clu1', 'cluster', 'proj1'),
    ];
    const nodes = [
      node('n1', 'aws-apigw', 'aws', 'region1'),
      node('n2', 'aws-lambda', 'aws', 'region1'),
      node('n3', 'aws-rds', 'aws', 'sub1'),
      node('n4', 'atlas-cluster', 'mongodb', 'clu1'),
    ];
    const gaps = checkTopologyStructure(nodes, containers);
    expect(gaps).toHaveLength(0);
  });

  it('flags a node sitting outside every container once the diagram uses containers elsewhere', () => {
    const containers = [container('vpc1', 'vpc')];
    const nodes = [node('n1', 'aws-s3', 'aws', null)];
    const gaps = checkTopologyStructure(nodes, containers);
    expect(gaps.some((g) => g.includes('outside every container'))).toBe(true);
  });

  it('does not flag orphan nodes when the diagram has no containers at all', () => {
    const nodes = [node('n1', 'aws-s3', 'aws', null)];
    const gaps = checkTopologyStructure(nodes, []);
    expect(gaps.some((g) => g.includes('outside every container'))).toBe(false);
  });

  it('does not flag an orphan node listed in exemptNodeIds (protected/unfixable this turn)', () => {
    const containers = [container('vpc1', 'vpc')];
    const nodes = [node('n1', 'aws-s3', 'aws', null)];
    const opts: CheckTopologyOpts = { exemptNodeIds: new Set(['n1']) };
    const gaps = checkTopologyStructure(nodes, containers, opts);
    expect(gaps.some((g) => g.includes('outside every container'))).toBe(false);
  });
});

describe('pruneEmptyContainers', () => {
  it('removes a container whose whole subtree holds no service node', () => {
    const containers = [container('c1', 'group')];
    const { containers: kept, removedIds } = pruneEmptyContainers([], containers);
    expect(kept).toHaveLength(0);
    expect(removedIds).toEqual(['c1']);
  });

  it('keeps a container that holds a node, and every ancestor of an occupied container', () => {
    const containers = [container('vpc1', 'vpc'), container('az1', 'az', 'vpc1'), container('sub1', 'subnet', 'az1')];
    const nodes = [node('n1', 'aws-rds', 'aws', 'sub1')];
    const { containers: kept, removedIds } = pruneEmptyContainers(nodes, containers);
    expect(kept.map((c) => c.containerId).sort()).toEqual(['az1', 'sub1', 'vpc1']);
    expect(removedIds).toEqual([]);
  });

  it('removes a whole empty chain (vpc > az > subnet with no members anywhere)', () => {
    const containers = [
      container('region1', 'region'),
      container('vpc1', 'vpc', 'region1'),
      container('az1', 'az', 'vpc1'),
      container('sub1', 'subnet', 'az1'),
    ];
    const nodes = [node('n1', 'aws-lambda', 'aws', 'region1')];
    const { containers: kept, removedIds } = pruneEmptyContainers(nodes, containers);
    expect(kept.map((c) => c.containerId)).toEqual(['region1']);
    expect(removedIds.sort()).toEqual(['az1', 'sub1', 'vpc1']);
  });

  it('never removes a protected (pre-existing/user) container, even when empty', () => {
    const containers = [container('user1', 'group'), container('ai1', 'group')];
    const { containers: kept, removedIds } = pruneEmptyContainers([], containers, new Set(['user1']));
    expect(kept.map((c) => c.containerId)).toEqual(['user1']);
    expect(removedIds).toEqual(['ai1']);
  });

  it('re-parents a surviving protected child of a pruned container up to the nearest surviving ancestor', () => {
    const containers = [
      container('root1', 'cloud'),
      container('mid1', 'region', 'root1'),
      container('user1', 'group', 'mid1'),
    ];
    // root1 is occupied directly; mid1's subtree has no nodes (user1 is empty
    // but protected) — mid1 is pruned, user1 survives and re-parents to root1.
    const nodes = [node('n1', 'aws-lambda', 'aws', 'root1')];
    const { containers: kept, removedIds } = pruneEmptyContainers(nodes, containers, new Set(['user1']));
    expect(removedIds).toEqual(['mid1']);
    const user1 = kept.find((c) => c.containerId === 'user1');
    expect(user1?.parentContainerId).toBe('root1');
  });

  it('returns the same containers array untouched when nothing is empty', () => {
    const containers = [container('vpc1', 'vpc')];
    const nodes = [node('n1', 'aws-ec2', 'aws', 'vpc1')];
    const result = pruneEmptyContainers(nodes, containers);
    expect(result.containers).toBe(containers);
    expect(result.removedIds).toEqual([]);
  });
});
