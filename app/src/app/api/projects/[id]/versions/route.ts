import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { ArchitectureVersion } from '@/lib/models/ArchitectureVersion';

export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]/versions — version history list (007 roadmap 1.1).
 * Owner or shared read. Metadata only — the full snapshot is fetched per
 * version on demand.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const versions = await ArchitectureVersion.find({ projectId: project._id })
      .sort({ version: -1 })
      .select('version source summary counts createdAt')
      .lean();
    return NextResponse.json({
      versions: versions.map((v) => ({
        id: String(v._id),
        version: v.version,
        source: v.source,
        summary: v.summary ?? [],
        counts: v.counts ?? { nodes: 0, edges: 0, containers: 0 },
        createdAt: v.createdAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
