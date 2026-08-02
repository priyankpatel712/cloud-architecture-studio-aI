import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { GenerationRun } from '@/lib/models/GenerationRun';

export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]/chat/runs/[runId] — full trace on demand (feature 004
 * FR-006/SC-003; contracts/agentic-generation.md §4). Any project viewer may
 * read (same guard as thread GET); the run must belong to THIS project or the
 * lookup 404s (prevents cross-project reads via a leaked/guessed runId).
 * Called only when a reader expands a persisted "Show working…" toggle — the
 * just-completed turn already holds the live steps and never calls this.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, runId } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    if (!Types.ObjectId.isValid(runId)) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    const run = await GenerationRun.findOne({ _id: runId, projectId: project._id });
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json({
      steps: run.steps,
      modelCalls: run.modelCalls ?? [],
      iterations: run.iterations,
      converged: run.converged,
      stopped: run.stopped,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
  } catch (e) {
    return fail(e);
  }
}
