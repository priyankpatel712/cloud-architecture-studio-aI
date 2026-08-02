import { NextResponse } from 'next/server';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { canEditProject } from '@/lib/models/Project';
import { AIConversation } from '@/lib/models/AIConversation';

export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]/chat — resume the project's persistent thread
 * (contracts/generation.md). Owner or sharedWith may read; `canPost` tells the
 * client whether to render the composer (shared users are view-only —
 * thread-lifecycle clarification 2026-07-06). No thread yet → empty messages.
 *
 * 004 (contracts/agentic-generation.md §3): each assistant message includes
 * its run summary — `runId`/`iterations`/`converged`/`stopped`/`stepCount` —
 * when present, but never the full trace (kept separate, fetched on demand via
 * GET .../chat/runs/[runId] — FR-006/Clarification Q3). Messages created
 * before 004 have no `runId`; the client hides the "Show working" toggle then.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const conversation = await AIConversation.findOne({ projectId: project._id });

    return NextResponse.json({
      conversation: {
        status: conversation?.status ?? 'idle',
        activeTools: conversation?.activeTools ?? [],
        messages: (conversation?.messages ?? []).map((m) => ({
          role: m.role,
          text: m.text,
          attachedTools: m.attachedTools,
          mcpCalls: m.mcpCalls,
          editsApplied: m.editsApplied,
          indicative: m.indicative,
          createdAt: m.createdAt,
          ...(m.runId
            ? { runId: String(m.runId), iterations: m.iterations, converged: m.converged, stopped: m.stopped, stepCount: m.stepCount }
            : {}),
          // 006 (contracts/guided-flow-protocol.md §4) — the structured round
          // attached to this message, verbatim; thread resume = re-render it.
          ...(m.interaction ? { interaction: m.interaction } : {}),
          // Interpretability (2026-08) — the per-requirement evaluation panel
          // must survive a reload, same as it streamed live.
          ...(m.coverage && m.coverage.length > 0 ? { coverage: m.coverage } : {}),
        })),
      },
      // 006 §4 — guided-flow summary; null for legacy threads.
      flow: conversation?.flow
        ? {
            awaiting: conversation.flow.awaiting ?? null,
            openInteractionId: conversation.flow.openInteractionId ?? null,
            selectedOptionId: conversation.flow.selectedOptionId ?? null,
          }
        : null,
      canPost: canEditProject(project, session.sub),
    });
  } catch (e) {
    return fail(e);
  }
}
