import { describe, expect, it } from 'vitest';
import {
  FORMAT_RULE_LIMIT,
  describeRule,
  evaluateFormatRules,
  sanitizeFormatRules,
} from '@/lib/canvas/conditional-format';
import type { FormatRule } from '@/lib/canvas/model';

/**
 * Conditional formatting engine (Lucid-parity data linking) — pure rule
 * evaluation over live node data, first match wins.
 */

const rule = (over: Partial<FormatRule>): FormatRule => ({
  ruleId: 'r1',
  field: 'cost',
  op: 'gt',
  value: '100',
  accent: 'warning',
  ...over,
});

const subject = (over: Partial<Parameters<typeof evaluateFormatRules>[0]> = {}) => ({
  cost: 0,
  serviceId: 'aws-lambda',
  provider: 'aws',
  category: 'Compute',
  displayName: 'API handlers',
  ...over,
});

describe('evaluateFormatRules', () => {
  it('numeric ops compare cost', () => {
    expect(evaluateFormatRules(subject({ cost: 150 }), [rule({})])).toBe('warning');
    expect(evaluateFormatRules(subject({ cost: 100 }), [rule({})])).toBeNull();
    expect(evaluateFormatRules(subject({ cost: 100 }), [rule({ op: 'gte' })])).toBe('warning');
    expect(evaluateFormatRules(subject({ cost: 40 }), [rule({ op: 'lt', value: '50', accent: 'success' })])).toBe('success');
  });

  it('string ops are case-insensitive across provider/category/serviceId/name', () => {
    expect(evaluateFormatRules(subject(), [rule({ field: 'provider', op: 'eq', value: 'AWS', accent: 'primary' })])).toBe('primary');
    expect(evaluateFormatRules(subject(), [rule({ field: 'category', op: 'contains', value: 'comp', accent: 'success' })])).toBe('success');
    expect(evaluateFormatRules(subject(), [rule({ field: 'serviceId', op: 'neq', value: 'aws-s3', accent: 'danger' })])).toBe('danger');
    expect(evaluateFormatRules(subject(), [rule({ field: 'name', op: 'contains', value: 'handler', accent: 'primary' })])).toBe('primary');
  });

  it('first matching rule wins, in stored order', () => {
    const rules = [
      rule({ ruleId: 'a', field: 'provider', op: 'eq', value: 'aws', accent: 'primary' }),
      rule({ ruleId: 'b', field: 'cost', op: 'gt', value: '0', accent: 'danger' }),
    ];
    expect(evaluateFormatRules(subject({ cost: 500 }), rules)).toBe('primary');
  });

  it('never matches on unparsable numeric comparisons or empty string values', () => {
    expect(evaluateFormatRules(subject(), [rule({ value: 'abc' })])).toBeNull();
    expect(evaluateFormatRules(subject(), [rule({ field: 'provider', op: 'contains', value: '' })])).toBeNull();
    expect(evaluateFormatRules(subject(), [])).toBeNull();
  });
});

describe('sanitizeFormatRules', () => {
  it('accepts valid rules, coerces numeric values to strings, drops garbage', () => {
    const out = sanitizeFormatRules([
      { ruleId: 'x', field: 'cost', op: 'gt', value: 100, accent: 'warning' },
      { field: 'provider', op: 'eq', value: 'aws', accent: 'primary' }, // missing ruleId → generated
      { field: 'nope', op: 'eq', value: 'aws', accent: 'primary' }, // bad field
      { field: 'cost', op: 'gt', value: '1', accent: 'default' }, // accent must not be default
      'junk',
      null,
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ ruleId: 'x', value: '100' });
    expect(out[1].ruleId).toBeTruthy();
  });

  it('caps at the rule limit and handles non-arrays', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ruleId: `r${i}`, field: 'cost', op: 'gt', value: `${i}`, accent: 'warning' }));
    expect(sanitizeFormatRules(many)).toHaveLength(FORMAT_RULE_LIMIT);
    expect(sanitizeFormatRules(undefined)).toEqual([]);
    expect(sanitizeFormatRules('x')).toEqual([]);
  });
});

describe('describeRule', () => {
  it('renders the human one-liner', () => {
    expect(describeRule(rule({}))).toBe('Monthly cost ($) > 100');
    expect(describeRule(rule({ field: 'provider', op: 'eq', value: 'mongodb' }))).toBe('Provider is mongodb');
  });
});
