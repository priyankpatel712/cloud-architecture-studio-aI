import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { Architecture } from '@/lib/models/Architecture';
import { loadLlmSettings } from '@/lib/llm-settings';
import { getOrGenerateReport, getOrGenerateClientProposal } from '@/lib/generate/report';
import { getOrGenerateWalkthrough } from '@/lib/generate/walkthrough';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET /api/projects/[id]/report[?refresh=1][?reportType=developer|client|walkthrough]
 * — the AI architecture report for the Explain popup and the report PDF
 * exports. Cached per architecture version on the Architecture document;
 * `refresh=1` forces regeneration. `reportType` defaults to `developer`
 * (unchanged behavior for existing callers that omit it) — `client` returns
 * the business-facing proposal variant, `walkthrough` the step-by-step client
 * walkthrough (each step maps to diagram nodes). Owner or shared read.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const arch = await Architecture.findOne({ projectId: project._id });
    if (!arch || arch.nodes.length === 0) {
      throw new HttpError(404, 'No architecture to report on yet — generate or build one first.');
    }
    // Prime the settings cache so llmAvailable() sees the in-app provider config.
    await loadLlmSettings();
    const url = new URL(req.url);
    const refresh = url.searchParams.get('refresh') === '1';
    const rawType = url.searchParams.get('reportType');
    const reportType = rawType === 'client' ? 'client' : rawType === 'walkthrough' ? 'walkthrough' : 'developer';
    const { report, cached } =
      reportType === 'client'
        ? await getOrGenerateClientProposal(project, arch, { refresh })
        : reportType === 'walkthrough'
          ? await getOrGenerateWalkthrough(project, arch, { refresh })
          : await getOrGenerateReport(project, arch, { refresh });
    return NextResponse.json({ report, cached, version: arch.version, reportType });
  } catch (e) {
    return fail(e);
  }
}
