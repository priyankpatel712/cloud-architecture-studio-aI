import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * ArchitectureVersion — immutable per-save snapshot of a project's diagram
 * (007 roadmap 1.1: version history with restore). One document per persisted
 * Architecture.version, written best-effort by every persist path (direct
 * canvas save, chat turn, restore). History is append-only: restoring an old
 * version writes a NEW Architecture version + a NEW snapshot; existing
 * snapshots are never rewritten. Capped at VERSION_HISTORY_LIMIT per project
 * (oldest pruned on insert).
 *
 * The payload is stored as one Mixed blob (`snapshot`) rather than duplicated
 * subschemas: snapshots are write-once/read-back documents — reusing the live
 * Architecture subschemas here would silently strip fields whenever the live
 * schema gains one (the strict-mode lesson in the dev-server memory).
 */
const architectureVersionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** the Architecture.version this snapshot corresponds to */
    version: { type: Number, required: true },
    source: { type: String, enum: ['chat-turn', 'direct-edit', 'restore'], required: true },
    /** human-readable change summary (diff.ts editsApplied / PUT changes) */
    summary: { type: [String], default: [] },
    /** denormalized counts for the history list (no payload fetch needed) */
    counts: {
      nodes: { type: Number, default: 0 },
      edges: { type: Number, default: 0 },
      containers: { type: Number, default: 0 },
    },
    /** { nodes, edges, containers, annotations, guidance } — the full document at this version */
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);
architectureVersionSchema.index({ projectId: 1, version: -1 });

export type ArchitectureVersionDoc = InferSchemaType<typeof architectureVersionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ArchitectureVersion: Model<ArchitectureVersionDoc> =
  (models.ArchitectureVersion as Model<ArchitectureVersionDoc>) ??
  model<ArchitectureVersionDoc>('ArchitectureVersion', architectureVersionSchema);
