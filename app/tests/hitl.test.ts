import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_REMOVAL_THRESHOLD,
  buildApprovalQuestion,
  decisionFromAnswers,
  destructiveChangeCheckpoint,
  interpretApprovalReply,
  lowCoverageCheckpoint,
} from '@/lib/agent/hitl';
import { findInvalidAnswer, openInteraction } from '@/lib/generate/flow';

/**
 * Human-in-the-loop checkpoints (lib/agent/hitl.ts): the destructive-change
 * approval gate and the low-coverage escalation. Deterministic decision logic
 * only — the round persistence lives in the messages route.
 */

const node = (nodeId: string, serviceId = 'aws-lambda', displayName?: string) => ({ nodeId, serviceId, displayName });

describe('destructiveChangeCheckpoint', () => {
  it('never triggers on an empty canvas or an additive change', () => {
    expect(destructiveChangeCheckpoint([], [node('a')])).toBeNull();
    const before = [node('a'), node('b'), node('c'), node('d')];
    const after = [...before, node('e')];
    expect(destructiveChangeCheckpoint(before, after)).toBeNull();
  });

  it('tolerates routine 1–2 node replacements on a larger canvas', () => {
    const before = [node('a'), node('b'), node('c'), node('d'), node('e'), node('f')];
    const after = before.slice(2); // removes 2 of 6 — a routine refactor
    expect(DESTRUCTIVE_REMOVAL_THRESHOLD).toBe(3);
    expect(destructiveChangeCheckpoint(before, after)).toBeNull();
  });

  it('triggers at the absolute removal threshold and names the removed services', () => {
    const before = [node('a', 'aws-rds', 'orders db'), node('b', 'aws-sqs'), node('c', 'aws-waf'), node('d'), node('e'), node('f'), node('g')];
    const after = before.slice(3); // removes 3 of 7 (< half, ≥ threshold)
    const cp = destructiveChangeCheckpoint(before, after);
    expect(cp?.kind).toBe('destructive_change');
    expect(cp?.reason).toContain('remove 3 of 7');
    expect(cp?.reason).toContain('orders db');
    expect(cp?.prompt).toContain('Should I apply it?');
  });

  it('triggers on removing the strict majority of a small canvas even below the absolute threshold', () => {
    const before = [node('a'), node('b')];
    expect(destructiveChangeCheckpoint(before, [])?.kind).toBe('destructive_change'); // 2 of 2 — wipeout
    expect(destructiveChangeCheckpoint(before, [node('a')])).toBeNull(); // 1 of 2 — routine replacement
    const three = [node('a'), node('b'), node('c')];
    expect(destructiveChangeCheckpoint(three, [node('c')])?.kind).toBe('destructive_change'); // 2 of 3 — strict majority
  });
});

describe('lowCoverageCheckpoint', () => {
  it('is null at or above the target', () => {
    expect(lowCoverageCheckpoint(85, 85, [])).toBeNull();
    expect(lowCoverageCheckpoint(100, 85, [])).toBeNull();
  });

  it('escalates below the target with the gaps and the ways forward', () => {
    const cp = lowCoverageCheckpoint(60, 85, ['multi-AZ (no second AZ)', 'WAF']);
    expect(cp?.kind).toBe('low_coverage');
    expect(cp?.prompt).toContain('60%');
    expect(cp?.prompt).toContain('85%');
    expect(cp?.reason).toContain('multi-AZ');
  });
});

describe('approval round plumbing', () => {
  it('builds a question the existing round validation accepts', () => {
    const cp = destructiveChangeCheckpoint([node('a'), node('b'), node('c')], [])!;
    const q = buildApprovalQuestion(cp);
    const round = openInteraction('clarify', [q]);
    expect(findInvalidAnswer(round, [{ questionId: 'approval', optionId: 'approve' }])).toBeNull();
    expect(findInvalidAnswer(round, [{ questionId: 'approval', optionId: 'reject' }])).toBeNull();
    expect(findInvalidAnswer(round, [{ questionId: 'approval', optionId: 'maybe' }])).not.toBeNull();
    // Fail-safe default: keeping the diagram is the recommended option.
    expect(q.options.find((o) => o.recommended)?.id).toBe('reject');
  });

  it('resolves structured answers, with skip-all rejecting (fail safe)', () => {
    expect(decisionFromAnswers([{ questionId: 'approval', optionId: 'approve' }], false)).toBe('approve');
    expect(decisionFromAnswers([{ questionId: 'approval', optionId: 'reject' }], false)).toBe('reject');
    expect(decisionFromAnswers([], true)).toBe('reject');
    expect(decisionFromAnswers([], false)).toBe('unclear');
  });

  it('interprets clear free-text replies and refuses to guess otherwise', () => {
    expect(interpretApprovalReply('yes, go ahead')).toBe('approve');
    expect(interpretApprovalReply('Apply it')).toBe('approve');
    expect(interpretApprovalReply('no, keep the current diagram')).toBe('reject');
    expect(interpretApprovalReply("don't apply that")).toBe('reject');
    expect(interpretApprovalReply('actually, add a CDN instead')).toBe('unclear');
    expect(interpretApprovalReply('')).toBe('unclear');
  });
});
