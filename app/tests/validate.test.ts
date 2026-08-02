import { describe, expect, it } from 'vitest';
import { validateArchitecture } from '@/lib/generate/validate';

/**
 * Structural validation gate (feature 004 FR-010; research R6): every edge
 * endpoint resolves to a node, container parents are acyclic and exist, and
 * every node carries a valid non-negative price.
 */
describe('validateArchitecture', () => {
  it('passes a well-formed architecture with no gaps', () => {
    const gaps = validateArchitecture(
      [{ nodeId: 'n1', serviceId: 'aws-lambda', cost: 10 }, { nodeId: 'n2', serviceId: 'aws-s3', cost: 5 }],
      [{ source: 'n1', target: 'n2' }],
      []
    );
    expect(gaps).toEqual([]);
  });

  it('flags an edge referencing a missing node', () => {
    const gaps = validateArchitecture(
      [{ nodeId: 'n1', serviceId: 'aws-lambda', cost: 10 }],
      [{ source: 'n1', target: 'ghost' }],
      []
    );
    expect(gaps.some((g) => g.includes('ghost'))).toBe(true);
  });

  it('flags a node with no valid price', () => {
    const gaps = validateArchitecture(
      [{ nodeId: 'n1', serviceId: 'aws-lambda', cost: Number.NaN }],
      [],
      []
    );
    expect(gaps.some((g) => g.includes('aws-lambda') && g.includes('price'))).toBe(true);
  });

  it('flags a node assigned to a missing container', () => {
    const gaps = validateArchitecture(
      [{ nodeId: 'n1', serviceId: 'aws-lambda', cost: 10, containerId: 'missing' }],
      [],
      []
    );
    expect(gaps.some((g) => g.includes('aws-lambda'))).toBe(true);
  });

  it('flags a container with a missing parent', () => {
    const gaps = validateArchitecture([], [], [{ containerId: 'c1', type: 'vpc', parentContainerId: 'ghost' }]);
    expect(gaps.some((g) => g.includes('parent'))).toBe(true);
  });

  it('flags a container nesting cycle', () => {
    const gaps = validateArchitecture(
      [],
      [],
      [
        { containerId: 'c1', type: 'vpc', parentContainerId: 'c2' },
        { containerId: 'c2', type: 'subnet', parentContainerId: 'c1' },
      ]
    );
    expect(gaps.some((g) => g.includes('cycle'))).toBe(true);
  });
});
