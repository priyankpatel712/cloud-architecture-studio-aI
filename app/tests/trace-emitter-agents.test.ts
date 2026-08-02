import { describe, expect, it } from 'vitest';
import { createTraceEmitter, STEP_KINDS, type StepKind } from '@/lib/generate/trace-emitter';
import { GenerationRun } from '@/lib/models/GenerationRun';

/**
 * Feature 008 — the five new multi-agent step kinds.
 *
 * The highest-value assertion is the enum-drift guard: `StepKind` and the
 * Mongoose enum on GenerationRun.steps.kind are maintained by hand in two files.
 * If a kind is emitted but missing from the schema, Mongoose rejects the whole
 * run document — so the turn appears to work while its entire trace silently
 * fails to persist. That is exactly the class of bug the live trace exists to
 * prevent, so it is pinned here rather than left to review discipline.
 */

const NEW_008_KINDS: StepKind[] = ['intent', 'direct-edit', 'knowledge', 'research', 'distill'];

function schemaEnum(): string[] {
  const path = GenerationRun.schema.path('steps') as unknown as {
    schema: { path(p: string): { enumValues?: string[] } };
  };
  return path.schema.path('kind').enumValues ?? [];
}

describe('step-kind enum parity (emitter <-> persisted schema)', () => {
  it('persists every kind the emitter can produce', () => {
    const persisted = schemaEnum();
    const missing = STEP_KINDS.filter((k) => !persisted.includes(k));
    expect(missing, `emitter kinds absent from GenerationRun schema: ${missing.join(', ')}`).toEqual(
      []
    );
  });

  it('declares no persisted kind the emitter cannot produce', () => {
    const orphans = schemaEnum().filter((k) => !(STEP_KINDS as readonly string[]).includes(k));
    expect(orphans, `schema kinds with no emitter counterpart: ${orphans.join(', ')}`).toEqual([]);
  });

  it('includes all five 008 agent kinds', () => {
    for (const kind of NEW_008_KINDS) {
      expect(STEP_KINDS as readonly string[], `${kind} missing from STEP_KINDS`).toContain(kind);
      expect(schemaEnum(), `${kind} missing from GenerationRun enum`).toContain(kind);
    }
  });
});

describe('new agent steps emit and record correctly', () => {
  it('streams running then done and records one terminal step per kind', () => {
    const events: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => events.push(e));

    for (const kind of NEW_008_KINDS) {
      emitter.step(kind, kind, 1, `${kind} label`, 'running');
      emitter.step(kind, kind, 1, `${kind} label`, 'done', `${kind} detail`);
    }

    expect(events).toHaveLength(NEW_008_KINDS.length * 2);
    expect(events.filter((e) => e.status === 'running')).toHaveLength(NEW_008_KINDS.length);
    expect(emitter.steps).toHaveLength(NEW_008_KINDS.length);
    expect(emitter.steps.map((s) => s.kind)).toEqual(NEW_008_KINDS);
    for (const step of emitter.steps) {
      expect(step.status).toBe('done');
      expect(step.detail).toBe(`${step.kind} detail`);
      expect(step.endedAt.getTime()).toBeGreaterThanOrEqual(step.startedAt.getTime());
    }
  });

  it('records a failed agent step without losing it', () => {
    // Knowledge, research, and distill failures degrade rather than abort the
    // turn (FR-027, FR-034) — the step must still surface as failed.
    const emitter = createTraceEmitter(() => {});
    emitter.step('research', 'research', 1, 'Searched the web', 'running');
    emitter.step('research', 'research', 1, 'Searched the web', 'failed', 'backend unavailable');

    expect(emitter.steps).toHaveLength(1);
    expect(emitter.steps[0]).toMatchObject({ kind: 'research', status: 'failed' });
  });

  it('closes an abandoned agent step as failed on finalize', () => {
    const emitter = createTraceEmitter(() => {});
    emitter.step('intent', 'intent', 1, 'Understanding the request', 'running');
    emitter.finalize();

    expect(emitter.steps).toHaveLength(1);
    expect(emitter.steps[0]).toMatchObject({ kind: 'intent', status: 'failed' });
  });

  it('allows a distill step after the result — it runs post-turn', () => {
    // contracts/chat-stream-events.md: distillation happens after the result is
    // persisted, so its step is the one that may arrive last.
    const events: Record<string, unknown>[] = [];
    const emitter = createTraceEmitter((e) => events.push(e));
    emitter.step('draft', 'draft', 1, 'Drafting', 'done');
    emitter.step('distill', 'distill', 1, 'Recorded a lesson', 'done');

    expect(events.at(-1)).toMatchObject({ kind: 'distill', status: 'done' });
  });
});
