import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, HttpError } from '@/lib/session';
import { fail } from '@/lib/api';
import { knowledgeListQuerySchema } from '@/lib/schemas';
import { KnowledgeEntry, type KnowledgeEntryDoc } from '@/lib/models/KnowledgeEntry';

export const runtime = 'nodejs';

/**
 * GET /api/settings/knowledge — review the stored knowledge (feature 008 US5,
 * FR-032/FR-033; contracts/settings-knowledge.md).
 *
 * Readable by any verified user, deliberately: the working trace cites the
 * knowledge a turn consulted, and a citation nobody can look up is not an
 * explanation. Mutation requires `settings:manage` and lives in the sibling
 * routes.
 */
export function serializeEntry(doc: KnowledgeEntryDoc) {
  return {
    id: String(doc._id),
    kind: doc.kind,
    provider: doc.provider,
    designMode: doc.designMode,
    title: doc.title,
    content: doc.content,
    keywords: doc.keywords,
    source: doc.source,
    sourceUrl: doc.sourceUrl ?? null,
    confidence: doc.confidence,
    usageCount: doc.usageCount,
    lastUsedAt: doc.lastUsedAt ? new Date(doc.lastUsedAt).toISOString() : null,
    enabled: doc.enabled,
  };
}

export async function GET(req: Request) {
  try {
    await requireVerified();
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = knowledgeListQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const { provider, kind, source, enabled, limit } = parsed.data;

    await connectDB();
    const filter: Record<string, unknown> = {};
    if (provider) filter.provider = provider;
    if (kind) filter.kind = kind;
    if (source) filter.source = source;
    if (enabled) filter.enabled = enabled === 'true';

    // `total` counts the FILTERED set, not the collection: a panel showing
    // "23 entries" beside a filtered list of 4 reads as a bug.
    const [docs, total] = await Promise.all([
      KnowledgeEntry.find(filter).sort({ usageCount: -1, updatedAt: -1 }).limit(limit),
      KnowledgeEntry.countDocuments(filter),
    ]);

    return NextResponse.json({ entries: docs.map(serializeEntry), total });
  } catch (e) {
    return fail(e);
  }
}
