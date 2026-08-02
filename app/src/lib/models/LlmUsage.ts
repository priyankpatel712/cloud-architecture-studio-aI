import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * LlmUsage — one record per model request (feature 008 US2, FR-014;
 * data-model.md).
 *
 * WHY THIS EXISTS
 * Before 008 the `usage` object on every provider response was discarded, so
 * the app could not answer basic questions: which model actually served a turn,
 * how many requests a provider had taken in the last minute, or whether model
 * tiering changed anything. The Settings "usage this month" panel was hardcoded
 * mock data. Three consumers need this:
 *   1. pre-flight rate-limit avoidance — skip a provider already at its ceiling
 *      (FR-013) instead of discovering it via a 429
 *   2. the real usage panel (FR-031)
 *   3. SC-003 / SC-004 verification (fast path uses no large model; at least
 *      half of requests are small/mid tier)
 *
 * PRIVACY: counts and metadata only. No prompt text, no completion text, ever.
 *
 * Writes are fire-and-forget: a failure here must never fail a generation turn.
 */
const llmUsageSchema = new Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true },
    /**
     * The work class that made the call ('route', 'plan', …), or 'unspecified'
     * for a call site not yet tagged with a role — which is how the migration
     * progress is measured.
     */
    role: { type: String, required: true, default: 'unspecified' },
    /** Capability tier that actually served the request — drives SC-004. */
    tier: { type: String, enum: ['small', 'mid', 'large'], default: 'mid' },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, required: true },
    status: { type: String, enum: ['ok', 'rate_limited', 'error'], required: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false }
);

// Sliding-window budget check (FR-013): "how many requests has this provider
// taken in the last N seconds?" must be an indexed lookup, since it runs before
// potentially every call.
llmUsageSchema.index({ provider: 1, at: -1 });
// Bounded growth without manual cleanup — 30 days is well beyond the longest
// reporting window the settings panel offers.
llmUsageSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type LlmUsageDoc = InferSchemaType<typeof llmUsageSchema> & { _id: Types.ObjectId };

export const LlmUsage: Model<LlmUsageDoc> =
  (models.LlmUsage as Model<LlmUsageDoc>) ?? model<LlmUsageDoc>('LlmUsage', llmUsageSchema);
