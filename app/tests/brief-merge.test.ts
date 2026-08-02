import { describe, expect, it } from 'vitest';
import { mergeBrief, activeRequirements, type MergeableBrief } from '@/lib/generate/flow';

/**
 * Feature 008 US1 — cumulative requirement ledger (FR-002).
 *
 * Root cause R3: `runAnalyzeTurn` overwrites `flow.brief` wholesale every turn,
 * so a requirement stated in turn 1 silently disappears from the reviewer's
 * rubric by turn 3 and can no longer fail a review. These tests pin the merge
 * rule that fixes it — most importantly that a requirement absent from the
 * newest analysis is RETAINED, not dropped.
 */

const brief = (texts: string[], extra: Partial<MergeableBrief> = {}): MergeableBrief => ({
  requestText: '',
  requestClass: 'major_revision',
  capabilities: texts.map((text) => ({ text })),
  constraints: [],
  changeScope: [],
  selections: [],
  defaultsApplied: [],
  ...extra,
});

describe('mergeBrief — retention', () => {
  it('returns the new brief as-is when there is no prior brief', () => {
    const merged = mergeBrief(null, brief(['multi-region DR']), 1);
    expect(merged.capabilities.map((c) => c.text)).toEqual(['multi-region DR']);
    expect(merged.capabilities[0].status).toBe('pending');
    expect(merged.capabilities[0].firstSeenTurn).toBe(1);
  });

  it('RETAINS an earlier requirement the new analysis did not mention', () => {
    // The whole point of the feature: turn 3 says "add a WAF" and says nothing
    // about DR, but DR was never withdrawn, so it must still be graded.
    const prev = mergeBrief(null, brief(['multi-region DR']), 1);
    const merged = mergeBrief(prev, brief(['WAF protection']), 3);
    expect(merged.capabilities.map((c) => c.text).sort()).toEqual([
      'WAF protection',
      'multi-region DR',
    ]);
  });

  it('preserves firstSeenTurn across merges', () => {
    const t1 = mergeBrief(null, brief(['multi-region DR']), 1);
    const t2 = mergeBrief(t1, brief(['multi-region DR', 'WAF protection']), 2);
    const t3 = mergeBrief(t2, brief(['caching']), 3);
    const byText = Object.fromEntries(t3.capabilities.map((c) => [c.text, c]));
    expect(byText['multi-region DR'].firstSeenTurn).toBe(1);
    expect(byText['WAF protection'].firstSeenTurn).toBe(2);
    expect(byText['caching'].firstSeenTurn).toBe(3);
  });

  it('does not duplicate a repeated requirement, ignoring case and padding', () => {
    const prev = mergeBrief(null, brief(['Multi-Region DR']), 1);
    const merged = mergeBrief(prev, brief(['  multi-region dr  ']), 2);
    expect(merged.capabilities).toHaveLength(1);
    expect(merged.capabilities[0].firstSeenTurn).toBe(1);
  });

  it('keeps a met requirement met when it reappears', () => {
    const prev = mergeBrief(null, brief(['caching']), 1);
    prev.capabilities[0].status = 'met';
    const merged = mergeBrief(prev, brief(['caching']), 2);
    expect(merged.capabilities[0].status).toBe('met');
  });
});

describe('mergeBrief — withdrawal', () => {
  it('marks a requirement withdrawn only on explicit withdrawal', () => {
    const prev = mergeBrief(null, brief(['caching', 'multi-region DR']), 1);
    const merged = mergeBrief(prev, brief(['multi-region DR']), 2, { withdrawn: ['caching'] });
    const byText = Object.fromEntries(merged.capabilities.map((c) => [c.text, c]));
    expect(byText['caching'].status).toBe('withdrawn');
    expect(byText['multi-region DR'].status).toBe('pending');
  });

  it('excludes withdrawn requirements from the grading rubric', () => {
    const prev = mergeBrief(null, brief(['caching', 'multi-region DR']), 1);
    const merged = mergeBrief(prev, brief([]), 2, { withdrawn: ['caching'] });
    expect(activeRequirements(merged)).toEqual(['multi-region DR']);
  });

  it('revives a withdrawn requirement if the user asks for it again', () => {
    const prev = mergeBrief(null, brief(['caching']), 1);
    const withdrawn = mergeBrief(prev, brief([]), 2, { withdrawn: ['caching'] });
    const revived = mergeBrief(withdrawn, brief(['caching']), 3);
    expect(revived.capabilities[0].status).toBe('pending');
  });
});

describe('mergeBrief — other brief fields', () => {
  it('takes the newest requestText and requestClass', () => {
    const prev = mergeBrief(null, brief([], { requestText: 'build an api', requestClass: 'new' }), 1);
    const merged = mergeBrief(prev, brief([], { requestText: 'add a cache', requestClass: 'small_edit' }), 2);
    expect(merged.requestText).toBe('add a cache');
    expect(merged.requestClass).toBe('small_edit');
  });

  it('carries prior service selections forward', () => {
    // A service the user explicitly chose in turn 1 is still a build MUST.
    const prev = mergeBrief(
      null,
      brief([], { selections: [{ questionId: 'q1', need: 'cache', serviceId: 'aws-elasticache' }] }),
      1
    );
    const merged = mergeBrief(prev, brief([]), 2);
    expect(merged.selections).toEqual([{ questionId: 'q1', need: 'cache', serviceId: 'aws-elasticache' }]);
  });

  it('lets a newer selection for the same need supersede the older one', () => {
    const prev = mergeBrief(
      null,
      brief([], { selections: [{ questionId: 'q1', need: 'cache', serviceId: 'aws-elasticache' }] }),
      1
    );
    const merged = mergeBrief(
      prev,
      brief([], { selections: [{ questionId: 'q1', need: 'cache', serviceId: 'aws-memorydb' }] }),
      2
    );
    expect(merged.selections).toHaveLength(1);
    expect(merged.selections[0].serviceId).toBe('aws-memorydb');
  });

  it('unions constraints without duplicating', () => {
    const prev = mergeBrief(null, brief([], { constraints: ['eu-only'] }), 1);
    const merged = mergeBrief(prev, brief([], { constraints: ['eu-only', 'no serverless'] }), 2);
    expect(merged.constraints.sort()).toEqual(['eu-only', 'no serverless']);
  });

  it('uses the newest changeScope — scope is per-turn, not cumulative', () => {
    const prev = mergeBrief(null, brief([], { changeScope: ['n1'] }), 1);
    const merged = mergeBrief(prev, brief([], { changeScope: ['n2'] }), 2);
    expect(merged.changeScope).toEqual(['n2']);
  });
});
