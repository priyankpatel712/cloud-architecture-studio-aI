import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * GenerationRun — one chat turn's full agentic-loop trace (feature 004,
 * data-model.md). Kept as a separate collection so the frequently-read
 * AIConversation thread never carries trace weight (research R5, Clarification
 * 2026-07-09 Q3); referenced by the assistant message's `runId` and fetched on
 * demand via GET /api/projects/[id]/chat/runs/[runId]. Retained in full under
 * the loop budget — no step truncation. Deleted with its project/conversation.
 */
const traceStepSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: {
      type: String,
      // 006 adds 'analyze' | 'options' | 'finalize' (guided flow phases); 008 adds
      // 'intent' | 'direct-edit' | 'knowledge' | 'research' | 'distill' (multi-agent
      // steps) — keep in sync with trace-emitter.ts StepKind. A kind missing here
      // makes the whole run fail to persist, losing the trace for the turn.
      enum: [
        'understand', 'lookup', 'draft', 'review', 'refine', 'layout', 'price',
        'validate', 'persist', 'cost', 'analyze', 'options', 'finalize',
        'intent', 'direct-edit', 'knowledge', 'research', 'distill',
      ],
      required: true,
    },
    label: { type: String, required: true },
    detail: { type: String, default: undefined },
    iteration: { type: Number, required: true, min: 1 },
    /** 1-based chunk index within this step's iteration (feature 005) — absent for a non-chunked step. */
    chunk: { type: Number, default: undefined },
    status: { type: String, enum: ['done', 'failed'], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: undefined },
  },
  { _id: false }
);

/**
 * One completed LLM request during the turn (interpretability, 2026-08) —
 * which provider/model/tier actually served which trace step, including
 * fallback hops and rate-limited attempts. Kept in sync with
 * trace-emitter.ts TraceModelCallRecord. Metadata only, never prompt text
 * (same privacy rule as LlmUsage).
 */
const modelCallSchema = new Schema(
  {
    id: { type: String, required: true },
    /** the trace step running when the call fired; '' when none was open */
    stepId: { type: String, default: '' },
    role: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    tier: { type: String, enum: ['small', 'mid', 'large'], default: 'mid' },
    status: { type: String, enum: ['ok', 'rate_limited', 'error'], required: true },
    latencyMs: { type: Number, default: 0 },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const generationRunSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'AIConversation', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    iterations: { type: Number, required: true, min: 1 },
    converged: { type: Boolean, required: true },
    stopped: { type: Boolean, required: true, default: false },
    terminalStatus: { type: String, enum: ['converged', 'best_effort', 'failed', 'stopped'], required: true },
    /**
     * 006 (data-model.md §3) — which guided-flow phase this turn ran; absent on
     * legacy/small-edit runs. Non-build phase turns record terminalStatus
     * 'converged' on success, 'failed'/'stopped' as today.
     */
    flowPhase: { type: String, enum: ['analyze', 'build', 'cost', 'finalize'], default: undefined },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: undefined },
    steps: { type: [traceStepSchema], default: [] },
    modelCalls: { type: [modelCallSchema], default: [] },
  },
  { timestamps: true }
);

export type TraceStep = InferSchemaType<typeof traceStepSchema>;
export type TraceModelCall = InferSchemaType<typeof modelCallSchema>;
export type GenerationRunDoc = InferSchemaType<typeof generationRunSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const GenerationRun: Model<GenerationRunDoc> =
  (models.GenerationRun as Model<GenerationRunDoc>) ??
  model<GenerationRunDoc>('GenerationRun', generationRunSchema);
