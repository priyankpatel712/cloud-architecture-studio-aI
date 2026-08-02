import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchNode } from '@/lib/generate/orchestrator';

/**
 * Cost dialogue engine (feature 006 T020/T021/T024 — FR-009–FR-011, research
 * D5). The LLM boundary is mocked; pricing runs for real through the provider
 * adapters' offline catalog fallback (same pattern as agent-loop.test.ts), so
 * clamping and deterministic pricing are exercised end to end.
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

const {
  sanitizeCostQuestions,
  generateCostQuestions,
  generatePricingOptions,
  applyOptionToNodes,
  detectSwitchIntent,
  CHEAPEST_ID,
  BEST_PRACTICE_ID,
} = await import('@/lib/generate/cost-options');
const { COST_QUESTION_LIMIT } = await import('@/lib/generate/loop-config');

beforeAll(() => {
  delete process.env.AWS_MCP_COMMAND;
  delete process.env.AWS_COST_MCP_COMMAND;
  delete process.env.MONGODB_MCP_COMMAND;
});

beforeEach(() => {
  llmJsonMock.mockReset();
  llmAvailableValue = true;
});

const ec2Node: ArchNode = {
  nodeId: 'n1', serviceId: 'aws-ec2', provider: 'aws', category: 'Compute',
  position: { x: 0, y: 0 }, config: { instance: 'm5.large', count: 2, storage: 100, region: 'us-east-1' },
  cost: 150, costBasis: 'indicative',
};
const lambdaNode: ArchNode = {
  nodeId: 'n2', serviceId: 'aws-lambda', provider: 'aws', category: 'Compute',
  position: { x: 200, y: 0 }, config: { memory: '512', requests: 2, duration: 120, region: 'us-east-1' },
  cost: 5, costBasis: 'indicative',
};

describe('sanitizeCostQuestions (FR-009)', () => {
  it(`caps at COST_QUESTION_LIMIT (${COST_QUESTION_LIMIT}), drops broken selects, strips options from text`, () => {
    const raw = {
      questions: [
        { prompt: 'Usage?', why: '', kind: 'text', options: [{ label: 'stray' }] },
        { prompt: 'Broken?', why: '', kind: 'single_select', options: [{ label: 'one' }] },
        { prompt: 'Budget?', why: '', kind: 'single_select', options: [{ label: 'Tight' }, { label: 'Flexible' }] },
        { prompt: 'Growth?', why: '', kind: 'text' },
        { prompt: 'Extra?', why: '', kind: 'text' },
        { prompt: 'Overflow?', why: '', kind: 'text' },
      ],
    };
    const questions = sanitizeCostQuestions(raw);
    expect(questions.length).toBeLessThanOrEqual(COST_QUESTION_LIMIT);
    expect(questions.find((q) => q.prompt === 'Usage?')?.options).toHaveLength(0);
    expect(questions.some((q) => q.prompt === 'Broken?')).toBe(false);
    expect(questions.find((q) => q.prompt === 'Budget?')?.options).toHaveLength(2);
    expect(questions.every((q) => q.skippable)).toBe(true);
  });

  it('degraded mode (no LLM) asks nothing', async () => {
    llmAvailableValue = false;
    const questions = await generateCostQuestions({ nodes: [ec2Node], brief: null });
    expect(questions).toHaveLength(0);
    expect(llmJsonMock).not.toHaveBeenCalled();
  });
});

describe('generatePricingOptions (FR-010, research D5)', () => {
  it('prices LLM-planned patches deterministically and clamps out-of-bounds values', async () => {
    llmJsonMock.mockResolvedValueOnce({
      options: [
        // count: -5 violates the declared min 1 → clamped; instance downsized.
        { id: CHEAPEST_ID, summary: 'small', patches: [{ nodeId: 'n1', config: { instance: 't3.micro', count: '-5' } }] },
        { id: BEST_PRACTICE_ID, summary: 'right-sized', patches: [] },
      ],
    });
    const options = await generatePricingOptions({ nodes: [ec2Node, lambdaNode], defaultRegion: 'us-east-1', brief: null, costAnswers: [] });
    expect(options.map((o) => o.id)).toEqual([CHEAPEST_ID, BEST_PRACTICE_ID]);

    const cheapest = options[0];
    expect(cheapest.degraded).toBe(false);
    const patched = cheapest.patches.find((p) => p.nodeId === 'n1');
    expect(patched?.config.instance).toBe('t3.micro');
    expect(String(patched?.config.count)).toBe('1'); // clamped to the declared min
    // Engine-priced, never LLM figures: both totals are real numbers and cheapest ≤ best practice.
    expect(cheapest.monthly).toBeGreaterThan(0);
    expect(cheapest.monthly).toBeLessThan(options[1].monthly);
    expect(cheapest.perService).toHaveLength(2);
  });

  it('ignores patches for unknown nodeIds', async () => {
    llmJsonMock.mockResolvedValueOnce({
      options: [
        { id: CHEAPEST_ID, summary: '', patches: [{ nodeId: 'ghost', config: { count: '1' } }] },
        { id: BEST_PRACTICE_ID, summary: '', patches: [] },
      ],
    });
    const options = await generatePricingOptions({ nodes: [ec2Node], defaultRegion: 'us-east-1', brief: null, costAnswers: [] });
    expect(options[0].patches).toHaveLength(0);
  });

  it('a missing mandatory option is filled from the rule-based fallback and labelled degraded', async () => {
    llmJsonMock.mockResolvedValueOnce({
      options: [{ id: BEST_PRACTICE_ID, summary: 'as designed', patches: [] }],
    });
    const options = await generatePricingOptions({ nodes: [ec2Node], defaultRegion: 'us-east-1', brief: null, costAnswers: [] });
    expect(options.map((o) => o.id)).toEqual([CHEAPEST_ID, BEST_PRACTICE_ID]);
    expect(options.find((o) => o.id === CHEAPEST_ID)?.degraded).toBe(true);
    expect(options.find((o) => o.id === BEST_PRACTICE_ID)?.degraded).toBe(false);
  });

  it('an options-call failure degrades BOTH options (cheapest = declared minimums) instead of failing', async () => {
    llmJsonMock.mockRejectedValueOnce(new Error('boom'));
    const options = await generatePricingOptions({ nodes: [ec2Node], defaultRegion: 'us-east-1', brief: null, costAnswers: [] });
    expect(options.map((o) => o.id)).toEqual([CHEAPEST_ID, BEST_PRACTICE_ID]);
    expect(options.every((o) => o.degraded)).toBe(true);
    const cheapest = options[0];
    const patch = cheapest.patches.find((p) => p.nodeId === 'n1');
    expect(String(patch?.config.count)).toBe('1'); // declared min
    expect(cheapest.monthly).toBeLessThanOrEqual(options[1].monthly);
  });
});

describe('applyOptionToNodes (FR-011 — config-only by construction)', () => {
  it('merges patches onto matching nodes (clamped) and leaves others untouched', () => {
    const next = applyOptionToNodes([ec2Node, lambdaNode], { patches: [{ nodeId: 'n1', config: { count: '0' } }] });
    expect(next).toHaveLength(2); // never structural
    expect(String(next[0].config.count)).toBe('1'); // clamped to min 1
    expect(next[0].config.instance).toBe('m5.large'); // untouched keys preserved
    expect(next[1]).toBe(lambdaNode); // unpatched node passes through by reference
  });
});

describe('detectSwitchIntent (FR-011 — deterministic, no LLM)', () => {
  const options = [{ id: CHEAPEST_ID }, { id: BEST_PRACTICE_ID }];

  it.each([
    ['switch to the best practice option', BEST_PRACTICE_ID],
    ['please use the cheapest option', CHEAPEST_ID],
    ['go with best-practice', BEST_PRACTICE_ID],
    ['apply the budget configuration', CHEAPEST_ID],
  ])('"%s" → %s', (text, expected) => {
    expect(detectSwitchIntent(text, options)).toBe(expected);
  });

  it.each([
    'add a cache in front of the database',
    'make it cheaper somehow', // "cheaper" is a redesign ask, not the named option
    'what does best practice mean here?'.replace('best practice', 'that'), // no option named
  ])('no switch intent: "%s"', (text) => {
    expect(detectSwitchIntent(text, options)).toBeNull();
  });

  it('returns null when no options are stored', () => {
    expect(detectSwitchIntent('switch to the cheapest option', [])).toBeNull();
  });
});
