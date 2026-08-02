import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { ArchitectureVersion } from '@/lib/models/ArchitectureVersion';

export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]/versions/[versionId] — one version's full snapshot
 * (007 roadmap 1.1), used by the History panel's preview. Owner or shared read.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, versionId } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    if (!Types.ObjectId.isValid(versionId)) {
      return NextResponse.json({ error: 'Unknown version.' }, { status: 404 });
    }
    const doc = await ArchitectureVersion.findOne({ _id: versionId, projectId: project._id }).lean();
    if (!doc) return NextResponse.json({ error: 'Unknown version.' }, { status: 404 });
    return NextResponse.json({
      id: String(doc._id),
      version: doc.version,
      source: doc.source,
      summary: doc.summary ?? [],
      createdAt: doc.createdAt,
      snapshot: doc.snapshot,
    });
  } catch (e) {
    return fail(e);
  }
}
