import { describe, expect, it } from 'vitest';
import { sanitizeEditScope, type IntentCanvas } from '@/lib/generate/intent';

/**
 * Feature 008 US1 — reference resolution against a seeded canvas (FR-004, FR-006).
 *
 * These exercise the resolution OUTCOMES the quickstart scenarios depend on,
 * using recorded resolver verdicts rather than live model calls, so they are
 * deterministic and run offline. The model's job is to propose candidates; what
 * is pinned here is what the system does with them — which is the part that
 * decides whether the user's work survives.
 */

/** The quickstart's starting architecture: one Lambda, one table, one cache. */
const singleOfEach: IntentCanvas = {
  nodes: [
    { nodeId: 'n1', serviceId: 'aws-lambda', displayName: 'OrderFn' },
    { nodeId: 'n2', serviceId: 'aws-dynamodb' },
    { nodeId: 'n3', serviceId: 'aws-elasticache' },
  ],
};

/** The ambiguous variant: a second Lambda added, as in quickstart scenario 5. */
const twoLambdas: IntentCanvas = {
  nodes: [
    { nodeId: 'n1', serviceId: 'aws-lambda', displayName: 'OrderFn' },
    { nodeId: 'n4', serviceId: 'aws-lambda', displayName: 'InvoiceFn' },
    { nodeId: 'n2', serviceId: 'aws-dynamodb' },
  ],
};

describe('single match — "that lambda"', () => {
  it('resolves a rename to the only Lambda', () => {
    const scope = sanitizeEditScope(
      { kind: 'rename', targets: [{ nodeId: 'n1', confidence: 0.95 }], freeform: 'OrderProcessor' },
      singleOfEach
    );
    expect(scope.kind).toBe('rename');
    expect(scope.targets).toEqual([{ nodeId: 'n1', confidence: 0.95 }]);
    expect(scope.freeform).toBe('OrderProcessor');
  });

  it('resolves a removal to the only cache', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n3', confidence: 0.92 }] },
      singleOfEach
    );
    expect(scope.kind).toBe('remove');
    expect(scope.targets.map((t) => t.nodeId)).toEqual(['n3']);
  });
});

describe('multi match — "the lambda" with two lambdas', () => {
  it('asks instead of picking when both are equally plausible', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n1', confidence: 0.8 }, { nodeId: 'n4', confidence: 0.8 }] },
      twoLambdas
    );
    expect(scope.kind).toBe('ambiguous');
    expect(scope.targets.map((t) => t.nodeId).sort()).toEqual(['n1', 'n4']);
  });

  it('proceeds once the conversation has disambiguated one of them', () => {
    // After the assistant asks and the user answers, the next resolution is
    // confident — this is why the clarifying question is worth asking.
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n4', confidence: 0.97 }, { nodeId: 'n1', confidence: 0.15 }] },
      twoLambdas
    );
    expect(scope.kind).toBe('remove');
    expect(scope.targets.map((t) => t.nodeId)).toEqual(['n4']);
  });
});

describe('no match — "the queue" when none exists', () => {
  it('becomes ambiguous rather than removing something adjacent', () => {
    const scope = sanitizeEditScope({ kind: 'remove', targets: [] }, singleOfEach);
    expect(scope.kind).toBe('ambiguous');
    expect(scope.targets).toEqual([]);
  });

  it('drops a hallucinated nodeId the canvas does not contain', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n-queue', confidence: 0.99 }] },
      singleOfEach
    );
    expect(scope.kind).toBe('ambiguous');
    expect(scope.targets).toEqual([]);
  });
});

describe('non-mutating kinds', () => {
  it('keeps a question as a question so the canvas is left alone', () => {
    const scope = sanitizeEditScope(
      { kind: 'question', freeform: 'why is there a NAT gateway?' },
      singleOfEach
    );
    expect(scope.kind).toBe('question');
    expect(scope.targets).toEqual([]);
  });

  it('keeps undo as undo so it is never treated as a redesign', () => {
    expect(sanitizeEditScope({ kind: 'undo' }, singleOfEach).kind).toBe('undo');
  });

  it('records an addition anchored to an existing node', () => {
    const scope = sanitizeEditScope(
      { kind: 'add', additions: [{ serviceHint: 'a queue', nearNodeId: 'n1' }], freeform: 'add a queue between the api and the worker' },
      singleOfEach
    );
    expect(scope.kind).toBe('add');
    expect(scope.additions).toEqual([{ serviceHint: 'a queue', nearNodeId: 'n1' }]);
  });
});
