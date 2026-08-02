import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * KnowledgeEntry — reusable generation knowledge (feature 008 US3, FR-017;
 * data-model.md).
 *
 * The store the user asked for: "repetitive information related to generation
 * of the diagram, so it can be resolved easily". Holds seeded best-practice
 * rules, curated patterns, cached provider guidance, web-research findings, and
 * lessons the system distils from its own review corrections — so the same
 * knowledge is derived once and reused thereafter instead of being re-reasoned
 * on every turn.
 *
 * Editable at runtime (FR-032): an operator can disable a rule that turns out to
 * be wrong without a redeploy, which is why `enabled` exists separately from
 * deletion — a seeded rule deleted outright would simply return on next seed.
 */
const knowledgeEntrySchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['rule', 'pattern', 'guidance', 'lesson', 'service-note'],
      required: true,
      default: 'rule',
    },
    /** 'any' = provider-agnostic (core rules). */
    provider: { type: String, enum: ['aws', 'mongodb', 'system', 'any'], required: true, default: 'any' },
    designMode: { type: String, enum: ['cloud', 'hld', 'lld', 'any'], required: true, default: 'any' },
    title: { type: String, required: true, maxlength: 120 },
    /** Prompt-injectable text. Capped so six entries cannot crowd the prompt. */
    content: { type: String, required: true, maxlength: 600 },
    keywords: { type: [String], required: true, default: [] },
    source: { type: String, enum: ['seed', 'mcp', 'web', 'learned'], required: true },
    sourceUrl: { type: String, default: undefined },
    /** 0..1 — seeds are 1.0; a distilled lesson starts at 0.6 and must earn trust. */
    confidence: { type: Number, required: true, default: 1, min: 0, max: 1 },
    usageCount: { type: Number, required: true, default: 0 },
    lastUsedAt: { type: Date, default: undefined },
    /** Required for web/mcp findings — after this they are re-verified, not reused. */
    staleAfter: { type: Date, default: undefined },
    /** Operator disable (FR-032) — retained but never retrieved. */
    enabled: { type: Boolean, required: true, default: true },
    /** Normalized-content dedupe key (FR-022). */
    hash: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

// Retrieval filter: provider + design mode + enabled, before keyword ranking.
knowledgeEntrySchema.index({ provider: 1, designMode: 1, enabled: 1 });
// Text index supports future full-text ranking; keyword scoring is done in code
// today so the matching keyword stays visible for debugging.
knowledgeEntrySchema.index({ title: 'text', content: 'text', keywords: 'text' });
// Pruning scan (FR-022).
knowledgeEntrySchema.index({ lastUsedAt: 1 });

export type KnowledgeEntryDoc = InferSchemaType<typeof knowledgeEntrySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const KnowledgeEntry: Model<KnowledgeEntryDoc> =
  (models.KnowledgeEntry as Model<KnowledgeEntryDoc>) ??
  model<KnowledgeEntryDoc>('KnowledgeEntry', knowledgeEntrySchema);
