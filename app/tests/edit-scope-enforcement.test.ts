import { describe, expect, it } from 'vitest';
import { outOfScopeViolations } from '@/lib/generate/agent-loop';
import type { ArchNode } from '@/lib/generate/orchestrator';

/**
 * Feature 008 US1 — code-side scope enforcement (FR-009).
 *
 * The planner is TOLD which nodes a modification may touch, but a prompt
 * instruction has never been sufficient — "PRESERVE USER WORK: edit only what
 * the request requires" already existed and is precisely what failed. So a plan
 * that strays outside the resolved scope is rejected here rather than trusted.
 *
 * The asymmetry these tests pin: ADDING is allowed (the request may legitimately
 * ask for new services), but removing or mutating an unreferenced element is not.
 */

const node = (nodeId: string, over: Partial<ArchNode> = {}): ArchNode =>
  ({
    nodeId,
    serviceId: 'aws-lambda',
    provider: 'aws',
    category: 'compute',
    position: { x: 0, y: 0 },
    config: {},
    ...over,
  }) as ArchNode;

const before: ArchNode[] = [
  node('n1', { serviceId: 'aws-lambda', config: { requests: '1' }, displayName: 'OrderFn' }),
  node('n2', { serviceId: 'aws-dynamodb', config: { storage: '10' } }),
  node('n3', { serviceId: 'aws-elasticache' }),
];

describe('outOfScopeViolations — allowed changes', () => {
  it('reports nothing when the draft is identical', () => {
    expect(outOfScopeViolations(before, before, ['n1'])).toEqual([]);
  });

  it('allows any change to a node inside the scope', () => {
    const after = before.map((n) =>
      n.nodeId === 'n1' ? ({ ...n, config: { requests: '99' }, displayName: 'Renamed' } as ArchNode) : n
    );
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual([]);
  });

  it('allows removing a node inside the scope', () => {
    const after = before.filter((n) => n.nodeId !== 'n1');
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual([]);
  });

  it('allows pure additions — a modification may still add what was asked for', () => {
    const after = [...before, node('n4', { serviceId: 'aws-sqs' })];
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual([]);
  });

  it('ignores repositioning — layout is recomputed every turn', () => {
    // Treating a moved node as a violation would reject every legitimate plan.
    const after = before.map((n) => ({ ...n, position: { x: 999, y: 999 } }) as ArchNode);
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual([]);
  });
});

describe('outOfScopeViolations — violations', () => {
  it('flags removal of an unreferenced node', () => {
    const after = before.filter((n) => n.nodeId !== 'n2');
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual(['n2']);
  });

  it('flags reconfiguration of an unreferenced node', () => {
    const after = before.map((n) =>
      n.nodeId === 'n2' ? ({ ...n, config: { storage: '500' } } as ArchNode) : n
    );
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual(['n2']);
  });

  it('flags renaming an unreferenced node', () => {
    const after = before.map((n) =>
      n.nodeId === 'n3' ? ({ ...n, displayName: 'SurpriseRename' } as ArchNode) : n
    );
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual(['n3']);
  });

  it('flags swapping an unreferenced node for a different service', () => {
    const after = before.map((n) =>
      n.nodeId === 'n3' ? ({ ...n, serviceId: 'aws-memorydb' } as ArchNode) : n
    );
    expect(outOfScopeViolations(before, after, ['n1'])).toEqual(['n3']);
  });

  it('reports every out-of-scope element — the "it rewrote my diagram" case', () => {
    const after = [node('n1', { serviceId: 'aws-lambda', config: { requests: '1' }, displayName: 'OrderFn' })];
    expect(outOfScopeViolations(before, after, ['n1']).sort()).toEqual(['n2', 'n3']);
  });

  it('treats an empty allow-list as "nothing may change"', () => {
    const after = before.filter((n) => n.nodeId !== 'n1');
    expect(outOfScopeViolations(before, after, [])).toEqual(['n1']);
  });
});
