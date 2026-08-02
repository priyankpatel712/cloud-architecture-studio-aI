import 'server-only';
import { connectDB } from '@/lib/db';
import { KnowledgeEntry } from '@/lib/models/KnowledgeEntry';
import {
  contentHash,
  selectRelevant,
  MIN_CONFIDENCE,
  type KnowledgeEntryInput,
  type KnowledgeEntryLike,
  type RetrievalQuery,
} from '@/lib/knowledge/types';

/**
 * Knowledge store I/O (feature 008 US3; contracts/agent-interfaces.md §3).
 *
 * Every function here is BEST-EFFORT by contract: retrieval failure returns an
 * empty list and generation proceeds ungrounded, exactly as it does today when
 * the MCP guidance cache is unavailable. Grounding is an improvement to a turn,
 * never a precondition for one — a knowledge-store outage must not take diagram
 * generation down with it.
 *
 * Scoring, filtering, and hashing live in types.ts so retrieval policy is
 * unit-testable without a database.
 */

const CANDIDATE_LIMIT = 200;

/**
 * How long a store operation may take before the caller gives up on it.
 *
 * "Best-effort" has to mean FAST-failing, not eventually-failing. With MongoDB
 * unreachable, `connectDB` waits out Mongoose's 30s server-selection timeout —
 * so without this bound, an outage in an optional grounding source would add
 * half a minute to every generation turn before degrading, which is the exact
 * outcome the module contract promises it will not cause.
 *
 * Retrieval is on the turn's critical path and gets the tighter bound. Writes
 * are not, so they get more room before being abandoned.
 */
const READ_DEADLINE_MS = 1_500;
const WRITE_DEADLINE_MS = 4_000;

/**
 * Resolve to `fallback` if `work` has not settled in time.
 *
 * The abandoned promise is left to settle on its own — cancelling a Mongoose
 * operation mid-flight is not something the driver supports, and an unhandled
 * rejection from it would be noisier than the timeout it replaced.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isEnabled(): boolean {
  return process.env.KNOWLEDGE_STORE_ENABLED !== 'false';
}

function topKFromEnv(): number | undefined {
  const raw = Number.parseInt(process.env.KNOWLEDGE_TOP_K ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * Relevant knowledge for the current request (FR-019).
 *
 * Candidates are narrowed in the database by the cheap indexed predicates
 * (provider, design mode, enabled, confidence) and ranked in code, so the
 * keyword that matched stays inspectable — when a wrong rule is injected you
 * can see why, which an embedding score would not give you.
 */
export async function retrieveKnowledge(q: RetrievalQuery): Promise<KnowledgeEntryLike[]> {
  if (!isEnabled() || q.keywords.length === 0) return [];
  const read = (async () => {
    await connectDB();
    const docs = await KnowledgeEntry.find({
      enabled: true,
      confidence: { $gte: MIN_CONFIDENCE },
      provider: q.provider === 'any' ? { $in: ['any'] } : { $in: [q.provider, 'any'] },
      designMode: q.designMode === 'any' ? { $in: ['any'] } : { $in: [q.designMode, 'any'] },
    })
      .limit(CANDIDATE_LIMIT)
      .lean();

    return selectRelevant(docs as unknown as KnowledgeEntryLike[], {
      ...q,
      topK: q.topK ?? topKFromEnv(),
    });
  })().catch((e) => {
    console.error('[knowledge] retrieval failed; continuing ungrounded:', e);
    return [] as KnowledgeEntryLike[];
  });

  return withDeadline(read, READ_DEADLINE_MS, []);
}

/**
 * All stored reference patterns, ENABLED AND DISABLED ALIKE (008 T079).
 *
 * Deliberately unfiltered on `enabled`: the caller needs to distinguish "no
 * patterns stored" (use the built-in library) from "patterns stored, operator
 * disabled some" (respect that) — a query that hid disabled rows would make
 * those two cases look identical and quietly resurrect disabled patterns.
 * Same best-effort-with-deadline contract as retrieval above.
 */
export async function retrievePatternEntries(): Promise<
  { title: string; content: string; keywords: string[]; enabled: boolean }[]
