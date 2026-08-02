import { describe, expect, it } from 'vitest';
import { createTraceEmitter } from '@/lib/generate/trace-emitter';

/**
 * Shared v2 trace emitter (feature 004 contracts/agentic-generation.md §1;
 * data-model.md TraceStep): the single source of truth for both the live
 * NDJSON stream and the persisted GenerationRun.steps accumulator.
 */
describe('createTraceEmitter', () => {
  it('streams every transition and accumulates only terminal steps', () => {
    const emitted: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => emitted.push(e));

    emitter.step('lookup:aws', 'lookup', 1, 'Consulting official AWS MCP', 'running');
    emitter.step('lookup:aws', 'lookup', 1, 'Consulting official AWS MCP', 'done', 'aws___search_documentation');

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ type: 'step', id: 'lookup:aws', status: 'running' });
    expect(emitted[1]).toMatchObject({ type: 'step', id: 'lookup:aws', status: 'done', detail: 'aws___search_documentation' });

    expect(emitter.steps).toHaveLength(1);
    expect(emitter.steps[0]).toMatchObject({ id: 'lookup:aws', kind: 'lookup', iteration: 1, status: 'done' });
    expect(emitter.steps[0].startedAt).toBeInstanceOf(Date);
    expect(emitter.steps[0].endedAt).toBeInstanceOf(Date);
  });

  it('truncates detail beyond 300 chars on both the live event and the record', () => {
    const emitted: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => emitted.push(e));
    const long = 'x'.repeat(400);

    emitter.step('review:1', 'review', 1, 'Reviewing draft', 'done', long);

    expect((emitted[0].detail as string)).toHaveLength(300);
    expect(emitter.steps[0].detail).toHaveLength(300);
  });

  it('omits detail entirely when not provided', () => {
    const emitted: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => emitted.push(e));
    emitter.step('draft', 'draft', 1, 'Designing the architecture plan', 'done');
    expect('detail' in emitted[0]).toBe(false);
    expect(emitter.steps[0].detail).toBeUndefined();
  });

  it('finalize() closes any step left running as failed (guarded emit)', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('price', 'price', 1, 'Pricing via official sources', 'running');
    expect(emitter.steps).toHaveLength(0);

    emitter.finalize();

    expect(emitter.steps).toHaveLength(1);
    expect(emitter.steps[0]).toMatchObject({ id: 'price', kind: 'price', iteration: 1, status: 'failed' });
  });

  it('finalize() is a no-op when every step already closed', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('draft', 'draft', 1, 'Designing the architecture plan', 'running');
    emitter.step('draft', 'draft', 1, 'Designing the architecture plan', 'done');
    emitter.finalize();
    expect(emitter.steps).toHaveLength(1);
    expect(emitter.steps[0].status).toBe('done');
  });

  it('legacyProgress() adapts the 3-arg orchestrator callback into a tagged step', () => {
    const emitted: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => emitted.push(e));
    const progress = emitter.legacyProgress('draft', 2);

    progress('plan', 'Designing the architecture plan', 'running');
    progress('plan', 'Designing the architecture plan', 'done');

    expect(emitted[0]).toMatchObject({ id: 'plan', kind: 'draft', iteration: 2, status: 'running' });
    expect(emitter.steps[0]).toMatchObject({ id: 'plan', kind: 'draft', iteration: 2, status: 'done' });
  });

  it('run assembly matches across success, failure, and mixed step outcomes', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('understand', 'understand', 1, 'Understanding the request', 'running');
    emitter.step('understand', 'understand', 1, 'Understanding the request', 'done');
    emitter.step('lookup:aws', 'lookup', 1, 'Consulting official AWS MCP', 'running');
    emitter.step('lookup:aws', 'lookup', 1, 'Consulting official AWS MCP', 'failed');
    emitter.step('review:1', 'review', 1, 'Reviewing draft against your request', 'running');
    // simulate a client-disconnect mid-step: never closed explicitly
    emitter.finalize();

    expect(emitter.steps.map((s) => ({ id: s.id, status: s.status }))).toEqual([
      { id: 'understand', status: 'done' },
      { id: 'lookup:aws', status: 'failed' },
      { id: 'review:1', status: 'failed' },
    ]);
  });
});
