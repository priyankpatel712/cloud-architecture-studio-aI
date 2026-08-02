import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * AIConversation — one persistent chat thread per project (FR-014a–d, data-model.md).
 * `activeTools` implements sticky tool attachment (Clarification 2026-07-06): once a
 * provider tool is attached it stays active for subsequent messages until detached.
 * Each message records the tools attached to it, the official MCP tools invoked, and
 * the resulting architecture edits. Shared users may view; only the owner posts.
 * Deleted with its project; not copied on duplication (thread lifecycle clarification).
 */
const mcpCallSchema = new Schema(
  {
    provider: { type: String, enum: ['aws', 'mongodb', 'system'], required: true },
    tool: { type: String, required: true },
    status: { type: String, enum: ['ok', 'failed'], required: true },
  },
  { _id: false }
);

/**
 * 006 (data-model.md §2) — guided-flow interaction subdocuments. A structured
 * question round or pricing-option round attached to an assistant message; the
 * thread itself is the durable Q&A record (FR-006). All fields optional at the
 * message level so legacy messages stay valid.
 */
const questionOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    /** one-line trade-off shown next to the option (FR-003) */
    detail: { type: String, default: '' },
    /** service_choice only — catalog-validated serviceId */
    serviceId: { type: String, default: undefined },
    recommended: { type: Boolean, default: false },
  },
  { _id: false }
);

const questionResolutionSchema = new Schema(
  {
    kind: { type: String, enum: ['answered', 'skipped'], required: true },
    optionId: { type: String, default: undefined },
    text: { type: String, default: undefined },
  },
  { _id: false }
);

const validationQuestionSchema = new Schema(
  {
    id: { type: String, required: true },
    prompt: { type: String, required: true },
    /** which gap this question closes (FR-002 rationale) */
    why: { type: String, default: '' },
    kind: { type: String, enum: ['text', 'single_select', 'service_choice'], required: true },
    /** service_choice only — the capability/need the choice resolves */
    need: { type: String, default: undefined },
    options: { type: [questionOptionSchema], default: [] },
    /** always true (FR-004) — kept explicit for the contract */
    skippable: { type: Boolean, default: true },
    resolution: { type: questionResolutionSchema, default: undefined },
  },
  { _id: false }
);

const pricedLineSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    serviceId: { type: String, required: true },
    cost: { type: Number, required: true },
    basis: { type: String, enum: ['exact', 'indicative'], required: true },
  },
  { _id: false }
);

const pricingOptionSchema = new Schema(
  {
    /** 'cheapest' | 'best_practice' (extensible — both mandatory per FR-010) */
    id: { type: String, required: true },
    label: { type: String, required: true },
    /** plain-language trade-off summary */
    summary: { type: String, default: '' },
    /** priced by the engine (priceNodes), never by the LLM */
    monthly: { type: Number, required: true },
    indicative: { type: Boolean, default: false },
    perService: { type: [pricedLineSchema], default: [] },
    /** full replacement config per touched node, clamped pre-pricing */
    patches: { type: [new Schema({ nodeId: { type: String, required: true }, config: { type: Schema.Types.Mixed, default: {} } }, { _id: false })], default: [] },
    /** true when the rule-based fallback produced it (research D5) */
    degraded: { type: Boolean, default: false },
  },
  { _id: false }
);

const interactionSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ['clarify', 'cost_questions', 'cost_options'], required: true },
    status: { type: String, enum: ['open', 'answered', 'skipped', 'superseded'], default: 'open' },
    questions: { type: [validationQuestionSchema], default: [] },
    options: { type: [pricingOptionSchema], default: [] },
  },
  { _id: false }
);

/**
 * 006 (data-model.md §1) — RequirementBrief: the consolidated analysis +
 * resolved answers the build turn plans from (FR-006). Embedded on the
 * conversation's flow state; superseded wholesale on a material request change.
 */
