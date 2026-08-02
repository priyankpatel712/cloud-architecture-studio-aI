import { describe, expect, it } from 'vitest';
import { getProvider, allProviders } from '@/lib/providers/registry';

describe('provider plugin registry (Constitution II)', () => {
  it('exposes complete plugins for aws, mongodb, and system', () => {
    for (const id of ['aws', 'mongodb', 'system'] as const) {
      const plugin = getProvider(id);
      expect(plugin.id).toBe(id);
      expect(plugin.label.length).toBeGreaterThan(0);
      expect(plugin.catalog.length).toBeGreaterThan(0);
      expect(typeof plugin.pricing.estimate).toBe('function');
      expect(typeof plugin.mcp.recommend).toBe('function');
    }
    expect(allProviders()).toHaveLength(3);
  });

  it('system provider: components are $0/exact, and guidance is the built-in design-principles brief', async () => {
    const system = getProvider('system');
    const quote = await system.pricing.estimate('sys-service', { tech: 'Node.js', instances: 3 }, 'us-east-1');
    expect(quote.monthly).toBe(0);
    expect(quote.basis).toBe('exact');
    const guidance = await system.mcp.recommend('design a url shortener', '');
    expect(guidance.official).toBe(true);
    expect(guidance.rawText).toContain('SYSTEM-DESIGN PRINCIPLES');
    expect(guidance.toolsInvoked).toEqual(['design-principles']);
  });

  it('keeps every catalog service scoped to its plugin', () => {
    for (const plugin of allProviders()) {
      for (const service of plugin.catalog) {
        expect(service.provider).toBe(plugin.id);
        expect(service.fields.length).toBeGreaterThan(0);
        expect(typeof service.estimate).toBe('function');
      }
    }
  });

  it('prices unknown/unofficial services as labelled indicative (FR-021)', async () => {
    // No AWS_COST_MCP_COMMAND and no official source for S3 → catalog estimate,
    // honestly marked indicative, in the requested region.
    delete process.env.AWS_COST_MCP_COMMAND;
    const quote = await getProvider('aws').pricing.estimate('aws-s3', { storage: '100' }, 'eu-west-1');
    expect(quote.basis).toBe('indicative');
    expect(quote.region).toBe('eu-west-1');
    expect(quote.monthly).toBeGreaterThan(0);
  });
});