> {
  if (!isEnabled()) return [];
  const read = (async () => {
    await connectDB();
    const docs = await KnowledgeEntry.find({ kind: 'pattern' }).limit(100).lean();
    return docs.map((d) => ({
      title: d.title,
      content: d.content,
      keywords: d.keywords ?? [],
      enabled: d.enabled !== false,
    }));
  })().catch((e) => {
    console.error('[knowledge] pattern retrieval failed; using built-in library:', e);
    return [] as { title: string; content: string; keywords: string[]; enabled: boolean }[];
  });
  return withDeadline(read, READ_DEADLINE_MS, []);
}

/**
 * Insert or update by content hash (FR-022).
 *
 * Deduping on semantic identity rather than on an id is what stops the store
 * filling with near-identical lessons — each duplicate would otherwise consume
 * one of the six injection slots and crowd out genuinely different knowledge.
 */
export async function upsertKnowledge(entry: KnowledgeEntryInput): Promise<{ created: boolean }> {
  return withDeadline(upsertOnce(entry), WRITE_DEADLINE_MS, { created: false });
}

async function upsertOnce(entry: KnowledgeEntryInput): Promise<{ created: boolean }> {
  try {
    await connectDB();
    const hash = contentHash(entry);
    const res = await KnowledgeEntry.updateOne(
      { hash },
      {
        $set: {
          kind: entry.kind ?? 'rule',
          provider: entry.provider,
          designMode: entry.designMode ?? 'any',
          title: entry.title.slice(0, 120),
          content: entry.content.slice(0, 600),
          keywords: entry.keywords.map((k) => k.toLowerCase()),
          source: entry.source,
          ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
          ...(entry.staleAfter ? { staleAfter: entry.staleAfter } : {}),
          hash,
        },
        // Only applied on insert: re-seeding must never reset a lesson's earned
        // confidence or silently re-enable one an operator switched off.
        $setOnInsert: { confidence: entry.confidence ?? 1, usageCount: 0, enabled: true },
      },
      { upsert: true }
    );
    return { created: res.upsertedCount > 0 };
  } catch (e) {
    console.error('[knowledge] upsert failed:', e);
    return { created: false };
  }
}

/**
 * Record that these entries were injected into a turn that ultimately passed
 * review (FR-022, confidence lifecycle).
 *
 * Reinforcement is deliberately tied to a PASSING turn: a lesson that keeps
 * appearing in turns that still fail review is not earning its place, and will
 * decay below the retrieval threshold on its own. That is what makes the store
 * self-correcting without human review of every entry.
 */
export async function recordKnowledgeUsage(ids: readonly unknown[]): Promise<void> {
  if (ids.length === 0) return;
  await withDeadline(recordUsageOnce(ids), WRITE_DEADLINE_MS, undefined);
}

async function recordUsageOnce(ids: readonly unknown[]): Promise<void> {
  try {
    await connectDB();
    await KnowledgeEntry.updateMany(
      { _id: { $in: ids as never[] }, confidence: { $lt: 1 } },
      { $inc: { usageCount: 1, confidence: 0.05 }, $set: { lastUsedAt: new Date() } }
    );
    // Seeded rules are already at full confidence — just stamp their usage.
    await KnowledgeEntry.updateMany(
      { _id: { $in: ids as never[] }, confidence: { $gte: 1 } },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
    );
    // Cap any entry that crossed 1.0 through repeated reinforcement.
    await KnowledgeEntry.updateMany({ confidence: { $gt: 1 } }, { $set: { confidence: 1 } });
  } catch {
    /* best-effort: usage bookkeeping must never fail a turn */
  }
}

/**
 * Remove entries that never earned their place (FR-022): learned lessons that
 * decayed below the retrieval threshold, and anything unused for 60 days.
 * Seeded rules are exempt — they are curated, not earned.
 */
export async function pruneKnowledge(now: Date = new Date()): Promise<number> {
  try {
    await connectDB();
    const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const res = await KnowledgeEntry.deleteMany({
      source: { $ne: 'seed' },
      $or: [{ confidence: { $lt: MIN_CONFIDENCE } }, { lastUsedAt: { $lt: cutoff } }],
    });
    return res.deletedCount ?? 0;
  } catch (e) {
    console.error('[knowledge] prune failed:', e);
    return 0;
  }
}
