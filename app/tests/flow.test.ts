import { describe, expect, it } from 'vitest';
import {
  briefContext,
  defaultsDisclosure,
  describeResponse,
  findInvalidAnswer,
  mergeResolvedRound,
  newInteractionId,
  openInteraction,
  resolveQuestions,
  type Interaction,
  type RequirementBrief,
  type ValidationQuestion,
} from '@/lib/generate/flow';

/**
 * Guided-flow state machine helpers (feature 006 T005/T010/T018 — data-model.md
 * §1–2/§4). Pure module — no mocks needed.
 */

const serviceQuestion: ValidationQuestion = {
  id: 'q1',
  prompt: 'Which database?',
  why: 'A datastore is needed but none was named.',
  kind: 'service_choice',
  need: 'primary datastore',
  skippable: true,
  options: [
    { id: 'q1o1', label: 'DynamoDB', detail: 'Serverless, pay-per-request', serviceId: 'aws-dynamodb', recommended: true },
    { id: 'q1o2', label: 'EC2 self-managed', detail: 'Full control, more ops work', serviceId: 'aws-ec2', recommended: false },
  ],
};
const textQuestion: ValidationQuestion = {
  id: 'q2',
  prompt: 'Expected monthly users?',
  why: 'Sizing depends on it.',
  kind: 'text',
  skippable: true,
  options: [],
};

const emptyBrief: RequirementBrief = {
  requestText: 'an online shop',
  requestClass: 'new',
  capabilities: [{ id: 'c1', text: 'user accounts', source: 'stated' }],
  scaleAssumptions: [],
  constraints: [],
  changeScope: [],
  selections: [],
  defaultsApplied: [],
};

describe('findInvalidAnswer (contracts §1 validation)', () => {
  const interaction: Interaction = { id: 'ix1', kind: 'clarify', status: 'open', questions: [serviceQuestion, textQuestion], options: [] };

  it('accepts known question/option ids', () => {
    expect(findInvalidAnswer(interaction, [{ questionId: 'q1', optionId: 'q1o2' }, { questionId: 'q2', text: '100' }])).toBeNull();
  });
  it('rejects an unknown questionId', () => {
    expect(findInvalidAnswer(interaction, [{ questionId: 'q9', text: 'x' }])).toContain('q9');
  });
  it('rejects an unknown optionId', () => {
    expect(findInvalidAnswer(interaction, [{ questionId: 'q1', optionId: 'nope' }])).toContain('nope');
  });
});

describe('resolveQuestions (FR-004/FR-006 — every question ends answered or skipped)', () => {
  it('resolves answered, explicitly-skipped, and MISSING answers (missing → skipped)', () => {
    const resolved = resolveQuestions([serviceQuestion, textQuestion], [{ questionId: 'q1', optionId: 'q1o2' }], false);
    expect(resolved[0].resolution).toEqual({ kind: 'answered', optionId: 'q1o2' });
    expect(resolved[1].resolution).toEqual({ kind: 'skipped' });
  });

  it('skipAll resolves everything as skipped regardless of answers', () => {
    const resolved = resolveQuestions([serviceQuestion, textQuestion], [{ questionId: 'q1', optionId: 'q1o2' }], true);
    expect(resolved.every((q) => q.resolution?.kind === 'skipped')).toBe(true);
  });

  it('an answer with neither option nor non-empty text resolves as skipped', () => {
    const resolved = resolveQuestions([textQuestion], [{ questionId: 'q2', text: '   ' }], false);
    expect(resolved[0].resolution).toEqual({ kind: 'skipped' });
  });

  it('never mutates the input questions', () => {
    const before = JSON.stringify(serviceQuestion);
    resolveQuestions([serviceQuestion], [{ questionId: 'q1', optionId: 'q1o1' }], false);
    expect(JSON.stringify(serviceQuestion)).toBe(before);
  });
});

