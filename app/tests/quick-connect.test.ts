import { describe, expect, it } from 'vitest';
import { suggestNextServices } from '@/lib/canvas/quick-connect';
import { serviceById } from '@/lib/catalog';

/** Quick-connect adjacency suggestions (007 roadmap 2.1). */
describe('suggestNextServices', () => {
  it('returns the curated next services for a known source, all resolvable in the catalog', () => {
    const s = suggestNextServices('aws-apigw');
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]).toBe('aws-lambda');
    for (const id of s) expect(serviceById(id)).toBeDefined();
  });

  it('suggests the data tier after a generic service, and Atlas add-ons after a cluster', () => {
    expect(suggestNextServices('sys-service')).toContain('sys-relational-db');
    expect(suggestNextServices('atlas-cluster')).toContain('atlas-search');
  });

  it('falls back to category defaults for a service with no explicit entry', () => {
    // aws-s3 (Storage) has no explicit NEXT entry — the Storage fallback applies.
    const s = suggestNextServices('aws-s3');
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain('aws-lambda');
  });

  it('never suggests the source itself, respects the limit, and dedupes', () => {
    for (const source of ['aws-lambda', 'sys-service', 'sys-controller']) {
      const s = suggestNextServices(source, 3);
      expect(s.length).toBeLessThanOrEqual(3);
      expect(s).not.toContain(source);
      expect(new Set(s).size).toBe(s.length);
    }
  });

  it('returns [] for an unknown serviceId', () => {
    expect(suggestNextServices('not-a-service')).toEqual([]);
  });
});
