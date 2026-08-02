import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Analyze phase (feature 006 T009/T017/T029 - FR-001..FR-003, FR-013, research
 * D2-D4). `sanitizeAnalysis` is exercised directly (pure); `interpretResponse`
 * runs against the mocked LLM boundary like agent-loop.test.ts.
 */

const llmJsonMock = vi.fn();
let llmAvailableValue = true;

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    llmAvailable: () => llmAvailableValue,
    llmJson: (opts: unknown) => llmJsonMock(opts),
  };
});

const { sanitizeAnalysis, interpretResponse } = await import('@/lib/generate/analyze');
const { QUESTION_LIMIT } = await import('@/lib/generate/loop-config');

beforeEach(() => {
  llmJsonMock.mockReset();
  llmAvailableValue = true;
});

const baseOpts = { existingNodeIds: new Set<string>(), hasCanvas: false, activeTools: ['aws' as const] };

const serviceChoice = (options: { label: string; serviceId?: string; recommended?: boolean; detail?: string }[]) => ({
  prompt: 'Which database?',
  why: 'The request needs a datastore but does not name one.',
  kind: 'service_choice',
  need: 'primary datastore',
  options,
});

describe('sanitizeAnalysis', () => {
  describe('request classifier backstops (D4, FR-013)', () => {
    it('forces requestClass to "new" on an empty canvas, even when the model says small_edit', () => {
      const result = sanitizeAnalysis({ summary: 's', requestClass: 'small_edit', capabilities: [], questions: [] }, baseOpts);
      expect(result.requestClass).toBe('new');
    });

    it('degrades an invalid/missing class to major_revision when a canvas exists (ask-before-acting default)', () => {
      const result = sanitizeAnalysis(
        { summary: 's', requestClass: 'banana', capabilities: [], questions: [] },
        { ...baseOpts, hasCanvas: true, existingNodeIds: new Set(['n1']) }
      );
      expect(result.requestClass).toBe('major_revision');
    });

    it('keeps a valid small_edit classification on an existing canvas', () => {
      const result = sanitizeAnalysis(
        { summary: 's', requestClass: 'small_edit', capabilities: [], questions: [] },
        { ...baseOpts, hasCanvas: true, existingNodeIds: new Set(['n1']) }
      );
      expect(result.requestClass).toBe('small_edit');
    });
  });

  describe('service-choice candidate validation (D3, FR-003)', () => {
    it('drops candidates with no resolvable provider and candidates of unattached providers', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [serviceChoice([
          { label: 'DynamoDB', serviceId: 'aws-dynamodb', recommended: true },
          { label: 'Made up', serviceId: 'imaginary-db' }, // no provider prefix - unresolvable
          { label: 'Atlas', serviceId: 'atlas-cluster' }, // mongodb not attached
          { label: 'EC2 self-managed', serviceId: 'aws-ec2' },
        ])],
      };
      const result = sanitizeAnalysis(raw, baseOpts);
      const q = result.questions[0];
      const ids = q.options.map((o) => o.serviceId);
      expect(ids).toContain('aws-dynamodb');
      expect(ids).toContain('aws-ec2');
      expect(ids).not.toContain('atlas-cluster');
      expect(ids).not.toContain('imaginary-db');
      expect(ids.length).toBe(2);
    });

    it('dedupes candidates by serviceId and caps at 4', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [serviceChoice([
          { label: 'A', serviceId: 'aws-dynamodb', recommended: true },
          { label: 'A again', serviceId: 'aws-dynamodb' },
          { label: 'B', serviceId: 'aws-ec2' },
          { label: 'C', serviceId: 'aws-s3' },
          { label: 'D', serviceId: 'aws-lambda' },
          { label: 'E', serviceId: 'aws-sqs' },
        ])],
      };
      const q = sanitizeAnalysis(raw, baseOpts).questions[0];
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options.map((o) => o.serviceId)).size).toBe(4);
    });

    it('collapses a single surviving candidate to a confirmation note instead of a forced menu (spec edge case)', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [serviceChoice([
          { label: 'DynamoDB', serviceId: 'aws-dynamodb', recommended: true },
          { label: 'Atlas', serviceId: 'atlas-cluster' }, // dropped - unattached
        ])],
      };
      const result = sanitizeAnalysis(raw, baseOpts);
      expect(result.questions).toHaveLength(0);
      expect(result.collapsedChoices).toHaveLength(1);
      expect(result.collapsedChoices[0]).toContain('DynamoDB');
    });

    it('enforces exactly one recommended candidate (none flagged -> the first)', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [serviceChoice([
          { label: 'A', serviceId: 'aws-dynamodb' },
          { label: 'B', serviceId: 'aws-ec2' },
        ])],
      };
      const q = sanitizeAnalysis(raw, baseOpts).questions[0];
      expect(q.options.filter((o) => o.recommended)).toHaveLength(1);
      expect(q.options[0].recommended).toBe(true);
    });

    it('enforces exactly one recommended candidate (multiple flagged -> the first flagged wins)', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [serviceChoice([
          { label: 'A', serviceId: 'aws-dynamodb' },
          { label: 'B', serviceId: 'aws-ec2', recommended: true },
          { label: 'C', serviceId: 'aws-s3', recommended: true },
        ])],
      };
      const q = sanitizeAnalysis(raw, baseOpts).questions[0];
      expect(q.options.filter((o) => o.recommended)).toHaveLength(1);
      expect(q.options.find((o) => o.recommended)?.serviceId).toBe('aws-ec2');
    });
  });

  describe('question bounds and shapes (FR-002)', () => {
    it(`caps the round at QUESTION_LIMIT (${QUESTION_LIMIT})`, () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: Array.from({ length: QUESTION_LIMIT + 3 }, (_, i) => ({ prompt: `Q${i}?`, why: '', kind: 'text' })),
      };
      expect(sanitizeAnalysis(raw, baseOpts).questions).toHaveLength(QUESTION_LIMIT);
    });

    it('drops a single_select with fewer than 2 options and strips options from text questions', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [
          { prompt: 'Broken select?', kind: 'single_select', why: '', options: [{ label: 'only one' }] },
          { prompt: 'Open question?', kind: 'text', why: '', options: [{ label: 'stray option' }] },
        ],
      };
      const result = sanitizeAnalysis(raw, baseOpts);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].kind).toBe('text');
      expect(result.questions[0].options).toHaveLength(0);
    });

    it('marks every question skippable and assigns stable ids', () => {
      const raw = {
        summary: 's', requestClass: 'new', capabilities: [],
        questions: [{ prompt: 'A?', kind: 'text', why: '' }, { prompt: 'B?', kind: 'text', why: '' }],
      };
      const result = sanitizeAnalysis(raw, baseOpts);
      expect(result.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
      expect(result.questions.every((q) => q.skippable)).toBe(true);
    });
  });

  it('filters changeScope to existing nodeIds', () => {
    const raw = {
      summary: 's', requestClass: 'major_revision', capabilities: [], questions: [],
      changeScope: ['n1', 'ghost'],
    };
    const result = sanitizeAnalysis(raw, { ...baseOpts, hasCanvas: true, existingNodeIds: new Set(['n1', 'n2']) });
    expect(result.changeScope).toEqual(['n1']);
  });
});