describe('mergeResolvedRound (data-model §1 — brief building)', () => {
  it('an ANSWERED service choice becomes an explicit selection (FR-008 MUST), no default disclosed', () => {
    const resolved = resolveQuestions([serviceQuestion], [{ questionId: 'q1', optionId: 'q1o2' }], false);
    const brief = mergeResolvedRound(emptyBrief, resolved);
    expect(brief.selections).toEqual([{ questionId: 'q1', need: 'primary datastore', serviceId: 'aws-ec2' }]);
    expect(brief.defaultsApplied).toHaveLength(0);
  });

  it('a SKIPPED service choice selects the recommended candidate and discloses it (FR-004)', () => {
    const resolved = resolveQuestions([serviceQuestion], [], true);
    const brief = mergeResolvedRound(emptyBrief, resolved);
    expect(brief.selections).toEqual([{ questionId: 'q1', need: 'primary datastore', serviceId: 'aws-dynamodb' }]);
    expect(brief.defaultsApplied.join(' ')).toContain('DynamoDB');
  });

  it('an answered text question lands as an "answered" scale assumption; a skipped one as a disclosed default', () => {
    const resolved = resolveQuestions([textQuestion, { ...textQuestion, id: 'q3', prompt: 'Growth?' }], [{ questionId: 'q2', text: '10k users' }], false);
    const brief = mergeResolvedRound(emptyBrief, resolved);
    expect(brief.scaleAssumptions).toEqual([
      { key: 'Expected monthly users?', value: '10k users', source: 'answered' },
      { key: 'Growth?', value: 'MVP-scale default', source: 'defaulted' },
    ]);
    expect(brief.defaultsApplied).toHaveLength(1);
    expect(defaultsDisclosure(brief)).toContain('Growth?');
  });

  it('never mutates the input brief', () => {
    const before = JSON.stringify(emptyBrief);
    mergeResolvedRound(emptyBrief, resolveQuestions([serviceQuestion], [], true));
    expect(JSON.stringify(emptyBrief)).toBe(before);
  });
});

describe('briefContext (T011/T012 condensation)', () => {
  it('carries capabilities, selections, assumptions (with default flag), and changeScope', () => {
    const brief: RequirementBrief = {
      ...emptyBrief,
      changeScope: ['n1'],
      scaleAssumptions: [
        { key: 'Users', value: '10k', source: 'answered' },
        { key: 'Growth', value: 'MVP-scale default', source: 'defaulted' },
      ],
      constraints: ['eu-west-1 only'],
      selections: [{ questionId: 'q1', need: 'datastore', serviceId: 'aws-dynamodb' }],
    };
    const ctx = briefContext(brief);
    expect(ctx.capabilities).toEqual(['user accounts']);
    expect(ctx.selectedServiceIds).toEqual(['aws-dynamodb']);
    expect(ctx.changeScope).toEqual(['n1']);
    expect(ctx.assumptions).toContain('Users: 10k');
    expect(ctx.assumptions).toContain('Growth: MVP-scale default (defaulted)');
    expect(ctx.assumptions).toContain('eu-west-1 only');
  });
});

describe('interaction lifecycle', () => {
  it('openInteraction opens with status open and a fresh id', () => {
    const a = openInteraction('clarify', [serviceQuestion]);
    const b = openInteraction('clarify', [serviceQuestion]);
    expect(a.status).toBe('open');
    expect(a.id).not.toBe(b.id);
    expect(newInteractionId()).not.toBe(a.id);
  });

  it('describeResponse renders a readable thread line for pure option-click responses (FR-006)', () => {
    const interaction = openInteraction('clarify', [serviceQuestion, textQuestion]);
    const text = describeResponse(interaction, [{ questionId: 'q1', optionId: 'q1o1' }], false);
    expect(text).toContain('Which database? → DynamoDB');
    expect(text).toContain('Expected monthly users? → (skipped)');
    expect(describeResponse(interaction, [], true)).toContain('defaults');

    const optionsRound: Interaction = {
      id: 'ix2', kind: 'cost_options', status: 'open', questions: [],
      options: [{ id: 'cheapest', label: 'Cheapest (budget)', summary: '', monthly: 10, indicative: true, perService: [], patches: [], degraded: false }],
    };
    expect(describeResponse(optionsRound, [], false, 'cheapest')).toContain('Cheapest (budget)');
    expect(describeResponse(optionsRound, [], true)).toContain('current configuration');
  });
});
