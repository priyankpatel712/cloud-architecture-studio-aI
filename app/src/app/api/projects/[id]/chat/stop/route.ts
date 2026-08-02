import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForWrite } from '@/lib/projects';
import { AIConversation } from '@/lib/models/AIConversation';

export const runtime = 'nodejs';

/**
 * POST /api/projects/[id]/chat/stop — request cancellation of a running
 * generation (feature 004 FR-009; contracts/agentic-generation.md §2).
 * Owner-only (same guard as messages POST). Sets `stopRequested`; the agent
 * loop honors it at the next phase boundary (research R5) and the shared
 * AbortController cancels any in-flight LLM fetch within a few seconds.
 * Always safe to retry a new message after the stream's terminal event.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const convo = await AIConversation.findOne({ projectId: project._id });
    if (!convo || convo.status !== 'generating') {
      return NextResponse.json({ error: 'No generation is in progress.' }, { status: 409 });
    }
    convo.stopRequested = true;
    await convo.save();
    return NextResponse.json({ stopping: true }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