describe('interpretResponse (research D8)', () => {
  const questions = [
    { id: 'q1', prompt: 'Which database?', why: '', kind: 'service_choice' as const, need: 'datastore', skippable: true as const,
      options: [
        { id: 'q1o1', label: 'DynamoDB', detail: '', serviceId: 'aws-dynamodb', recommended: true },
        { id: 'q1o2', label: 'EC2 self-managed', detail: '', serviceId: 'aws-ec2', recommended: false },
      ] },
    { id: 'q2', prompt: 'Expected users?', why: '', kind: 'text' as const, options: [], skippable: true as const },
  ];

  it('maps interpreted answers onto the open questions by exact ids', async () => {
    llmJsonMock.mockResolvedValueOnce({
      mode: 'answers',
      answers: [{ questionId: 'q1', optionId: 'q1o2' }, { questionId: 'q2', text: 'about 100' }],
    });
    const outcome = await interpretResponse({ text: 'self managed please, around 100 users', questions, originalRequest: 'an app' });
    expect(outcome).toEqual({ kind: 'answers', skipAll: false, answers: [
      { questionId: 'q1', optionId: 'q1o2' },
      { questionId: 'q2', text: 'about 100' },
    ] });
  });

  it('drops answers with unknown question/option ids; nothing left -> request_change (never guesses)', async () => {
    llmJsonMock.mockResolvedValueOnce({
      mode: 'answers',
      answers: [{ questionId: 'q9', optionId: 'q1o1' }, { questionId: 'q1', optionId: 'nope' }],
    });
    const outcome = await interpretResponse({ text: 'hmm', questions, originalRequest: 'an app' });
    expect(outcome.kind).toBe('request_change');
  });

  it('"just build it" style replies come back as skip-all', async () => {
    llmJsonMock.mockResolvedValueOnce({ mode: 'skip_all' });
    const outcome = await interpretResponse({ text: 'just build it', questions, originalRequest: 'an app' });
    expect(outcome).toEqual({ kind: 'answers', answers: [], skipAll: true });
  });

  it('a detected contradiction yields ONE targeted follow-up (spec edge case)', async () => {
    llmJsonMock.mockResolvedValueOnce({ mode: 'conflict', followUpQuestion: 'You picked the cheapest DB but need ACID transactions - which matters more?' });
    const outcome = await interpretResponse({ text: 'cheapest DB, and it must have multi-doc ACID', questions, originalRequest: 'an app' });
    expect(outcome.kind).toBe('followup');
    if (outcome.kind === 'followup') expect(outcome.question).toContain('ACID');
  });

  it('interpretation failure degrades to request_change (safe re-analyze default)', async () => {
    llmJsonMock.mockRejectedValueOnce(new Error('boom'));
    const outcome = await interpretResponse({ text: 'whatever', questions, originalRequest: 'an app' });
    expect(outcome.kind).toBe('request_change');
  });

  it('degraded mode (no LLM) -> request_change', async () => {
    llmAvailableValue = false;
    const outcome = await interpretResponse({ text: 'answer', questions, originalRequest: 'an app' });
    expect(outcome.kind).toBe('request_change');
    expect(llmJsonMock).not.toHaveBeenCalled();
  });
});
