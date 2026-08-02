import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { chatStartSchema } from '@/lib/schemas';
import { Project } from '@/lib/models/Project';
import { AIConversation } from '@/lib/models/AIConversation';
import { fixedWindowLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/chat/start — creation-page bootstrap (contracts/generation.md).
 * Creates a draft Project plus its persistent conversation thread so the chat
 * on the "new project" page and the studio chat panel are the same thread.
 */
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    const body = await parseBody(req, chatStartSchema);

    // Moderate per-user cap on new-thread creation (checklist #1).
    const rl = await fixedWindowLimit('chatstart:user', session.sub, RATE_LIMITS.llmMax, RATE_LIMITS.llmWindowMs);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec, 'You are creating projects too quickly. Please wait a moment.');

    await connectDB();

    const count = await Project.countDocuments({ ownerId: session.sub });
    const project = await Project.create({
      ownerId: session.sub,
      name: body.name?.trim() || `Untitled architecture ${count + 1}`,
      status: 'draft',
    });
    const conversation = await AIConversation.create({
      ownerId: session.sub,
      projectId: project._id,
      status: 'idle',
      activeTools: [],
      messages: [],
    });

    return NextResponse.json(
      {
        projectId: String(project._id),
        conversation: {
          status: conversation.status,
          activeTools: conversation.activeTools,
          messages: [],
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return fail(e);
  }
}
