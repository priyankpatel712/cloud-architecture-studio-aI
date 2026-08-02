import { describe, expect, it } from 'vitest';
import { applyDirectEdit, type DirectEditArch } from '@/lib/generate/direct-edit';
import type { EditScope } from '@/lib/generate/intent';

/**
 * Feature 008 US1 — deterministic fast path (FR-005, FR-039, SC-003).
 *
 * A rename or a single-node removal does not need an architecture-design model.
 * Running the full plan loop for one costs seconds and a large-model request
 * against a tight per-minute budget. This executor applies such edits with no
 * LLM at all — but it must leave the diagram in exactly the state the design
 * loop would have: no dangling edges, no empty containers, config inside its
 * declared bounds, and costs recomputed.
 */

function arch(): DirectEditArch {
  return {
    nodes: [
      { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws', position: { x: 0, y: 0 }, config: { requests: '1' }, containerId: 'c1', displayName: 'OrderFn' },
      { nodeId: 'n2', serviceId: 'aws-dynamodb', provider: 'aws', position: { x: 200, y: 0 }, config: {}, containerId: 'c1' },
      { nodeId: 'n3', serviceId: 'aws-elasticache', provider: 'aws', position: { x: 400, y: 0 }, config: {}, containerId: 'c2' },
    ],
    edges: [
      { edgeId: 'e1', source: 'n1', target: 'n2' },
      { edgeId: 'e2', source: 'n1', target: 'n3' },
    ],
    containers: [
      { containerId: 'c1', type: 'vpc', label: 'Main VPC' },
      { containerId: 'c2', type: 'vpc', label: 'Cache VPC' },
    ],
    annotations: [],
  };
}

const scope = (partial: Partial<EditScope>): EditScope => ({
  kind: 'remove',
  targets: [],
  additions: [],
  freeform: '',
  ...partial,
});

describe('applyDirectEdit — rename', () => {
  it('changes only the display name', () => {
    const before = arch();
    const res = applyDirectEdit(
      scope({ kind: 'rename', targets: [{ nodeId: 'n1', confidence: 1 }], freeform: 'OrderProcessor' }),
      before
    );
    expect(res.applied).toBe(true);
    expect(res.arch.nodes.find((n) => n.nodeId === 'n1')?.displayName).toBe('OrderProcessor');
    expect(res.arch.nodes).toHaveLength(3);
    expect(res.arch.edges).toHaveLength(2);
    expect(res.editsApplied.join(' ')).toContain('renamed');
  });

  it('leaves every other node untouched', () => {
    const before = arch();
    const res = applyDirectEdit(
      scope({ kind: 'rename', targets: [{ nodeId: 'n1', confidence: 1 }], freeform: 'NewName' }),
      before
    );
    expect(res.arch.nodes.filter((n) => n.nodeId !== 'n1')).toEqual(
      before.nodes.filter((n) => n.nodeId !== 'n1')
    );
  });

  it('refuses a rename with no new name rather than clearing the label', () => {
    const res = applyDirectEdit(
      scope({ kind: 'rename', targets: [{ nodeId: 'n1', confidence: 1 }], freeform: '' }),
      arch()
    );
    expect(res.applied).toBe(false);
  });
});

describe('applyDirectEdit — remove', () => {
  it('removes the node and every edge that referenced it', () => {
    const res = applyDirectEdit(scope({ kind: 'remove', targets: [{ nodeId: 'n1', confidence: 1 }] }), arch());
    expect(res.applied).toBe(true);
    expect(res.arch.nodes.map((n) => n.nodeId)).toEqual(['n2', 'n3']);
    expect(res.arch.edges).toEqual([]);
  });

  it('removes a container left with no children', () => {
    // n3 is the only occupant of c2 — an empty container is a seeded house rule
    // violation, so the fast path must not create one.
    const res = applyDirectEdit(scope({ kind: 'remove', targets: [{ nodeId: 'n3', confidence: 1 }] }), arch());
    expect(res.arch.containers.map((c) => c.containerId)).toEqual(['c1']);
  });

  it('keeps a container that still has children', () => {
    const res = applyDirectEdit(scope({ kind: 'remove', targets: [{ nodeId: 'n1', confidence: 1 }] }), arch());
    expect(res.arch.containers.map((c) => c.containerId)).toContain('c1');
  });

  it('removes several targets at once', () => {
    const res = applyDirectEdit(
      scope({ kind: 'remove', targets: [{ nodeId: 'n2', confidence: 1 }, { nodeId: 'n3', confidence: 1 }] }),
      arch()
    );
    expect(res.arch.nodes.map((n) => n.nodeId)).toEqual(['n1']);
    expect(res.arch.edges).toEqual([]);
  });
});

describe('applyDirectEdit — reconfigure and clamping (FR-039)', () => {
  it('applies a single config field change', () => {
    const res = applyDirectEdit(
      scope({ kind: 'reconfigure', targets: [{ nodeId: 'n1', confidence: 1 }], configPatch: { requests: '5' } }),
      arch()
    );
    expect(res.applied).toBe(true);
    expect(res.arch.nodes.find((n) => n.nodeId === 'n1')?.config.requests).toBe('5');
  });

  it('clamps an absurd value to the field bounds instead of pricing it', () => {
    // Constitution cost-realism: an AI-edited config must be clamped, or a unit
    // mistake inflates the estimate by orders of magnitude.
    const res = applyDirectEdit(
      scope({ kind: 'reconfigure', targets: [{ nodeId: 'n1', confidence: 1 }], configPatch: { requests: '999999999' } }),
      arch()
    );
    expect(res.applied).toBe(true);
    const value = Number(res.arch.nodes.find((n) => n.nodeId === 'n1')?.config.requests);
    expect(value).toBeLessThan(999999999);
  });

  it('recomputes cost for a reconfigured node', () => {
    const res = applyDirectEdit(
      scope({ kind: 'reconfigure', targets: [{ nodeId: 'n1', confidence: 1 }], configPatch: { requests: '5' } }),
      arch()
    );
    expect(typeof res.arch.nodes.find((n) => n.nodeId === 'n1')?.cost).toBe('number');
  });

  it('refuses a reconfigure with no patch', () => {
    const res = applyDirectEdit(
      scope({ kind: 'reconfigure', targets: [{ nodeId: 'n1', confidence: 1 }] }),
      arch()
    );
    expect(res.applied).toBe(false);
  });
});

describe('applyDirectEdit — refusal contract', () => {
  it('returns applied:false and an untouched architecture for unsupported kinds', () => {
    const before = arch();
    for (const kind of ['new', 'add', 'question', 'undo', 'ambiguous', 'restyle'] as const) {
      const res = applyDirectEdit(scope({ kind, targets: [{ nodeId: 'n1', confidence: 1 }] }), before);
      expect(res.applied, `${kind} must not use the fast path`).toBe(false);
      expect(res.arch).toEqual(before);
    }
  });

  it('refuses when there are no targets', () => {
    const res = applyDirectEdit(scope({ kind: 'remove', targets: [] }), arch());
    expect(res.applied).toBe(false);
  });

  it('refuses when a target does not exist on the canvas', () => {
    const res = applyDirectEdit(scope({ kind: 'remove', targets: [{ nodeId: 'ghost', confidence: 1 }] }), arch());
    expect(res.applied).toBe(false);
  });

  it('never mutates the architecture it was given', () => {
    const before = arch();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyDirectEdit(scope({ kind: 'remove', targets: [{ nodeId: 'n1', confidence: 1 }] }), before);
    expect(before).toEqual(snapshot);
  });
});
