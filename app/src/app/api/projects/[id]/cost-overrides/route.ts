import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { costOverridePatchSchema } from '@/lib/schemas';
import { getProjectForRead, getProjectForWrite } from '@/lib/projects';
import { canEditProject } from '@/lib/models/Project';
import { Architecture } from '@/lib/models/Architecture';
import { CostEstimateOverride } from '@/lib/models/CostEstimateOverride';
import { recomputeProjectEstimate } from '@/lib/cost-estimate';
import { quantityFieldOf } from '@/lib/generate/overrides';

export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]/cost-overrides — current estimate (with overridden/
 * stale flags) plus the raw override records for the cost panel. Read access:
 * shared users may VIEW override state but not change it (003 FR-014).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    // persist:false — a read (possibly by a read-only collaborator) must not
    // write snapshots, denormalized totals, or prune anything (FR-014).
    const estimate = await recomputeProjectEstimate(project, { persist: false });
    const overrides = await CostEstimateOverride.find({ projectId: project._id }).lean();
    return NextResponse.json({
      estimate,
      overrides: overrides.map((o) => ({
        nodeId: o.nodeId,
        quantityOverride: o.quantityOverride ?? null,
        totalCostOverride: o.totalCostOverride ?? null,
        source: o.source,
        setAt: o.setAt,
      })),
      canEdit: canEditProject(project, session.sub),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PATCH /api/projects/[id]/cost-overrides — set or clear an inline override on
 * one cost line item (003 contracts/cost-overrides.md; FR-008–FR-011, FR-014).
 * Edit access only; validation errors leave the existing override untouched
 * (FR-011). clear:true deletes the override (reset to system-computed, FR-009).
 * Setting a value refreshes configSnapshot to the node's CURRENT config, which
 * also clears any stale flag (confirm semantics — FR-012).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, costOverridePatchSchema);

    const arch = await Architecture.findOne({ projectId: project._id }).lean();
    const node = (arch?.nodes ?? []).find((n) => n.nodeId === body.nodeId);
    if (!node) throw new HttpError(404, 'No service with that nodeId exists in this architecture.');

    if (body.clear) {
      await CostEstimateOverride.deleteOne({ projectId: project._id, nodeId: body.nodeId });
    } else {
      if (body.quantityOverride !== undefined && !quantityFieldOf(node.serviceId)) {
        throw new HttpError(422, 'This service has no overridable quantity — set a fixed total cost instead.');
      }
      await CostEstimateOverride.updateOne(
        { projectId: project._id, nodeId: body.nodeId },
        {
          $set: {
            ...(body.quantityOverride !== undefined ? { quantityOverride: body.quantityOverride } : {}),
            ...(body.totalCostOverride !== undefined ? { totalCostOverride: body.totalCostOverride } : {}),
            configSnapshot: node.config ?? {},
            source: 'inline',
            setBy: session.sub,
            setAt: new Date(),
          },
          $setOnInsert: { ownerId: project.ownerId },
        },
        { upsert: true }
      );
    }

    const estimate = await recomputeProjectEstimate(project);
    return NextResponse.json({ estimate });
  } catch (e) {
    return fail(e);
  }
}
