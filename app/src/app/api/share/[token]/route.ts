import { NextResponse } from 'next/server';
import { Project } from '@/lib/models/Project';
import { Architecture } from '@/lib/models/Architecture';
import { connectDB } from '@/lib/db';
import { fail } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/share/[token] — public read-only view payload (007 roadmap 1.3).
 * NO auth: the unguessable token is the credential. Scope is deliberately
 * minimal — diagram content and name only; never owner identity, share lists,
 * conversation, or cost overrides.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    await connectDB();
    const { token } = await ctx.params;
    if (!token || token.length < 16) {
      return NextResponse.json({ error: 'This share link is invalid or was revoked.' }, { status: 404 });
    }
    const project = await Project.findOne({ shareToken: token }).select('name description providers currentEstimateMonthly');
    if (!project) {
      return NextResponse.json({ error: 'This share link is invalid or was revoked.' }, { status: 404 });
    }
    const architecture = await Architecture.findOne({ projectId: project._id }).lean();
    return NextResponse.json({
      name: project.name,
      description: project.description,
      estimateMonthly: project.currentEstimateMonthly,
      architecture: architecture
        ? {
            nodes: architecture.nodes,
            edges: architecture.edges,
            containers: architecture.containers ?? [],
            annotations: architecture.annotations ?? [],
            guidance: architecture.guidance ?? {},
          }
        : { nodes: [], edges: [], containers: [], annotations: [], guidance: {} },
    });
  } catch (e) {
    return fail(e);
  }
}
