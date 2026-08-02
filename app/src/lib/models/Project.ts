import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * Project — a named, owned container for an architecture (FR-022, data-model.md).
 * Owned by `ownerId`; readable by users in `sharedWith` (single shared workspace —
 * any registered user can be a share target). Mutations are owner-only.
 */
const projectSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    providers: { type: [String], enum: ['aws', 'mongodb', 'system'], default: [] },
    sharedWith: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    /** denormalized for list views (data-model.md) */
    currentEstimateMonthly: { type: Number, default: 0 },
    /** pricing fallback region when a node has none (Clarification: per-node region, USD) */
    defaultRegion: { type: String, default: 'us-east-1' },
    /**
     * 007 1.3 — public read-only share link. The unguessable token IS the
     * credential (crypto-random, revocable); null = no public link. Sparse so
     * absent tokens don't collide in the index.
     */
    shareToken: { type: String, default: null, index: { sparse: true } },
  },
  { timestamps: true }
);

export type ProjectDoc = InferSchemaType<typeof projectSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Project: Model<ProjectDoc> =
  (models.Project as Model<ProjectDoc>) ?? model<ProjectDoc>('Project', projectSchema);

/** owner or shared-with may read; only the owner may mutate */
export function canReadProject(p: ProjectDoc, userId: string): boolean {
  return String(p.ownerId) === userId || p.sharedWith.some((u) => String(u) === userId);
}
export function canEditProject(p: ProjectDoc, userId: string): boolean {
  return String(p.ownerId) === userId;
}
