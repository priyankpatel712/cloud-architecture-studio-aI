import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail } from '@/lib/api';
import { LlmUsage } from '@/lib/models/LlmUsage';
import { summarizeUsage, windowStart, isUsageWindow, type UsageBucket } from '@/lib/llm-usage';

export const runtime = 'nodejs';

/**
 * GET /api/settings/llm/usage — real AI usage (feature 008 US5, FR-031;
 * contracts/settings-llm-usage.md).
 *
 * Replaces the hardcoded "usage this month" figures the settings page used to
 * render. Aggregate totals are visible to any verified user — they describe the
 * workspace's own spend — while the per-role breakdown needs `settings:manage`,
 * since it exposes how the pipeline is wired.
 *
 * Grouping happens in the database and shaping in `lib/llm-usage.ts`; nothing
 * here decides what a number means. An empty collection returns zeros rather
 * than an error (contract §Notes): "no calls yet" is a real answer.
 */
export async function GET(req: Request) {
  try {
    const session = await requireVerified();
    const raw = new URL(req.url).searchParams.get('window');
    const window = isUsageWindow(raw) ? raw : '30d';

    await connectDB();
    const rows = await LlmUsage.aggregate<{
      _id: { provider: string; model: string; role: string; tier: string };
      requests: number;
      promptTokens: number;
      completionTokens: number;
      rateLimited: number;
      errors: number;
      latencySumMs: number;
    }>([
      { $match: { at: { $gte: windowStart(window) } } },
      {
        $group: {
          _id: { provider: '$provider', model: '$model', role: '$role', tier: '$tier' },
          requests: { $sum: 1 },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          // Counted here rather than derived later: a rate-limited call still
          // consumed a request slot, and the operator needs to see both.
          rateLimited: { $sum: { $cond: [{ $eq: ['$status', 'rate_limited'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          latencySumMs: { $sum: '$latencyMs' },
        },
      },
    ]);

    const buckets: UsageBucket[] = rows.map((r) => ({
      provider: r._id.provider,
      model: r._id.model,
      role: r._id.role,
      tier: r._id.tier as UsageBucket['tier'],
      requests: r.requests,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      rateLimited: r.rateLimited,
      errors: r.errors,
      latencySumMs: r.latencySumMs,
    }));

    return NextResponse.json(
      summarizeUsage(buckets, { window, includeByRole: can(session.role, 'settings:manage') })
    );
  } catch (e) {
    return fail(e);
  }
}
