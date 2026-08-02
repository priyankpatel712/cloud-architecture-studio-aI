import { describe, expect, it } from 'vitest';
import {
  applyQuantityOverrides,
  mergeOverrides,
  quantityFieldOf,
  type OverrideRecord,
  type PricableNode,
  type PricedLine,
} from '@/lib/generate/overrides';

/**
 * Pure override merge/precedence/stale logic (003 T026; FR-008/FR-012,
 * Clarification 2026-07-07 "both allowed, quantity wins").
 */

const ec2Node: PricableNode = {
  nodeId: 'n1',
  serviceId: 'aws-ec2',
  provider: 'aws',
  config: { instance: 'm5.large', count: 2, storage: 100, region: 'us-east-1' },
};
const s3Node: PricableNode = {
  nodeId: 'n2',
  serviceId: 'aws-s3',
  provider: 'aws',
  config: { storage: 500, region: 'us-east-1' },
};

const line = (nodeId: string, serviceId: string, cost: number): PricedLine => ({
  nodeId,
  serviceId,
  cost,
  basis: 'indicative',
  region: 'us-east-1',
});

const override = (partial: Partial<OverrideRecord> & { nodeId: string }): OverrideRecord => ({
  quantityOverride: null,
  totalCostOverride: null,
  configSnapshot: {},
  ...partial,
});

describe('quantityFieldOf (003 R9)', () => {
  it('returns the declared quantity key for EC2 and null for S3', () => {
    expect(quantityFieldOf('aws-ec2')).toBe('count');
    expect(quantityFieldOf('aws-s3')).toBeNull();
    expect(quantityFieldOf('nope')).toBeNull();
  });
});

describe('applyQuantityOverrides (stage A)', () => {
  it('substitutes the overridden quantity into a COPY of the config', () => {
    const out = applyQuantityOverrides([ec2Node], [override({ nodeId: 'n1', quantityOverride: 5 })]);
    expect(out[0].config.count).toBe(5);
    expect(ec2Node.config.count).toBe(2); // input untouched (FR-015 decoupling)
  });

  it('ignores quantity overrides on services with no quantity field', () => {
    const out = applyQuantityOverrides([s3Node], [override({ nodeId: 'n2', quantityOverride: 9 })]);
    expect(out[0].config).toEqual(s3Node.config);
  });

  it('passes nodes without overrides through unchanged', () => {
    const out = applyQuantityOverrides([ec2Node, s3Node], []);
    expect(out).toEqual([ec2Node, s3Node]);
  });
});

describe('mergeOverrides (stage B)', () => {
  it('applies a total-cost override and recomputes totals', () => {
    const merged = mergeOverrides(
      [line('n1', 'aws-ec2', 218.24), line('n2', 'aws-s3', 11.5)],
      [override({ nodeId: 'n2', totalCostOverride: 99.5, configSnapshot: s3Node.config })],
      [ec2Node, s3Node]
    );
    const s3 = merged.perService.find((l) => l.nodeId === 'n2')!;
    expect(s3.cost).toBe(99.5);
    expect(s3.overridden).toBe(true);
    expect(s3.stale).toBe(false);
    expect(merged.monthly).toBe(Math.round((218.24 + 99.5) * 100) / 100);
    expect(merged.annual).toBe(Math.round(merged.monthly * 12 * 100) / 100);
  });

  it('quantity override wins over a total-cost override on the same line', () => {
    // stage A already priced n1 with the overridden quantity → 358.4
    const merged = mergeOverrides(
      [line('n1', 'aws-ec2', 358.4)],
      [override({ nodeId: 'n1', quantityOverride: 5, totalCostOverride: 1, configSnapshot: ec2Node.config })],
      [ec2Node]
    );
    expect(merged.perService[0].cost).toBe(358.4); // NOT 1
    expect(merged.perService[0].overridden).toBe(true);
  });

  it('flags a line stale when the live config differs from the snapshot (FR-012)', () => {
    const merged = mergeOverrides(
      [line('n1', 'aws-ec2', 218.24)],
      [
        override({
          nodeId: 'n1',
          totalCostOverride: 200,
          configSnapshot: { ...ec2Node.config, instance: 't3.micro' },
        }),
      ],
      [ec2Node]
    );
    expect(merged.perService[0].stale).toBe(true);
    expect(merged.perService[0].cost).toBe(200); // kept, not discarded
  });

  it('treats a record with both values null as no override', () => {
    const merged = mergeOverrides(
      [line('n1', 'aws-ec2', 218.24)],
      [override({ nodeId: 'n1' })],
      [ec2Node]
    );
    expect(merged.perService[0].overridden).toBe(false);
    expect(merged.perService[0].cost).toBe(218.24);
  });

  it('reports basis exact only when every line is exact', () => {
    const exact = { ...line('n1', 'aws-ec2', 100), basis: 'exact' as const };
    expect(mergeOverrides([exact], [], [ec2Node]).basis).toBe('exact');
    expect(mergeOverrides([exact, line('n2', 'aws-s3', 5)], [], [ec2Node, s3Node]).basis).toBe('indicative');
  });
});
