import { describe, expect, it } from 'vitest';
import { summarizeArchitectureEdit } from '@/lib/generate/diff';

const node = (nodeId: string, serviceId: string, config: Record<string, string> = {}) => ({
  nodeId,
  serviceId,
  config,
});
const edge = (edgeId: string, source: string, target: string) => ({ edgeId, source, target });

describe('summarizeArchitectureEdit (FR-016a)', () => {
  it('reports no changes for identical architectures', () => {
    const arch = { nodes: [node('a', 'aws-lambda')], edges: [] };
    expect(summarizeArchitectureEdit(arch, arch)).toEqual([]);
  });

  it('reports added, reconfigured, and removed services', () => {
    const before = {
      nodes: [node('a', 'aws-lambda', { memory: '512' }), node('b', 'aws-s3')],
      edges: [],
    };
    const after = {
      nodes: [node('a', 'aws-lambda', { memory: '1024' }), node('c', 'aws-dynamodb')],
      edges: [],
    };
    const changes = summarizeArchitectureEdit(before, after);
    expect(changes).toContain('reconfigured aws-lambda');
    expect(changes).toContain('added aws-dynamodb');
    expect(changes).toContain('removed aws-s3');
  });

  it('summarizes connection changes with counts', () => {
    const nodes = [node('a', 'aws-apigw'), node('b', 'aws-lambda'), node('c', 'aws-s3')];
    const before = { nodes, edges: [edge('e1', 'a', 'b')] };
    const after = { nodes, edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'c')] };
    expect(summarizeArchitectureEdit(before, after)).toEqual(['connected 2 services']);
    expect(summarizeArchitectureEdit(after, before)).toEqual(['disconnected 2 connections']);
  });
});
