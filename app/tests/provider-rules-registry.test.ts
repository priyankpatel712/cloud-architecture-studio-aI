import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { allProviderRules, allProviders } from '@/lib/providers/registry';
import { CORE_RULES } from '@/lib/knowledge/core-rules';
import { KNOWLEDGE_CONTENT_MAX } from '@/lib/knowledge/types';

/**
 * Feature 008 US3 — provider rules live in provider plugins (FR-038;
 * constitution Principle II).
 *
 * Principle II requires that adding a provider be achievable by implementing a
 * provider plugin, never by editing core application logic. An earlier draft of
 * this feature put every rule — including CloudFront, Cognito, WAF — in a core
 * `knowledge/seed-rules.ts`, which would have meant adding Azure required
 * touching core. `/speckit-analyze` flagged that as a CRITICAL violation.
 *
 * This test is the guard against it coming back: core rules must stay
 * vendor-neutral, and every vendor rule must arrive through the registry.
 */

const VENDOR_TERMS = [
  'cloudfront', 'lambda', 'dynamodb', 'cognito', 'cloudwatch', 'route 53', 'kms', 'waf',
  's3', 'rds', 'sqs', 'elasticache', 'atlas', 'ec2', 'vpc',
];

describe('core rules stay provider-agnostic', () => {
  it('names no vendor service', () => {
    for (const rule of CORE_RULES) {
      const text = `${rule.title} ${rule.content}`.toLowerCase();
      for (const term of VENDOR_TERMS) {
        expect(text.includes(term), `core rule "${rule.title}" mentions "${term}" — move it to that provider's plugin`).toBe(false);
      }
    }
  });

  it('does not import from any provider plugin', () => {
    const src = readFileSync(new URL('../src/lib/knowledge/core-rules.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '@\/lib\/providers\/(aws|mongodb|system)\//);
  });
});

describe('every provider contributes its rules through the registry', () => {
  it('exposes rules for each registered provider', () => {
    for (const plugin of allProviders()) {
      expect(Array.isArray(plugin.rules), `${plugin.id} has no rules array`).toBe(true);
      expect(plugin.rules.length, `${plugin.id} contributes no rules`).toBeGreaterThan(0);
    }
  });

  it('tags each collected rule with its owning provider', () => {
    const collected = allProviderRules();
    expect(collected.length).toBeGreaterThan(0);
    for (const { provider, seed } of collected) {
      expect(['aws', 'mongodb', 'system']).toContain(provider);
      expect(seed.title.length).toBeGreaterThan(0);
    }
  });

  it('collects AWS rules from the AWS plugin, not from core', () => {
    const awsRules = allProviderRules().filter((r) => r.provider === 'aws');
    expect(awsRules.length).toBeGreaterThan(0);
    // The vendor-specific knowledge exists — it simply lives in the plugin.
    const text = awsRules.map((r) => r.seed.content.toLowerCase()).join(' ');
    expect(text).toMatch(/cloudfront|api gateway|cognito|cloudwatch/);
  });

  it('adding a provider would need no core edit', () => {
    // The seeding path reads CORE_RULES plus the registry. A new plugin with a
    // `rules` array is therefore picked up automatically, with no per-provider
    // name anywhere in the seeding code.
    const seedModule = readFileSync(new URL('../src/lib/knowledge/seed.ts', import.meta.url), 'utf8');
    expect(seedModule).toContain('allProviderRules');
    expect(seedModule).not.toMatch(/AWS_RULES|MONGODB_RULES|SYSTEM_RULES/);
  });

  it('the CLI and the admin reseed endpoint share one implementation', () => {
    // Two copies of "seeding" would drift, and the drift shows up as rules that
    // exist on one deployment and not another with nothing in the diff to say why.
    const seedScript = readFileSync(new URL('../scripts/seed-knowledge.mjs', import.meta.url), 'utf8');
    const reseedRoute = readFileSync(
      new URL('../src/app/api/settings/knowledge/reseed/route.ts', import.meta.url),
      'utf8'
    );
    expect(seedScript).toContain('reseedKnowledge');
    expect(reseedRoute).toContain('reseedKnowledge');
  });
});

describe('all seeded rules fit the injection budget', () => {
  it('keeps every rule within the content cap', () => {
    const all = [...CORE_RULES, ...allProviderRules().map((r) => r.seed)];
    for (const rule of all) {
      expect(rule.content.length, `"${rule.title}" exceeds the content cap`).toBeLessThanOrEqual(KNOWLEDGE_CONTENT_MAX);
      expect(rule.keywords.length, `"${rule.title}" has no keywords and can never be retrieved`).toBeGreaterThan(0);
    }
  });
});
