import { describe, expect, it } from 'vitest';
import {
  documentToFlow,
  flowToDocument,
  isHandleSide,
  HANDLE_SIDES,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  type ArchDocument,
} from '@/lib/canvas/model';
import { copyToClipboard, pasteFromClipboard } from '@/lib/canvas/clipboard';
import { serviceEdgeSchema } from '@/lib/schemas';
import type { Edge, Node } from '@xyflow/react';

/**
 * Any-side connection handles (canvas). Service nodes now expose a handle on
 * every side, which forces one invariant this file exists to pin: EVERY edge
 * entering React Flow carries explicit handle ids. With four handles per node,
 * an edge without ids would leave the library to pick a side — and the picked
 * side would silently differ from what years of saved documents and every
 * AI-generated edge have always rendered as (out the right, in the left).
 */

const doc = (edge: Partial<ArchDocument['edges'][number]>): ArchDocument => ({
  nodes: [
    { nodeId: 'a', serviceId: 'aws-lambda', provider: 'aws', position: { x: 0, y: 0 }, config: {}, cost: 0 },
    { nodeId: 'b', serviceId: 'aws-s3', provider: 'aws', position: { x: 300, y: 0 }, config: {}, cost: 0 },
  ],
  edges: [{ edgeId: 'e1', source: 'a', target: 'b', ...edge }],
  containers: [],
  annotations: [],
});

describe('loading a document (documentToFlow)', () => {
  it('defaults legacy edges to right → left — exactly where the old two handles sat', () => {
    const { edges } = documentToFlow(doc({}));
    expect(edges[0].sourceHandle).toBe(DEFAULT_SOURCE_HANDLE);
    expect(edges[0].targetHandle).toBe(DEFAULT_TARGET_HANDLE);
  });

  it('honours stored sides', () => {
    const { edges } = documentToFlow(doc({ sourceHandle: 'bottom', targetHandle: 'top' }));
    expect(edges[0].sourceHandle).toBe('bottom');
    expect(edges[0].targetHandle).toBe('top');
  });

  it('coerces an unrecognised stored side to the default instead of passing junk to React Flow', () => {
    const { edges } = documentToFlow(doc({ sourceHandle: 'middle' as never }));
    expect(edges[0].sourceHandle).toBe(DEFAULT_SOURCE_HANDLE);
  });
});

describe('saving the canvas (flowToDocument)', () => {
  const meta = () => ({ provider: 'aws' as const, category: 'compute' });
  const nodes: Node[] = [
    { id: 'a', type: 'service', position: { x: 0, y: 0 }, data: { serviceId: 'aws-lambda', config: {}, cost: 0 } },
  ];

  it('persists the sides the user connected', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'a', sourceHandle: 'top', targetHandle: 'bottom' }];
    const out = flowToDocument(nodes, edges, meta);
    expect(out.edges[0].sourceHandle).toBe('top');
    expect(out.edges[0].targetHandle).toBe('bottom');
  });

  it('omits absent or unknown handle ids so the save schema never sees junk', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'a' },
      { id: 'e2', source: 'a', target: 'a', sourceHandle: 'weird-id', targetHandle: null },
    ];
    const out = flowToDocument(nodes, edges, meta);
    expect('sourceHandle' in out.edges[0]).toBe(false);
    expect('sourceHandle' in out.edges[1]).toBe(false);
    expect('targetHandle' in out.edges[1]).toBe(false);
  });

  it('round-trips: save → load preserves every side', () => {
    for (const side of HANDLE_SIDES) {
      const { edges } = documentToFlow(doc({ sourceHandle: side, targetHandle: side }));
      const saved = flowToDocument(documentToFlow(doc({ sourceHandle: side, targetHandle: side })).nodes, edges, meta);
      expect(saved.edges[0].sourceHandle).toBe(side);
      expect(saved.edges[0].targetHandle).toBe(side);
    }
  });
});

describe('save schema (PUT /architecture boundary)', () => {
  const base = { edgeId: 'e1', source: 'a', target: 'b' };

  it('accepts every side and accepts absence — legacy documents must keep validating', () => {
    expect(serviceEdgeSchema.safeParse(base).success).toBe(true);
    for (const side of HANDLE_SIDES) {
      expect(serviceEdgeSchema.safeParse({ ...base, sourceHandle: side, targetHandle: side }).success).toBe(true);
    }
  });

  it('rejects a fabricated side', () => {
    expect(serviceEdgeSchema.safeParse({ ...base, sourceHandle: 'center' }).success).toBe(false);
  });
});

describe('clipboard', () => {
  it('a pasted edge attaches to the same sides as the original', () => {
    copyToClipboard(
      [
        { id: 'a', type: 'service', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'service', position: { x: 100, y: 0 }, data: {} },
      ],
      [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' }]
    );
    const { edges } = pasteFromClipboard(1);
    expect(edges[0].sourceHandle).toBe('bottom');
    expect(edges[0].targetHandle).toBe('top');
  });
});

describe('side vocabulary', () => {
  it('recognises exactly the four sides', () => {
    for (const side of HANDLE_SIDES) expect(isHandleSide(side)).toBe(true);
    for (const junk of ['center', '', null, undefined, 1]) expect(isHandleSide(junk)).toBe(false);
  });
});
