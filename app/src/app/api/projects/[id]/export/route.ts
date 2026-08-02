import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForRead } from '@/lib/projects';
import { Architecture } from '@/lib/models/Architecture';
import { CostEstimate } from '@/lib/models/CostEstimate';
import { CostEstimateOverride } from '@/lib/models/CostEstimateOverride';
import { ExportRecord } from '@/lib/models/Export';
import { resolveServiceDef } from '@/lib/catalog';
import { toMermaid, toJsonDocument, type ExportContainer, type ExportAnnotation } from '@/lib/export/serialize';
import { toTerraform } from '@/lib/export/terraform';

export const runtime = 'nodejs';

const FORMATS = ['png', 'pdf', 'mermaid', 'json', 'estimate', 'report', 'terraform'] as const;
type Format = (typeof FORMATS)[number];

/**
 * GET /api/projects/[id]/export?format=png|pdf|mermaid|json|estimate (FR-024;
 * `estimate` added by 003 FR-016). mermaid/json/estimate are serialized
 * server-side and returned as content; png/pdf are rendered client-side from
 * the canvas, so those calls only write the audit record. Every export is
 * audited (Export model). Owner or shared read.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get('format') as Format | null;
    if (!format || !FORMATS.includes(format)) {
      throw new HttpError(400, `format must be one of: ${FORMATS.join(', ')}`);
    }
    const project = await getProjectForRead(id, session.sub);

    if (format === 'estimate') {
      // 003 US4/FR-016: standalone, client-facing cost proposal. Reads only the
      // latest CostEstimate snapshot + override records — NEVER Architecture
      // (contracts/export.md); display names fall back to the catalog.
      const safeEstimateName = project.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'architecture';
      const [snapshot, overrides] = await Promise.all([
        CostEstimate.findOne({ projectId: project._id }).sort({ computedAt: -1 }).lean(),
        CostEstimateOverride.find({ projectId: project._id }).lean(),
      ]);
      const sourceByNode = new Map(overrides.map((o) => [o.nodeId, o.source]));
      await ExportRecord.create({ ownerId: session.sub, projectId: project._id, format });
      return NextResponse.json({
        filename: `${safeEstimateName}-estimate.json`,
        mimeType: 'application/json',
        content: {
          projectName: project.name,
          generatedAt: new Date().toISOString(),
          monthly: snapshot?.monthly ?? 0,
          annual: snapshot?.annual ?? 0,
          basis: snapshot?.basis ?? 'indicative',
          lineItems: (snapshot?.perService ?? []).map((l) => ({
            serviceId: l.serviceId,
            displayName: resolveServiceDef(l.serviceId).name,
            cost: l.cost,
            basis: l.basis,
            overridden: l.overridden ?? false,
            ...(l.overridden && sourceByNode.has(l.nodeId)
              ? { overrideSource: sourceByNode.get(l.nodeId) }
              : {}),
            stale: l.stale ?? false,
          })),
        },
      });
    }

    const architecture = await Architecture.findOne({ projectId: project._id });
    const nodes = architecture?.nodes ?? [];
    const edges = architecture?.edges ?? [];
    const containers = (architecture?.containers ?? []) as unknown as ExportContainer[];
    const annotations = (architecture?.annotations ?? []) as unknown as ExportAnnotation[];

    // Which report variant, when format === 'report' (lib/generate/report.ts,
    // lib/generate/walkthrough.ts).
    const rawReportType = new URL(req.url).searchParams.get('reportType');
    const reportType =
      rawReportType === 'client' ? 'client' : rawReportType === 'walkthrough' ? 'walkthrough' : 'developer';
    await ExportRecord.create({
      ownerId: session.sub,
      projectId: project._id,
      format,
      ...(format === 'report' ? { reportType } : {}),
    });

    const safeName = project.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'architecture';
    if (format === 'mermaid') {
      return NextResponse.json({
        filename: `${safeName}.mmd`,
        mimeType: 'text/vnd.mermaid',
        content: toMermaid(project.name, nodes, edges, containers),
      });
    }
    if (format === 'terraform') {
      return NextResponse.json({
        filename: `${safeName}.tf`,
        mimeType: 'text/plain',
        content: toTerraform({
          name: project.name,
          nodes,
          edges,
          containers,
          defaultRegion: project.defaultRegion,
        }),
      });
    }
    if (format === 'json') {
      return NextResponse.json({
        filename: `${safeName}.json`,
        mimeType: 'application/json',
        content: toJsonDocument({
          name: project.name,
          nodes,
          edges,
          containers,
          annotations,
          guidance: architecture?.guidance ?? {},
          estimateMonthly: project.currentEstimateMonthly,
          exportedAt: new Date().toISOString(),
        }),
      });
    }
    // png/pdf: rendered client-side from the live canvas — audit only.
    return NextResponse.json({ recorded: true, name: safeName });
  } catch (e) {
    return fail(e);
  }
}
