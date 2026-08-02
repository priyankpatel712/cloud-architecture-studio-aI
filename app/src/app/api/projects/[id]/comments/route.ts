import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { CommentThread } from '@/lib/models/CommentThread';
import { User } from '@/lib/models/User';
import { threadView } from '@/lib/comments';

export const runtime = 'nodejs';

/**
 * Comments (007 roadmap 2.2). Anyone with READ access may list and create —
 * commenting is the collaboration surface for shared viewers, who cannot edit
 * the diagram itself.
 */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const threads = await CommentThread.find({ projectId: project._id }).sort({ resolved: 1, updatedAt: -1 });
    return NextResponse.json({ threads: threads.map((t) => threadView(t, session.sub, String(project.ownerId))) });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  anchor: z.object({
    kind: z.enum(['node', 'container', 'project']),
    targetId: z.string().max(64).optional(),
    targetLabel: z.string().max(120).optional(),
  }),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const body = await parseBody(req, createSchema);
    const user = await User.findById(session.sub).select('name email');
    const thread = await CommentThread.create({
      projectId: project._id,
      createdBy: session.sub,
      anchor: {
        kind: body.anchor.kind,
        targetId: body.anchor.kind === 'project' ? null : (body.anchor.targetId ?? null),
        targetLabel: body.anchor.targetLabel ?? '',
      },
      messages: [{ authorId: session.sub, authorName: user?.name || user?.email || '', text: body.text, createdAt: new Date() }],
    });
    return NextResponse.json({ thread: threadView(thread, session.sub, String(project.ownerId)) }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
