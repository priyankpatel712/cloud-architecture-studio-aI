import { describe, expect, it } from 'vitest';
import { sanitizeVerdict, MAX_REFINEMENT_INSTRUCTIONS_LENGTH } from '@/lib/generate/reviewer';

/**
 * Verdict sanitization (feature 004 data-model.md ReviewVerdict rules): the
 * self-review's JSON is untrusted output (same NIM guided_json unreliability
 * as sanitizePlan) — coerce/drop malformed fields, never let a bad verdict
 * shape crash the loop.
 */
describe('sanitizeVerdict', () => {
  it('passes a well-formed verdict through intact', () => {
    const verdict = sanitizeVerdict({
      pass: true,
      unmetCapabilities: [],
      refinementInstructions: '',
    });
    expect(verdict).toEqual({ pass: true, unmetCapabilities: [], refinementInstructions: '', coverage: [] });
  });

  it('sanitizes per-requirement coverage entries and drops malformed ones', () => {
    const verdict = sanitizeVerdict({
      pass: false,
      unmetCapabilities: [],
      refinementInstructions: '',
      coverage: [
        { requirement: 'a REST API', met: true, evidence: 'n1: aws-apigw', gap: '' },
        { requirement: 'a WAF', met: 'yes', evidence: 42, gap: null },
        { requirement: '   ', met: true, evidence: '', gap: '' },
        'junk',
        { met: true },
      ],
    });
    expect(verdict.coverage).toEqual([
      { requirement: 'a REST API', met: true, evidence: 'n1: aws-apigw', gap: '' },
      { requirement: 'a WAF', met: false, evidence: '', gap: '' },
    ]);
  });

  it('defaults coverage to an empty array when malformed or absent', () => {
    for (const junk of [undefined, null, 'text', 42, {}]) {
      expect(sanitizeVerdict({ pass: true, coverage: junk }).coverage).toEqual([]);
    }
  });

  it('coerces a non-boolean pass to false', () => {
    for (const junk of ['true', 1, null, undefined, {}, []]) {
      expect(sanitizeVerdict({ pass: junk }).pass).toBe(false);
    }
  });

  it('drops non-string entries from unmetCapabilities', () => {
    const verdict = sanitizeVerdict({
      pass: false,
      unmetCapabilities: ['WAF', 42, null, { nested: true }, 'multi-region DR'],
    });
    expect(verdict.unmetCapabilities).toEqual(['WAF', 'multi-region DR']);
  });

  it('defaults unmetCapabilities to an empty array when malformed', () => {
    for (const junk of ['text', 42, null, undefined, {}]) {
      expect(sanitizeVerdict({ unmetCapabilities: junk }).unmetCapabilities).toEqual([]);
    }
  });

  it('truncates refinementInstructions beyond the max length', () => {
    const long = 'x'.repeat(MAX_REFINEMENT_INSTRUCTIONS_LENGTH + 500);
    const verdict = sanitizeVerdict({ refinementInstructions: long });
    expect(verdict.refinementInstructions).toHaveLength(MAX_REFINEMENT_INSTRUCTIONS_LENGTH);
  });

  it('defaults refinementInstructions to empty string when malformed', () => {
    for (const junk of [42, null, undefined, {}, []]) {
      expect(sanitizeVerdict({ refinementInstructions: junk }).refinementInstructions).toBe('');
    }
  });

  it('survives completely wrong top-level shapes', () => {
    for (const junk of [null, undefined, 'text', 42, []]) {
      const verdict = sanitizeVerdict(junk);
      expect(verdict).toEqual({ pass: false, unmetCapabilities: [], refinementInstructions: '', coverage: [] });
    }
  });
});
