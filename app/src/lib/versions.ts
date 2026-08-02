import 'server-only';
import type { Types } from 'mongoose';
import { ArchitectureVersion } from '@/lib/models/ArchitectureVersion';

/**
 * Version-history recorder (007 roadmap 1.1). Called after every successful
 * Architecture persist with the JUST-WRITTEN state. Best-effort by design: a
 * snapshot failure must never fail the save that triggered it — history is a
 * convenience layer over the source of truth, not part of it.
 */

/** Newest snapshots kept per project; older ones are pruned on insert. */
export const VERSION_HISTORY_LIMIT = 50;

export interface VersionSnapshot {
  nodes: unknown[];
  edges: unknown[];
  containers: unknown[];
  annotations: unknown[];
  /** opaque blob — Guidance shape varies by caller and is stored verbatim */
  guidance: object;
}

export async function recordArchitectureVersion(opts: {
  projectId: Types.ObjectId | string;
  ownerId: Types.ObjectId | string;
  version: number;
  source: 'chat-turn' | 'direct-edit' | 'restore';
  summary?: string[];
  snapshot: VersionSnapshot;
}): Promise<void> {
  try {
    await ArchitectureVersion.create({
      projectId: opts.projectId,
      ownerId: opts.ownerId,
      version: opts.version,
      source: opts.source,
      summary: (opts.summary ?? []).slice(0, 20),
      counts: {
        nodes: opts.snapshot.nodes.length,
        edges: opts.snapshot.edges.length,
        containers: opts.snapshot.containers.length,
      },
      snapshot: opts.snapshot,
    });
    // Prune beyond the cap — find the cutoff version among the newest LIMIT.
    const keep = await ArchitectureVersion.find({ projectId: opts.projectId })
      .sort({ version: -1 })
      .skip(VERSION_HISTORY_LIMIT - 1)
      .limit(1)
      .select('version')
      .lean();
    if (keep.length > 0) {
      await ArchitectureVersion.deleteMany({ projectId: opts.projectId, version: { $lt: keep[0].version } });
    }
  } catch (e) {
    console.error('[versions] failed to record architecture version (save unaffected):', e);
  }
}
