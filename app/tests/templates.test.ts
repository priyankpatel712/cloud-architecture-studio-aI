import { describe, expect, it } from 'vitest';
import { DIAGRAM_TEMPLATES } from '@/lib/canvas/templates';
import { serviceById } from '@/lib/catalog';
import { architecturePutSchema } from '@/lib/schemas';

/**
 * Starter templates (Lucid-parity gallery) — every template must be a valid,
 * catalog-grounded, save-compatible document, or the gallery ships broken
 * starting points.
 */

describe('DIAGRAM_TEMPLATES', () => {
  it('has unique template ids and per-template unique node/edge ids', () => {
    const ids = DIAGRAM_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of DIAGRAM_TEMPLATES) {
      const nodeIds = t.doc.nodes.map((n) => n.nodeId);
      const edgeIds = t.doc.edges.map((e) => e.edgeId);
      expect(new Set(nodeIds).size, t.id).toBe(nodeIds.length);
      expect(new Set(edgeIds).size, t.id).toBe(edgeIds.length);
    }
  });

  it('uses only real catalog services, with the correct provider', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      for (const n of t.doc.nodes) {
        const def = serviceById(n.serviceId);
        expect(def, `${t.id}: unknown serviceId '${n.serviceId}'`).toBeTruthy();
        expect(def!.provider, `${t.id}: ${n.serviceId} provider mismatch`).toBe(n.provider);
      }
    }
  });

  it('every edge connects two nodes that exist in the same template', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      const nodeIds = new Set(t.doc.nodes.map((n) => n.nodeId));
      for (const e of t.doc.edges) {
        expect(nodeIds.has(e.source), `${t.id}: edge ${e.edgeId} dangling source`).toBe(true);
        expect(nodeIds.has(e.target), `${t.id}: edge ${e.edgeId} dangling target`).toBe(true);
      }
    }
  });

  it('every template document passes the architecture save schema', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      const parsed = architecturePutSchema.safeParse({ ...t.doc, version: 1 });
      expect(parsed.success, `${t.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues[0])}`).toBe(true);
    }
  });

  it('nodes carry hand-placed, non-overlapping positions (no arrange pass needed)', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      const seen = new Set<string>();
      for (const n of t.doc.nodes) {
        const key = `${n.position.x},${n.position.y}`;
        expect(seen.has(key), `${t.id}: two nodes share position ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
});
