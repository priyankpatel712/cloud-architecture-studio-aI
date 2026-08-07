import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { architecturePutSchema } from '@/lib/schemas';
import { getProjectForRead, getProjectForWrite } from '@/lib/projects';
import { Architecture } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';
import { recomputeProjectEstimate } from '@/lib/cost-estimate';
import { priceNodes } from '@/lib/pricing';
import { summarizeArchitectureEdit } from '@/lib/generate/diff';
import { recordArchitectureVersion } from '@/lib/versions';
import type { ProviderId } from '@/lib/providers/types';

export const runtime = 'nodejs';

// GET /api/projects/[id]/architecture — load the design (owner or shared read).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForRead(id, session.sub);
    const architecture = await Architecture.findOne({ projectId: project._id });
    return NextResponse.json({
      architecture: architecture
        ? {
            nodes: architecture.nodes,
            edges: architecture.edges,
            containers: architecture.containers ?? [],
            annotations: architecture.annotations ?? [],
            formatRules: architecture.formatRules ?? [],
            guidance: architecture.guidance,
            version: architecture.version,
          }
        : { nodes: [], edges: [], containers: [], annotations: [], formatRules: [], guidance: {}, version: 0 },
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PUT /api/projects/[id]/architecture — save the design (FR-023).
 * Optimistic concurrency (R9/Clarification): a save based on a stale `version` is
 * rejected with 409 + currentVersion so the client can reload and re-apply.
 * On success: version bump, official re-pricing, denormalized project totals, and a
 * system message on the project's chat thread (FR-016a).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, architecturePutSchema);

    const existing = await Architecture.findOne({ projectId: project._id });
    const currentVersion = existing?.version ?? 0;
    if (existing && body.version !== currentVersion) {
      return NextResponse.json(
        { error: 'conflict', currentVersion },
        { status: 409 }
      );
    }

    // Re-estimate via the official pricing chain (FR-020); per-node region, USD.
    const estimate = await priceNodes(
      body.nodes.map((n) => ({
        nodeId: n.nodeId,
        serviceId: n.serviceId,
        provider: n.provider as ProviderId,
        config: n.config,
      })),
      project.defaultRegion
    );
    const pricedNodes = body.nodes.map((n) => {
      const priced = estimate.perService.find((p) => p.nodeId === n.nodeId);
      return { ...n, cost: priced?.cost ?? 0, costBasis: priced?.basis ?? 'indicative' };
    });

    const before = existing
      ? {
          nodes: existing.nodes,
          edges: existing.edges,
          containers: existing.containers ?? [],
          annotations: existing.annotations ?? [],
        }
      : { nodes: [], edges: [], containers: [], annotations: [] };
    const nextVersion = currentVersion + 1;

    await Architecture.updateOne(
      { projectId: project._id },
      {
        $set: {
          ownerId: project.ownerId,
          nodes: pricedNodes,
          edges: body.edges,
          containers: body.containers,
          annotations: body.annotations,
          // Only an explicit formatRules field may overwrite stored rules —
          // see the schema note; chat-turn persists never touch them.
          ...(body.formatRules !== undefined ? { formatRules: body.formatRules } : {}),
          ...(body.guidance ? { guidance: body.guidance } : {}),
          version: nextVersion,
        },
      },
      { upsert: true }
    );

    // Provider mix + status denormalization for list views.
    project.providers = [...new Set(body.nodes.map((n) => n.provider))] as ('aws' | 'mongodb' | 'system')[];
    if (project.status === 'draft' && body.nodes.length > 0) project.status = 'active';
    await project.save();

    // 003 FR-010/FR-012/FR-013: the persisted estimate merges active overrides
    // (quantity precedence, stale re-derivation against the new configs) and
    // prunes overrides whose node was just removed. Diagram node costs above
    // stay system-computed — overrides never touch the canvas (FR-015).
    const mergedEstimate = await recomputeProjectEstimate(project);

    // FR-016a (+ 002 FR-017): keep the assistant's context in sync with direct
    // edits, including container/annotation changes.
    const changes = summarizeArchitectureEdit(before, {
      nodes: pricedNodes,
      edges: body.edges,
      containers: body.containers,
      annotations: body.annotations,
    });

    // 007 1.1 — version history snapshot (best-effort, never fails the save).
    await recordArchitectureVersion({
      projectId: project._id,
      ownerId: project.ownerId,
      version: nextVersion,
      source: 'direct-edit',
      summary: changes,
      snapshot: {
        nodes: pricedNodes,
        edges: body.edges,
        containers: body.containers,
        annotations: body.annotations,
        guidance: body.guidance ?? (existing?.guidance ? JSON.parse(JSON.stringify(existing.guidance)) : {}),
      },
    });
    if (changes.length > 0) {
      await AIConversation.updateOne(
        { projectId: project._id },
        {
          $push: {
            messages: {
              role: 'system',
              text: `Direct canvas edit: ${changes.join(', ')}.`,
              editsApplied: changes,
              createdAt: new Date(),
            },
          },
          $setOnInsert: { ownerId: project.ownerId, status: 'idle', activeTools: [] },
        },
        { upsert: true }
      );
    }

    return NextResponse.json({ version: nextVersion, estimate: mergedEstimate });
  } catch (e) {
    if (e instanceof HttpError) return fail(e);
    return fail(e);
  }
}
