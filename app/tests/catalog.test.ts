import { describe, expect, it } from 'vitest';
import { clampToFieldBounds, serviceById } from '@/lib/catalog';

/**
 * Cost realism (Clarification 2026-07-09): `unit: 'M'` catalog fields (requests,
 * writes, etc.) are already denominated in millions/mo. An AI-planned config that
 * plugs in a raw request count (e.g. 1_000_000 meant as 1,000,000 requests, not
 * 1,000,000 million/mo) must be clamped before it inflates the estimate ~1e6x.
 */
describe('clampToFieldBounds', () => {
  it('clamps a millions-unit field given a raw request count', () => {
    const apigw = serviceById('aws-apigw')!;
    const out = clampToFieldBounds(apigw, { requests: '1000000', region: 'us-east-1' });
    expect(Number(out.requests)).toBeLessThanOrEqual(10_000);
    expect(out.region).toBe('us-east-1');
  });

  it('leaves a realistic millions-unit value unchanged', () => {
    const apigw = serviceById('aws-apigw')!;
    const out = clampToFieldBounds(apigw, { requests: '5', region: 'us-east-1' });
    expect(out.requests).toBe('5');
  });

  it('respects an explicit field min/max over the millions ceiling', () => {
    const fargate = serviceById('aws-fargate')!;
    const out = clampToFieldBounds(fargate, { tasks: '-3' });
    expect(Number(out.tasks)).toBe(1);
  });

  it('passes through non-numeric and unrelated fields untouched', () => {
    const rds = serviceById('aws-rds')!;
    const out = clampToFieldBounds(rds, { instance: 'db.t3.medium', multiaz: 'Yes' });
    expect(out).toEqual({ instance: 'db.t3.medium', multiaz: 'Yes' });
  });
});
