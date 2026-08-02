import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * CostEstimateOverride — an edit-access user's manual override on one cost line
 * item (003 FR-008/FR-013, data-model.md, research R5/R6). One document per
 * (projectId, nodeId). Holds quantityOverride and/or totalCostOverride
 * independently; when both are set the quantity-derived price wins
 * (Clarification 2026-07-07). References the node only by its plain string id —
 * never a populated ref — so the cost layer stays decoupled from Architecture
 * (FR-015). Deleted on reset (FR-009) or when the underlying node is removed
 * (FR-013); clearing both values is expressed as deleting the document.
 */
const costEstimateOverrideSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    /** denormalized owner, for server-side access checks without a Project lookup */
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** ServiceNode.nodeId this override targets — loose string reference (R6) */
    nodeId: { type: String, required: true },
    /** overrides the service's quantityField config value; null = not set */
    quantityOverride: { type: Number, default: null },
    /** fixed monthly USD for this line; null = not set; quantity wins when both set */
    totalCostOverride: { type: Number, default: null },
    /** node config at set/confirm time — compared to live config for the stale flag (R11, FR-012) */
    configSnapshot: { type: Schema.Types.Mixed, default: {} },
    /** how the override was set (FR-008a) — display/audit only */
    source: { type: String, enum: ['inline', 'chat'], required: true },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    setAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

costEstimateOverrideSchema.index({ projectId: 1, nodeId: 1 }, { unique: true });

export type CostEstimateOverrideDoc = InferSchemaType<typeof costEstimateOverrideSchema> & {
  _id: Types.ObjectId;
};

export const CostEstimateOverride: Model<CostEstimateOverrideDoc> =
  (models.CostEstimateOverride as Model<CostEstimateOverrideDoc>) ??
  model<CostEstimateOverrideDoc>('CostEstimateOverride', costEstimateOverrideSchema);
