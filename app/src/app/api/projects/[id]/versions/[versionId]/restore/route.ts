import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForWrite } from '@/lib/projects';
import { Architecture } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';
import { ArchitectureVersion } from '@/lib/models/ArchitectureVersion';
import { recomputeProjectEstimate } from '@/lib/cost-estimate';
import { priceNodes } from '@/lib/pricing';
import { recordArchitectureVersion, type VersionSnapshot } from '@/lib/versions';
import type { ProviderId } from '@/lib/providers/types';

export const runtime = 'nodejs';

interface SnapshotNode {
  nodeId: string;
  serviceId: string;
  provider: string;
  config: Record<string, string | number>;
  cost?: number;
  costBasis?: string;
  [key: string]: unknown;
}

/**
 * POST /api/projects/[id]/versions/[versionId]/restore — owner-only
 * (007 roadmap 1.1). History is append-only: restoring writes the chosen
 * snapshot as a NEW Architecture version (re-priced through the official
 * chain, estimate recomputed, chat thread notified) plus a new 'restore'
 * snapshot — earlier versions are never rewritten.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const session = await requireVerified();
    const { id, versionId } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    if (!Types.ObjectId.isValid(versionId)) {
      return NextResponse.json({ error: 'Unknown version.' }, { status: 404 });
    }
    const versionDoc = await ArchitectureVersion.findOne({ _id: versionId, projectId: project._id }).lean();
    if (!versionDoc) return NextResponse.json({ error: 'Unknown version.' }, { status: 404 });

    const snapshot = versionDoc.snapshot as unknown as VersionSnapshot;
    const nodes = (snapshot.nodes ?? []) as SnapshotNode[];
    const edges = snapshot.edges ?? [];
    const containers = snapshot.containers ?? [];
    const annotations = snapshot.annotations ?? [];
    const guidance = snapshot.guidance ?? {};

    // Re-price through the official chain — a restored snapshot's stored costs
    // may be stale.
    const estimate = await priceNodes(
      nodes.map((n) => ({ nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider as ProviderId, config: n.config ?? {} })),
      project.defaultRegion
    );
    const pricedNodes = nodes.map((n) => {
      const priced = estimate.perService.find((p) => p.nodeId === n.nodeId);
      return { ...n, cost: priced?.cost ?? n.cost ?? 0, costBasis: priced?.basis ?? n.costBasis ?? 'indicative' };
    });

    const current = await Architecture.findOne({ projectId: project._id }).select('version');
    const nextVersion = (current?.version ?? 0) + 1;
    await Architecture.updateOne(
      { projectId: project._id },
      {
        $set: {
          ownerId: project.ownerId,
          nodes: pricedNodes,
          edges,
          containers,
          annotations,
          guidance,
          version: nextVersion,
        },
      },
      { upsert: true }
    );

    project.providers = [...new Set(pricedNodes.map((n) => n.provider))] as ProviderId[];
    await project.save();
    const mergedEstimate = await recomputeProjectEstimate(project);

    const summary = `Restored version ${versionDoc.version} (as new version ${nextVersion})`;
    await AIConversation.updateOne(
      { projectId: project._id },
      {
        $push: {
          messages: {
            role: 'system',
            text: `${summary}.`,
            editsApplied: [summary],
            createdAt: new Date(),
          },
        },
        $setOnInsert: { ownerId: project.ownerId, status: 'idle', activeTools: [] },
      },
      { upsert: true }
    );

    await recordArchitectureVersion({
      projectId: project._id,
      ownerId: project.ownerId,
      version: nextVersion,
      source: 'restore',
      summary: [summary],
      snapshot: { nodes: pricedNodes, edges, containers, annotations, guidance },
    });

    return NextResponse.json({ version: nextVersion, estimate: mergedEstimate });
  } catch (e) {
    return fail(e);
  }
}
