import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 008 US3 — the knowledge store degrades FAST, not eventually.
 *
 * store.ts promises that "a knowledge-store outage must not take diagram
 * generation down with it". Catching the error is not enough to keep that
 * promise: with MongoDB unreachable, `connectDB` waits out Mongoose's 30-second
 * server-selection timeout, so an outage in an OPTIONAL grounding source would
 * silently add half a minute to every generation turn — inside a turn budget of
 * 120 seconds. This was a live regression, found when the local database was
 * down and nine agent-loop tests timed out at once.
 *
 * These tests pin the bound rather than the exact duration, so tuning the
 * deadline does not require editing them.
 */

vi.mock('@/lib/db', () => ({
  // Never resolves — the shape of an unreachable database, without the wait.
  connectDB: () => new Promise(() => {}),
}));

vi.mock('@/lib/models/KnowledgeEntry', () => ({ KnowledgeEntry: {} }));

const { retrieveKnowledge, upsertKnowledge, recordKnowledgeUsage } = await import('@/lib/knowledge/store');

/** Generous enough to be stable on a loaded CI box, far under a turn budget. */
const TOLERANCE_MS = 8_000;

afterEach(() => {
  vi.useRealTimers();
});

async function timed(work: Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await work;
  return performance.now() - startedAt;
}

describe('an unreachable store gives up quickly', () => {
  it('retrieval returns empty instead of hanging the turn', async () => {
    const elapsed = await timed(
      retrieveKnowledge({ keywords: ['database'], provider: 'aws', designMode: 'cloud' }).then((entries) => {
        expect(entries).toEqual([]);
      })
    );
    expect(elapsed).toBeLessThan(TOLERANCE_MS);
  });

  it('an upsert reports failure instead of hanging', async () => {
    const elapsed = await timed(
      upsertKnowledge({
        provider: 'aws',
        title: 'x',
        content: 'y',
        keywords: ['k'],
        source: 'learned',
      }).then((res) => {
        expect(res).toEqual({ created: false });
      })
    );
    expect(elapsed).toBeLessThan(TOLERANCE_MS);
  });

  it('usage bookkeeping gives up instead of hanging', async () => {
    const elapsed = await timed(recordKnowledgeUsage(['abc']));
    expect(elapsed).toBeLessThan(TOLERANCE_MS);
  });
});

describe('no database work is attempted when there is nothing to do', () => {
  it('an empty keyword list short-circuits before connecting', async () => {
    const elapsed = await timed(
      retrieveKnowledge({ keywords: [], provider: 'any', designMode: 'any' }).then((entries) => {
        expect(entries).toEqual([]);
      })
    );
    expect(elapsed).toBeLessThan(100);
  });

  it('recording zero ids short-circuits before connecting', async () => {
    expect(await timed(recordKnowledgeUsage([]))).toBeLessThan(100);
  });

  it('the store can be switched off entirely', async () => {
    process.env.KNOWLEDGE_STORE_ENABLED = 'false';
    try {
      const elapsed = await timed(
        retrieveKnowledge({ keywords: ['database'], provider: 'aws', designMode: 'cloud' })
      );
      expect(elapsed).toBeLessThan(100);
    } finally {
      delete process.env.KNOWLEDGE_STORE_ENABLED;
    }
  });
});
