import { describe, expect, it } from 'vitest';
import { sanitizeEditScope, type IntentCanvas } from '@/lib/generate/intent';

/**
 * Feature 008 US1 — EditScope sanitization (FR-003, FR-004, FR-006, FR-036).
 *
 * The intent resolver runs on a SMALL model, and structured-output enforcement
 * is documented-unreliable on the configured providers. So the model only ever
 * proposes; code disposes. The asymmetry that matters: a wrong classification
 * wastes one cheap call and falls back to today's path, but a wrong node
 * reference would silently delete the user's work. Every id is therefore
 * verified against the real canvas before it can become actionable.
 */

const canvas: IntentCanvas = {
  nodes: [
    { nodeId: 'n1', serviceId: 'aws-lambda', displayName: 'OrderFn' },
    { nodeId: 'n2', serviceId: 'aws-dynamodb' },
    { nodeId: 'n3', serviceId: 'aws-elasticache' },
  ],
};

describe('sanitizeEditScope — untrusted input', () => {
  it('coerces null, undefined, and non-objects to ambiguous', () => {
    for (const raw of [null, undefined, 42, 'remove it', [], true]) {
      expect(sanitizeEditScope(raw, canvas).kind).toBe('ambiguous');
    }
  });

  it('coerces an unknown kind to ambiguous', () => {
    expect(sanitizeEditScope({ kind: 'explode' }, canvas).kind).toBe('ambiguous');
  });

  it('always returns a fully-formed scope, never a partial object', () => {
    const scope = sanitizeEditScope({}, canvas);
    expect(Array.isArray(scope.targets)).toBe(true);
    expect(Array.isArray(scope.additions)).toBe(true);
    expect(typeof scope.freeform).toBe('string');
  });
});

describe('sanitizeEditScope — reference verification', () => {
  it('drops node ids that do not exist on the canvas', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n1', confidence: 0.9 }, { nodeId: 'ghost', confidence: 0.9 }] },
      canvas
    );
    expect(scope.targets.map((t) => t.nodeId)).toEqual(['n1']);
  });

  it('de-duplicates repeated targets, keeping the highest confidence', () => {
    const scope = sanitizeEditScope(
      { kind: 'rename', targets: [{ nodeId: 'n1', confidence: 0.4 }, { nodeId: 'n1', confidence: 0.95 }] },
      canvas
    );
    expect(scope.targets).toHaveLength(1);
    expect(scope.targets[0].confidence).toBe(0.95);
  });

  it('clamps out-of-range or non-numeric confidence into 0..1', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n1', confidence: 7 }, { nodeId: 'n2', confidence: 'high' }] },
      canvas
    );
    for (const t of scope.targets) {
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('becomes ambiguous when a target-requiring kind resolves to nothing', () => {
    // "remove the cache" when no cache exists must not fall through to a guess.
    for (const kind of ['remove', 'rename', 'reconfigure'] as const) {
      const scope = sanitizeEditScope({ kind, targets: [{ nodeId: 'ghost', confidence: 1 }] }, canvas);
      expect(scope.kind, `${kind} with no valid target`).toBe('ambiguous');
    }
  });

  it('becomes ambiguous when two targets are comparably confident (FR-006)', () => {
    // Two Lambdas and "remove the lambda" — ask, never pick one at random.
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n1', confidence: 0.8 }, { nodeId: 'n2', confidence: 0.78 }] },
      canvas
    );
    expect(scope.kind).toBe('ambiguous');
    expect(scope.targets).toHaveLength(2);
  });

  it('keeps a single-target kind when one candidate clearly wins', () => {
    const scope = sanitizeEditScope(
      { kind: 'remove', targets: [{ nodeId: 'n1', confidence: 0.95 }, { nodeId: 'n2', confidence: 0.2 }] },
      canvas
    );
    expect(scope.kind).toBe('remove');
    expect(scope.targets.map((t) => t.nodeId)).toEqual(['n1']);
  });
});

describe('sanitizeEditScope — kinds that need no target', () => {
  it('keeps question, undo, and new without requiring targets', () => {
    for (const kind of ['question', 'undo', 'new'] as const) {
      expect(sanitizeEditScope({ kind }, canvas).kind).toBe(kind);
    }
  });

  it('keeps add and records requested additions', () => {
    const scope = sanitizeEditScope(
      { kind: 'add', additions: [{ serviceHint: 'a queue', nearNodeId: 'n1' }] },
      canvas
    );
    expect(scope.kind).toBe('add');
    expect(scope.additions).toEqual([{ serviceHint: 'a queue', nearNodeId: 'n1' }]);
  });

  it('drops a nearNodeId that does not exist but keeps the addition', () => {
    const scope = sanitizeEditScope(
      { kind: 'add', additions: [{ serviceHint: 'a queue', nearNodeId: 'ghost' }] },
      canvas
    );
    expect(scope.additions).toEqual([{ serviceHint: 'a queue' }]);
  });

  it('discards additions with no usable hint', () => {
    const scope = sanitizeEditScope({ kind: 'add', additions: [{}, { serviceHint: '' }, 3] }, canvas);
    expect(scope.additions).toEqual([]);
  });
});

describe('sanitizeEditScope — freeform', () => {
  it('keeps freeform text and caps its length', () => {
    const scope = sanitizeEditScope({ kind: 'add', freeform: 'x'.repeat(5000) }, canvas);
    expect(scope.freeform.length).toBeLessThanOrEqual(1000);
  });

  it('defaults freeform to an empty string when absent or non-string', () => {
    expect(sanitizeEditScope({ kind: 'add' }, canvas).freeform).toBe('');
    expect(sanitizeEditScope({ kind: 'add', freeform: 12 }, canvas).freeform).toBe('');
  });
});

describe('sanitizeEditScope — empty canvas', () => {
  it('treats any edit against an empty canvas as a new design', () => {
    const empty: IntentCanvas = { nodes: [] };
    for (const kind of ['remove', 'rename', 'reconfigure', 'add'] as const) {
      expect(sanitizeEditScope({ kind }, empty).kind).toBe('new');
    }
  });
});
