import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { CommentThread } from '@/lib/models/CommentThread';
import { User } from '@/lib/models/User';
import { threadView } from '@/lib/comments';

export const runtime = 'nodejs';

/**
 * Single comment thread (007 roadmap 2.2):
 *  POST   — add a reply (anyone with read access)
 *  PATCH  — resolve/unresolve (thread author or project owner)
 *  DELETE — delete the thread (thread author or project owner)
 */

async function loadThread(projectIdParam: string, threadId: string, userId: string) {
  const project = await getProjectForRead(projectIdParam, userId);
  if (!Types.ObjectId.isValid(threadId)) return { project, thread: null };
  const thread = await CommentThread.findOne({ _id: threadId, projectId: project._id });
  return { project, thread };
}

const replySchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, threadId } = await ctx.params;
    const { project, thread } = await loadThread(id, threadId, session.sub);
    if (!thread) return NextResponse.json({ error: 'Unknown comment thread.' }, { status: 404 });
    const body = await parseBody(req, replySchema);
    const user = await User.findById(session.sub).select('name email');
    thread.messages.push({
      authorId: new Types.ObjectId(session.sub),
      authorName: user?.name || user?.email || '',
      text: body.text,
      createdAt: new Date(),
    });
    // A reply on a resolved thread reopens the conversation.
    thread.resolved = false;
    await thread.save();
    return NextResponse.json({ thread: threadView(thread, session.sub, String(project.ownerId)) });
  } catch (e) {
    return fail(e);
  }
}

const patchSchema = z.object({ resolved: z.boolean() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, threadId } = await ctx.params;
    const { project, thread } = await loadThread(id, threadId, session.sub);
    if (!thread) return NextResponse.json({ error: 'Unknown comment thread.' }, { status: 404 });
    const canModerate = String(thread.createdBy) === session.sub || String(project.ownerId) === session.sub;
    if (!canModerate) return NextResponse.json({ error: 'Only the thread author or the project owner can do that.' }, { status: 403 });
    const body = await parseBody(req, patchSchema);
    thread.resolved = body.resolved;
    await thread.save();
    return NextResponse.json({ thread: threadView(thread, session.sub, String(project.ownerId)) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, threadId } = await ctx.params;
    const { project, thread } = await loadThread(id, threadId, session.sub);
    if (!thread) return NextResponse.json({ error: 'Unknown comment thread.' }, { status: 404 });
    const canModerate = String(thread.createdBy) === session.sub || String(project.ownerId) === session.sub;
    if (!canModerate) return NextResponse.json({ error: 'Only the thread author or the project owner can do that.' }, { status: 403 });
    await thread.deleteOne();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
