import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { projectPatchSchema } from '@/lib/schemas';
import { getProjectForRead, getProjectForWrite } from '@/lib/projects';
import { Architecture } from '@/lib/models/Architecture';
import { ArchitectureVersion } from '@/lib/models/ArchitectureVersion';
import { AIConversation } from '@/lib/models/AIConversation';
import { CommentThread } from '@/lib/models/CommentThread';
import { CostEstimate } from '@/lib/models/CostEstimate';
import { ExportRecord } from '@/lib/models/Export';
import { User } from '@/lib/models/User';

export const runtime = 'nodejs';

function projectView(p: Awaited<ReturnType<typeof getProjectForRead>>, userId: string) {
  return {
    id: String(p._id),
    name: p.name,
    description: p.description,
    status: p.status,
    providers: p.providers,
    monthly: p.currentEstimateMonthly,
    defaultRegion: p.defaultRegion,
    owned: String(p.ownerId) === userId,
    updatedAt: p.updatedAt,
  };
}

// GET /api/projects/[id] — project + current architecture (owner or shared).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const architecture = await Architecture.findOne({ projectId: project._id });
    const sharedUsers = await User.find({ _id: { $in: project.sharedWith } }, { email: 1, name: 1 });
    return NextResponse.json({
      project: {
        ...projectView(project, session.sub),
        sharedWith: sharedUsers.map((u) => ({ userId: String(u._id), email: u.email, name: u.name })),
      },
      architecture: architecture
        ? {
            nodes: architecture.nodes,
            edges: architecture.edges,
            guidance: architecture.guidance,
            version: architecture.version,
          }
        : { nodes: [], edges: [], guidance: {}, version: 0 },
    });
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/projects/[id] — owner-only rename/describe/status (incl. archive).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, projectPatchSchema);
    if (body.name !== undefined) project.name = body.name;
    if (body.description !== undefined) project.description = body.description;
    if (body.status !== undefined) project.status = body.status;
    if (body.defaultRegion !== undefined) project.defaultRegion = body.defaultRegion;
    await project.save();
    return NextResponse.json({ project: projectView(project, session.sub) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * DELETE /api/projects/[id] — owner-only; cascades to the architecture, the chat
 * thread, estimates, and export records (thread-lifecycle clarification 2026-07-06:
 * deleting a project deletes its conversation).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    await Promise.all([
      Architecture.deleteMany({ projectId: project._id }),
      ArchitectureVersion.deleteMany({ projectId: project._id }),
      AIConversation.deleteMany({ projectId: project._id }),
      CommentThread.deleteMany({ projectId: project._id }),
      CostEstimate.deleteMany({ projectId: project._id }),
      ExportRecord.deleteMany({ projectId: project._id }),
    ]);
    await project.deleteOne();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
