import { describe, expect, it } from 'vitest';
import { decideAdds, applyAddMerge } from '@/lib/generate/orchestrator';
import type { ServiceConfig } from '@/lib/providers/types';

/**
 * Attach-duplicate merge decisions (003 T027; FR-005, US2/AC3, research R3).
 */

const kept = [
  { nodeId: 'n-ec2', serviceId: 'aws-ec2' },
  { nodeId: 'n-s3', serviceId: 'aws-s3' },
];

describe('decideAdds', () => {
  it('merges an add whose service already exists', () => {
    expect(decideAdds([{ serviceId: 'aws-ec2' }], kept, new Set(), ['aws'])).toEqual([
      { kind: 'merge', nodeId: 'n-ec2' },
    ]);
  });

  it('creates a node for a service not yet present', () => {
    expect(decideAdds([{ serviceId: 'aws-lambda' }], kept, new Set(), ['aws'])).toEqual([
      { kind: 'create' },
    ]);
  });

  it('does not merge into a node the same turn separately reconfigures', () => {
    expect(decideAdds([{ serviceId: 'aws-ec2' }], kept, new Set(['n-ec2']), ['aws'])).toEqual([
      { kind: 'create' },
    ]);
  });

  it('skips unknown services and unattached providers', () => {
    expect(decideAdds([{ serviceId: 'not-a-service' }], kept, new Set(), ['aws'])).toEqual([
      { kind: 'skip' },
    ]);
    expect(decideAdds([{ serviceId: 'atlas-cluster' }], kept, new Set(), ['aws'])).toEqual([
      { kind: 'skip' },
    ]);
  });

  // Dynamic services (follow-up: the catalog no longer bounds the AI).
  it('creates a dynamic service when the plan supplies an identity', () => {
    expect(decideAdds([{ serviceId: 'aws-textract', name: 'Textract' }], kept, new Set(), ['aws'])).toEqual([
      { kind: 'create' },
    ]);
  });

  it('creates from a name-less slug the extended icon catalog already knows', () => {
    // Textract has no curated cost model but IS in the extended official-icon
    // catalog, so its identity (name, icon, category) is known without the
    // plan supplying one — only genuinely unknown slugs still need a name.
    expect(decideAdds([{ serviceId: 'aws-textract' }], kept, new Set(), ['aws'])).toEqual([{ kind: 'create' }]);
  });

  it('skips an unknown dynamic slug without a name, or an unattached provider', () => {
    expect(decideAdds([{ serviceId: 'aws-hyperplane-db' }], kept, new Set(), ['aws'])).toEqual([{ kind: 'skip' }]);
    expect(
      decideAdds([{ serviceId: 'atlas-datalake', name: 'Atlas Data Lake' }], kept, new Set(), ['aws'])
    ).toEqual([{ kind: 'skip' }]);
  });

  it('merges a dynamic re-add into the existing dynamic node', () => {
    const withDynamic = [...kept, { nodeId: 'n-tx', serviceId: 'aws-textract' }];
    expect(
      decideAdds([{ serviceId: 'aws-textract', name: 'Textract' }], withDynamic, new Set(), ['aws'])
    ).toEqual([{ kind: 'merge', nodeId: 'n-tx' }]);
  });
});

describe('applyAddMerge', () => {
  it('increments the quantity field by the requested amount (default 1)', () => {
    const node = { serviceId: 'aws-ec2', config: { count: 2, instance: 'm5.large' } as ServiceConfig };
    applyAddMerge(node, { serviceId: 'aws-ec2' });
    expect(node.config.count).toBe(3);
    applyAddMerge(node, { serviceId: 'aws-ec2', config: { count: '4' } });
    expect(node.config.count).toBe(7);
  });

  it('treats a missing/invalid current quantity as 1', () => {
    const node = { serviceId: 'aws-ec2', config: {} as ServiceConfig };
    applyAddMerge(node, { serviceId: 'aws-ec2' });
    expect(node.config.count).toBe(2);
  });

  it('applies requested config in place for services with no quantity field', () => {
    const node = { serviceId: 'aws-s3', config: { storage: 500 } as ServiceConfig };
    applyAddMerge(node, { serviceId: 'aws-s3', config: { storage: '750' } });
    expect(node.config.storage).toBe('750');
  });

  it('is a no-op for a bare re-add of a no-quantity service', () => {
    const node = { serviceId: 'aws-s3', config: { storage: 500 } as ServiceConfig };
    applyAddMerge(node, { serviceId: 'aws-s3' });
    expect(node.config).toEqual({ storage: 500 });
  });
});
