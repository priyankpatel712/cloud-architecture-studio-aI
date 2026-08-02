import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * Persisted, reusable cache of official-MCP architecture guidance (research/
 * generation-quality improvement). Keyed by provider + the matched curated
 * reference-pattern ids (lib/generate/reference-patterns.ts) rather than raw
 * request text, so requests that vary in wording but land on the same
 * recognized architecture family (e.g. "serverless-api") reuse the same
 * guidance instead of re-querying the live MCP server every turn. Staleness is
 * checked manually against `staleAfter` (mirrors lib/generate/report.ts's
 * cache pattern) rather than a Mongo TTL index, keeping room for a future
 * explicit refresh.
 */
const mcpGuidanceCacheSchema = new Schema(
  {
    provider: { type: String, enum: ['aws', 'mongodb', 'system'], required: true },
    patternIds: { type: [String], required: true },
    /** `${provider}:${sortedPatternIds.join('+')}` */
    signature: { type: String, required: true, unique: true },
    guidanceText: { type: String, required: true },
    toolsInvoked: { type: [String], default: [] },
    fetchedAt: { type: Date, default: Date.now },
    staleAfter: { type: Date, required: true },
  },
  { timestamps: false }
);

export type McpGuidanceCacheDoc = InferSchemaType<typeof mcpGuidanceCacheSchema> & { _id: Types.ObjectId };

export const McpGuidanceCache: Model<McpGuidanceCacheDoc> =
  (models.McpGuidanceCache as Model<McpGuidanceCacheDoc>) ??
  model<McpGuidanceCacheDoc>('McpGuidanceCache', mcpGuidanceCacheSchema);
