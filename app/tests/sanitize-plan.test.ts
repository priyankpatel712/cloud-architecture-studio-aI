import { describe, expect, it } from 'vitest';
import { sanitizePlan } from '@/lib/generate/orchestrator';

/**
 * Plan sanitization (creation-flow reliability fix): guided_json is not
 * reliably enforced for reasoning models, so the plan is untrusted input —
 * malformed field types must be coerced or dropped, never crash apply.
 */
describe('sanitizePlan', () => {
  it('passes a well-formed plan through intact', () => {
    const plan = sanitizePlan({
      reply: 'ok',
      add: [{ serviceId: 'aws-lambda', config: { memory: '512' }, containerRef: 'c1' }],
      remove: ['n1'],
      update: [{ nodeId: 'n2', config: { count: '3' } }],
      edges: [{ source: 'new:0', target: 'n2', label: 'calls' }],
      guidance: { network: 'vpc' },
      containers: {
        add: [{ type: 'region', label: 'us-east-1' }],
        update: [{ containerId: 'c1', parentRef: null }],
        remove: ['c2'],
        assignMembers: [{ nodeId: 'n2', containerRef: null }],
      },
    });
    expect(plan.reply).toBe('ok');
    expect(plan.add).toEqual([
      { serviceId: 'aws-lambda', config: { memory: '512' }, containerRef: 'c1', name: undefined, category: undefined, monthlyCostUsd: undefined },
    ]);
    expect(plan.remove).toEqual(['n1']);
    expect(plan.update).toEqual([{ nodeId: 'n2', config: { count: '3' } }]);
    expect(plan.edges).toEqual([{ source: 'new:0', target: 'n2', label: 'calls' }]);
    expect(plan.containers?.update).toEqual([{ containerId: 'c1', label: undefined, type: undefined, parentRef: null }]);
    expect(plan.containers?.assignMembers).toEqual([{ nodeId: 'n2', containerRef: null }]);
  });

  it('survives completely wrong top-level shapes', () => {
    for (const junk of [null, undefined, 'text', 42, [], { add: 'nope', remove: {}, edges: 7, containers: [] }]) {
      const plan = sanitizePlan(junk);
      expect(plan.add).toEqual([]);
      expect(plan.remove).toEqual([]);
      expect(plan.edges).toEqual([]);
      expect(plan.unsatisfiable).toBe(false);
      expect(plan.reply.length).toBeGreaterThan(0);
    }
  });

  it('coerces numbers where strings were promised (name/containerRef/config/edges)', () => {
    const plan = sanitizePlan({
      reply: 'r',
      add: [{ serviceId: 'aws-route53', name: 53, category: 7, containerRef: 0, monthlyCostUsd: '25.5', config: { ttl: 300, dnssec: true, junk: { nested: 1 } } }],
      edges: [{ from: 0, to: 1 }],
    });
    expect(plan.add[0]).toEqual({
      serviceId: 'aws-route53', name: '53', category: '7', containerRef: '0',
      monthlyCostUsd: 25.5, config: { ttl: '300', dnssec: 'true' },
    });
    expect(plan.edges).toEqual([{ source: '0', target: '1' }]);
  });

  it('drops entries that cannot be repaired', () => {
    const plan = sanitizePlan({
      add: [null, 'string', { config: {} }, { serviceId: {} }],
      remove: [null, {}, ['x'], 'n1', 2],
      update: [{ nodeId: 'n1' }, { config: { a: 'b' } }, 'junk'],
      edges: [{ source: 'a' }, { target: 'b' }, null],
      containers: { add: [{}, null], update: [{}], assignMembers: [{ containerRef: 'c1' }], remove: 'x' },
    });
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual(['n1', '2']);
    expect(plan.update).toEqual([]);
    expect(plan.edges).toEqual([]);
    expect(plan.containers).toEqual({ add: [], update: [], remove: [], assignMembers: [] });
  });

  it('treats unsatisfiable as true only for a real boolean true', () => {
    expect(sanitizePlan({ unsatisfiable: true }).unsatisfiable).toBe(true);
    expect(sanitizePlan({ unsatisfiable: 'true' }).unsatisfiable).toBe(false);
    expect(sanitizePlan({ unsatisfiable: 1 }).unsatisfiable).toBe(false);
  });

  it('keeps known guidance fields, coercing primitives and dropping the rest', () => {
    const plan = sanitizePlan({ guidance: { network: 'ok', security: 5, ha: null, dr: {}, extra: 'dropped' } });
    expect(plan.guidance).toEqual({ network: 'ok', security: '5' });
  });
});
