import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * Export — lightweight audit record of a produced artifact (FR-024, data-model.md).
 * The artifact itself is streamed/downloaded; only this record persists.
 */
const exportSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    /** 'estimate' = standalone cost-proposal export (003 FR-016);
     * 'report' = diagram + AI architecture report PDF */
    format: { type: String, enum: ['png', 'pdf', 'mermaid', 'json', 'estimate', 'report', 'terraform'], required: true },
    /** which report variant, when format === 'report' (lib/generate/report.ts) */
    reportType: { type: String, enum: ['developer', 'client', 'walkthrough'], required: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export type ExportDoc = InferSchemaType<typeof exportSchema> & { _id: Types.ObjectId };

export const ExportRecord: Model<ExportDoc> =
  (models.Export as Model<ExportDoc>) ?? model<ExportDoc>('Export', exportSchema);
