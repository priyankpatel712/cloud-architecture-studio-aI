import { describe, expect, it } from 'vitest';
import { getProvider } from '@/lib/providers/registry';

describe('Pricing Accuracy Tests (SC-002 / T051)', () => {
  it('calculates AWS EC2 pricing within 5% of official on-demand benchmark', async () => {
    const aws = getProvider('aws');
    
    // Test case: m5.large instance in us-east-1, no storage, 1 count.
    // Official on-demand price for m5.large is $0.096 per hour.
    // Monthly calculation (730 hours): 0.096 * 730 = $70.08.
    const quote = await aws.pricing.estimate('aws-ec2', {
      instance: 'm5.large',
      count: 1,
      storage: 0,
      region: 'us-east-1'
    }, 'us-east-1');

    const expected = 0.096 * 730; // $70.08
    const diff = Math.abs(quote.monthly - expected);
    const pctDiff = (diff / expected) * 100;

    console.log(`[pricing:aws] EC2 m5.large quote: ${quote.monthly}, expected benchmark: ${expected}, diff: ${pctDiff.toFixed(2)}%`);
    expect(pctDiff).toBeLessThanOrEqual(5);
  });

  it('calculates AWS Lambda pricing within 5% of serverless benchmark', async () => {
    const aws = getProvider('aws');

    // Test case: 512MB memory, 2 million requests, 120ms duration.
    // Expected cost = requests * $0.20 + (requests * duration_sec * memory_gb) * $16.67
    // reqM = 2
    // gbSec = 0.5 * 0.12 * 2,000,000 = 120,000
    // computeCost = 120,000 * 0.0000166667 = $2.00
    // requestCost = 2 * 0.20 = $0.40
    // expectedTotal = $2.40
    const quote = await aws.pricing.estimate('aws-lambda', {
      memory: 512,
      requests: 2,
      duration: 120,
      region: 'us-east-1'
    }, 'us-east-1');

    const expected = 2.40;
    const diff = Math.abs(quote.monthly - expected);
    const pctDiff = (diff / expected) * 100;

    console.log(`[pricing:aws] Lambda quote: ${quote.monthly}, expected benchmark: ${expected}, diff: ${pctDiff.toFixed(2)}%`);
    expect(pctDiff).toBeLessThanOrEqual(5);
  });

  it('calculates AWS S3 pricing within 5% of storage benchmark', async () => {
    const aws = getProvider('aws');

    // Test case: 500GB storage in us-east-1.
    // Expected cost: 500 * $0.023 = $11.50
    const quote = await aws.pricing.estimate('aws-s3', {
      storage: 500,
      region: 'us-east-1'
    }, 'us-east-1');

    const expected = 11.50;
    const diff = Math.abs(quote.monthly - expected);
    const pctDiff = (diff / expected) * 100;

    console.log(`[pricing:aws] S3 quote: ${quote.monthly}, expected benchmark: ${expected}, diff: ${pctDiff.toFixed(2)}%`);
    expect(pctDiff).toBeLessThanOrEqual(5);
  });

  it('calculates MongoDB Atlas Cluster pricing within 5% of standard tier benchmark', async () => {
    const mongodb = getProvider('mongodb');

    // Test case: M30 tier, 3 replica nodes.
    // Expected cost: $388
    const quote = await mongodb.pricing.estimate('atlas-cluster', {
      tier: 'M30',
      nodes: 3,
      region: 'us-east-1'
    }, 'us-east-1');

    const expected = 388;
    const diff = Math.abs(quote.monthly - expected);
    const pctDiff = (diff / expected) * 100;

    console.log(`[pricing:mongodb] Atlas Cluster M30 quote: ${quote.monthly}, expected benchmark: ${expected}, diff: ${pctDiff.toFixed(2)}%`);
    expect(pctDiff).toBeLessThanOrEqual(5);
  });
});
