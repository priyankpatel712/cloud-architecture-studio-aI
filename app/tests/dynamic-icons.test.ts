import { describe, expect, it } from 'vitest';
import { officialAwsIcon } from '@/lib/providers/aws/icons';
import { resolveServiceDef } from '@/lib/catalog';

/**
 * Dynamic official-icon resolution + service synthesis (follow-up to 003:
 * AI-added services render official icons/colors without catalog entries).
 */

describe('officialAwsIcon', () => {
  it('resolves official icons from display names and slug ids', () => {
    expect(officialAwsIcon('Route 53')?.url).toBe('/icons/aws/svc/AmazonRoute53.svg');
    expect(officialAwsIcon('aws-eventbridge')?.url).toBe('/icons/aws/svc/AmazonEventBridge.svg');
    expect(officialAwsIcon('Redshift')?.url).toBe('/icons/aws/svc/AmazonRedshift.svg');
  });

  it('returns the official color with the icon', () => {
    expect(officialAwsIcon('AWS Lambda')?.color).toBe('#ed7100');
  });

  it('returns null when nothing plausibly matches', () => {
    expect(officialAwsIcon('definitely-not-a-real-service-xyz')).toBeNull();
  });
});

describe('resolveServiceDef (dynamic)', () => {
  it('returns the curated def when one exists', () => {
    expect(resolveServiceDef('aws-lambda').name).toBe('Lambda');
  });

  it('synthesizes a def with official icon, editable monthlyCost, and name', () => {
    // Textract is deliberately NOT in the curated catalog — it exercises the
    // dynamic-service synthesis path. (Route 53 was promoted to the catalog.)
    const def = resolveServiceDef('aws-textract', { displayName: 'Textract', category: 'Machine Learning' });
    expect(def.name).toBe('Textract');
    expect(def.iconUrl).toBe('/icons/aws/svc/AmazonTextract.svg');
    expect(def.fields.map((f) => f.key)).toEqual(['monthlyCost']);
    expect(def.estimate({ monthlyCost: '42.5' })).toBe(42.5);
    expect(def.quantityField).toBeUndefined();
  });

  it('returns the curated def for services promoted into the catalog', () => {
    const def = resolveServiceDef('aws-route53');
    expect(def.name).toBe('Route 53');
    expect(def.iconUrl).toBe('/icons/aws/svc/AmazonRoute53.svg');
    expect(def.fields.map((f) => f.key)).toEqual(['zones', 'queries']);
  });
});
