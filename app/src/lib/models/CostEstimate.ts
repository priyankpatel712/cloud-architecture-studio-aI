import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * CostEstimate — computed monthly/annual/per-service cost snapshot for an
 * architecture (FR-019, FR-021, data-model.md). `basis` is 'exact' only when every
 * service was priced from an official source; USD, per-node region (Clarification).
 */
const perServiceSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    serviceId: { type: String, required: true },
    cost: { type: Number, required: true },
    basis: { type: String, enum: ['exact', 'indicative'], required: true },
    region: { type: String, default: 'us-east-1' },
    /** 003 FR-009 — this line's value comes from a CostEstimateOverride */
    overridden: { type: Boolean, default: false },
    /** 003 FR-012 — node config changed since the override was set/confirmed */
    stale: { type: Boolean, default: false },
  },
  { _id: false }
);

const costEstimateSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    monthly: { type: Number, required: true },
    annual: { type: Number, required: true },
    perService: { type: [perServiceSchema], default: [] },
    basis: { type: String, enum: ['exact', 'indicative'], required: true },
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export type CostEstimateDoc = InferSchemaType<typeof costEstimateSchema> & {
  _id: Types.ObjectId;
};

export const CostEstimate: Model<CostEstimateDoc> =
  (models.CostEstimate as Model<CostEstimateDoc>) ??
  model<CostEstimateDoc>('CostEstimate', costEstimateSchema);
