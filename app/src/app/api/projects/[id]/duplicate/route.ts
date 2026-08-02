import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForWrite } from '@/lib/projects';
import { Project } from '@/lib/models/Project';
import { Architecture } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';

export const runtime = 'nodejs';

/**
 * POST /api/projects/[id]/duplicate — deep-copy project + architecture (FR-022).
 * The chat thread is NOT copied: the duplicate starts a fresh conversation with a
 * system provenance note (thread-lifecycle clarification 2026-07-06).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const source = await getProjectForWrite(id, session.sub);

    const copy = await Project.create({
      ownerId: session.sub,
      name: `${source.name} (copy)`,
      description: source.description,
      status: 'draft',
      providers: source.providers,
      sharedWith: [],
      currentEstimateMonthly: source.currentEstimateMonthly,
      defaultRegion: source.defaultRegion,
    });

    const architecture = await Architecture.findOne({ projectId: source._id });
    if (architecture) {
      await Architecture.create({
        projectId: copy._id,
        ownerId: session.sub,
        nodes: architecture.nodes,
        edges: architecture.edges,
        guidance: architecture.guidance,
        version: 1,
        generatedFrom: architecture.generatedFrom,
      });
    }

    await AIConversation.create({
      ownerId: session.sub,
      projectId: copy._id,
      status: 'idle',
      activeTools: [],
      messages: [
        {
          role: 'system',
          text: `Duplicated from "${source.name}" — this is a fresh conversation; the original thread was not copied.`,
          attachedTools: [],
          mcpCalls: [],
          editsApplied: [],
          indicative: false,
          createdAt: new Date(),
        },
      ],
    });

    return NextResponse.json(
      { project: { id: String(copy._id), name: copy.name, status: copy.status } },
      { status: 201 }
    );
  } catch (e) {
    return fail(e);
  }
}