const briefSchema = new Schema(
  {
    requestText: { type: String, default: '' },
    requestClass: { type: String, enum: ['new', 'major_revision', 'small_edit'], default: 'major_revision' },
    /**
     * 008 (FR-002) — `status` and `firstSeenTurn` make this a CUMULATIVE ledger
     * rather than a per-turn snapshot: a requirement stated in turn 1 keeps
     * being graded in turn 5 unless the user withdraws it. Both are optional, so
     * conversations written before 008 load unchanged (a missing status is
     * treated as 'pending').
     */
    capabilities: {
      type: [new Schema({
        id: String,
        text: { type: String, required: true },
        source: { type: String, enum: ['stated', 'inferred'], default: 'stated' },
        status: { type: String, enum: ['met', 'pending', 'withdrawn'], default: 'pending' },
        firstSeenTurn: { type: Number, default: undefined },
      }, { _id: false })],
      default: [],
    },
    scaleAssumptions: {
      type: [new Schema({ key: { type: String, required: true }, value: { type: String, default: '' }, source: { type: String, enum: ['stated', 'answered', 'defaulted'], default: 'stated' } }, { _id: false })],
      default: [],
    },
    constraints: { type: [String], default: [] },
    /** existing nodeIds the request targets (preserve-user-work scope) */
    changeScope: { type: [String], default: [] },
    /** explicit service choices — build MUSTs (FR-008) */
    selections: {
      type: [new Schema({ questionId: { type: String, required: true }, need: { type: String, default: '' }, serviceId: { type: String, required: true } }, { _id: false })],
      default: [],
    },
    /** human-readable defaults applied on skip, disclosed in the reply (FR-004) */
    defaultsApplied: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * 006 (data-model.md §1/§4) — conversation-level guided-flow state machine.
 * `awaiting` names the open round; null means no round is open. Absent entirely
 * on legacy threads (every field optional — no migration).
 */
const flowSchema = new Schema(
  {
    awaiting: { type: String, enum: ['clarify', 'cost_questions', 'cost_options', null], default: null },
    brief: { type: briefSchema, default: undefined },
    openInteractionId: { type: String, default: null },
    /**
     * Position snapshot of nodes present BEFORE the guided build — the finalize
     * pass restores these (when the node's container membership is unchanged)
     * so user-arranged work keeps its exact placement (FR-012 / US3-S3).
     */
    preservedNodes: {
      type: [new Schema({
        nodeId: { type: String, required: true },
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        containerId: { type: String, default: null },
      }, { _id: false })],
      default: [],
    },
    pricingOptions: { type: [pricingOptionSchema], default: [] },
    selectedOptionId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, default: '' },
    /** provider tools attached to this prompt (user messages) */
    attachedTools: { type: [String], enum: ['aws', 'mongodb', 'system'], default: [] },
    /** official MCP tools invoked (assistant messages) */
    mcpCalls: { type: [mcpCallSchema], default: [] },
    /** summary of node/edge/config changes applied to the Architecture */
    editsApplied: { type: [String], default: [] },
    /** true when produced without the official sources (labelled indicative mode) */
    indicative: { type: Boolean, default: false },
    /**
     * 003 (research R2) — the spec's GenerationAttempt entity, realized here:
     * set only on assistant messages produced by a failed turn; records which
     * phase failed and whether a retry can help (config failures can't).
     */
    error: {
      type: new Schema(
        {
          step: { type: String, enum: ['architecture', 'cost'], required: true },
          retryable: { type: Boolean, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    /**
     * 004 (data-model.md) — run summary for assistant messages produced by the
     * agentic loop. Lightweight by design: the full trace lives in a separate
     * `GenerationRun` document (research R5, Clarification 2026-07-09 Q3) so
     * routine thread reads never load step-level detail. Absent on pre-004
     * messages — the UI hides the "Show working" affordance when `runId` is unset.
     */
    runId: { type: Schema.Types.ObjectId, ref: 'GenerationRun', default: undefined },
    iterations: { type: Number, default: undefined },
    converged: { type: Boolean, default: undefined },
    stopped: { type: Boolean, default: undefined },
    stepCount: { type: Number, default: undefined },
    /**
     * Interpretability (2026-08) — the final review's per-requirement
     * evaluation of the applied diagram (reviewer.ts RequirementCoverage).
     * Small and user-facing (like editsApplied), so it lives on the message
     * rather than the GenerationRun: the thread renders it without a second
     * fetch. Absent when the turn had no requirement checklist.
     */
    coverage: {
      type: [
        new Schema(
          {
            requirement: { type: String, required: true },
            met: { type: Boolean, required: true },
            evidence: { type: String, default: '' },
            gap: { type: String, default: '' },
          },
          { _id: false }
        ),
      ],
      default: undefined,
    },
    /**
     * 006 (data-model.md §2) — structured guided-flow round attached to this
     * assistant message (question round or pricing options). Absent on
     * non-guided messages; the UI renders the interaction card when present.
     */
    interaction: { type: interactionSchema, default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
    status: { type: String, enum: ['idle', 'generating', 'failed'], default: 'idle' },
    /** sticky attached provider tools (Clarification: sticky per conversation) */
    activeTools: { type: [String], enum: ['aws', 'mongodb', 'system'], default: [] },
    /**
     * Sticky diagram mode chosen by the dynamic router (cloud = provider-specific
     * architecture; hld/lld = generic system design). Follow-up turns inherit it
     * unless the router detects an explicit pivot in the new message.
     */
    designMode: { type: String, enum: ['cloud', 'hld', 'lld'], default: 'cloud' },
    /** 004 FR-009 — set by POST /chat/stop; honored only while status === 'generating'; cleared at turn end */
    stopRequested: { type: Boolean, default: false },
    /** 006 — guided-flow state machine (data-model.md §1/§4); absent on legacy threads */
    flow: { type: flowSchema, default: undefined },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

export type ConversationInteraction = InferSchemaType<typeof interactionSchema>;
export type ConversationValidationQuestion = InferSchemaType<typeof validationQuestionSchema>;
export type ConversationPricingOption = InferSchemaType<typeof pricingOptionSchema>;
export type ConversationBrief = InferSchemaType<typeof briefSchema>;
export type ConversationFlow = InferSchemaType<typeof flowSchema>;
export type ConversationMessage = InferSchemaType<typeof messageSchema>;
export type AIConversationDoc = InferSchemaType<typeof conversationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AIConversation: Model<AIConversationDoc> =
  (models.AIConversation as Model<AIConversationDoc>) ??
  model<AIConversationDoc>('AIConversation', conversationSchema);
