import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { projectCreateSchema } from '@/lib/schemas';
import { Project } from '@/lib/models/Project';
import { Architecture } from '@/lib/models/Architecture';

export const runtime = 'nodejs';

/**
 * GET /api/projects — the caller's projects, owned + shared-with (FR-022,
 * contracts/projects.md). `?status=` filters; `services` is the node count.
 */
export async function GET(req: Request) {
  try {
    const session = await requireVerified();
    await connectDB();
    const status = new URL(req.url).searchParams.get('status');
    const filter: Record<string, unknown> = {
      $or: [{ ownerId: session.sub }, { sharedWith: session.sub }],
      ...(status && ['active', 'draft', 'archived'].includes(status) ? { status } : {}),
    };
    const projects = await Project.find(filter).sort({ updatedAt: -1 });

    const architectures = await Architecture.find(
      { projectId: { $in: projects.map((p) => p._id) } },
      { projectId: 1, 'nodes.nodeId': 1 }
    );
    const nodeCounts = new Map(architectures.map((a) => [String(a.projectId), a.nodes.length]));

    return NextResponse.json({
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        description: p.description,
        status: p.status,
        providers: p.providers,
        services: nodeCounts.get(String(p._id)) ?? 0,
        monthly: p.currentEstimateMonthly,
        owned: String(p.ownerId) === session.sub,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/projects — create an empty project (FR-022).
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    const body = await parseBody(req, projectCreateSchema);
    await connectDB();
    const project = await Project.create({
      ownerId: session.sub,
      name: body.name,
      description: body.description,
      status: 'draft',
    });
    return NextResponse.json(
      { project: { id: String(project._id), name: project.name, status: project.status } },
      { status: 201 }
    );
  } catch (e) {
    return fail(e);
  }
}
