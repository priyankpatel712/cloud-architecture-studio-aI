import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * Architecture — the design within a project (001 FR-023; extended by feature 002
 * data-model.md). Embedded ServiceNode/ServiceEdge plus typed boundary containers,
 * annotations, edge styling, and display names — all optional with defaults so
 * pre-002 documents load unchanged. `version` implements optimistic concurrency
 * (001 R9): a save with a stale version is rejected with 409.
 */
const serviceNodeSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    serviceId: { type: String, required: true },
    provider: { type: String, enum: ['aws', 'mongodb', 'system'], required: true },
    category: { type: String, default: '' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    config: { type: Schema.Types.Mixed, default: {} },
    cost: { type: Number, default: 0 },
    costBasis: { type: String, enum: ['exact', 'indicative'], default: 'indicative' },
    /** user-facing rename; catalog service identity + pricing untouched (002 FR-013) */
    displayName: { type: String, default: '' },
    /** container membership; validated against the container tree on save (002 FR-005) */
    containerId: { type: String, default: null },
    /** 007 2.3 — optional user accent override (constrained token, like edge colors) */
    accent: { type: String, enum: ['default', 'primary', 'success', 'warning', 'danger'], default: 'default' },
  },
  { _id: false }
);

const edgeStyleSchema = new Schema(
  {
    geometry: { type: String, enum: ['orthogonal', 'straight', 'curved'], default: 'orthogonal' },
    pattern: { type: String, enum: ['solid', 'dashed'], default: 'solid' },
    arrowheads: { type: String, enum: ['none', 'end', 'both'], default: 'end' },
    /** constrained palette token, never raw CSS (002 data-model) */
    color: { type: String, enum: ['default', 'primary', 'success', 'warning', 'danger'], default: 'default' },
  },
  { _id: false }
);

const serviceEdgeSchema = new Schema(
  {
    edgeId: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    /** connection sides (any-side handles); absent = legacy right → left */
    sourceHandle: { type: String, enum: ['top', 'right', 'bottom', 'left'], default: undefined },
    targetHandle: { type: String, enum: ['top', 'right', 'bottom', 'left'], default: undefined },
    label: { type: String, default: '' },
    style: { type: edgeStyleSchema, default: () => ({}) },
    /** manual path adjustments, preserved where possible (002 FR-002) */
    waypoints: { type: [{ x: Number, y: Number, _id: false }], default: [] },
  },
  { _id: false }
);

/** Typed cloud boundary (002 FR-005–007). Cost-free; never sent to providers as a service. */
const containerSchema = new Schema(
  {
    containerId: { type: String, required: true },
    /** 'group' or a provider-declared container type id (cloud/region/vpc/az/subnet/project/cluster) */
    type: { type: String, required: true, default: 'group' },
    label: { type: String, default: '' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    size: {
      width: { type: Number, default: 400 },
      height: { type: Number, default: 300 },
    },
    parentContainerId: { type: String, default: null },
  },
  { _id: false }
);

/** Note/sticky (002 FR-014). Excluded from cost totals and provider semantics. */
const annotationSchema = new Schema(
  {
    annotationId: { type: String, required: true },
    kind: { type: String, enum: ['text', 'sticky'], default: 'text' },
    content: { type: String, default: '' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    size: {
      width: { type: Number, default: 200 },
      height: { type: Number, default: 120 },
    },
    style: {
      color: {
        type: String,
        enum: ['default', 'yellow', 'blue', 'green', 'pink'],
        default: 'default',
      },
    },
    /** 007 2.3 — persisted stacking order (bring-to-front/send-to-back) */
    z: { type: Number, default: 0 },
  },
  { _id: false }
);

const architectureSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    nodes: { type: [serviceNodeSchema], default: [] },
    edges: { type: [serviceEdgeSchema], default: [] },
    containers: { type: [containerSchema], default: [] },
    annotations: { type: [annotationSchema], default: [] },
    guidance: {
      network: { type: String, default: '' },
      security: { type: String, default: '' },
      ha: { type: String, default: '' },
      dr: { type: String, default: '' },
      scaling: { type: String, default: '' },
    },
    version: { type: Number, default: 1 },
    generatedFrom: { type: Schema.Types.ObjectId, ref: 'AIConversation', default: null },
    /** AI architecture report (lib/generate/report.ts), cached per version —
     * regenerated only when the architecture changes or on explicit refresh. */
    report: { type: Schema.Types.Mixed, default: null },
    reportVersion: { type: Number, default: 0 },
    /** Client-proposal report variant (lib/generate/report.ts), cached independently of `report`. */
    reportClient: { type: Schema.Types.Mixed, default: null },
    reportClientVersion: { type: Number, default: 0 },
    /** Step-by-step client walkthrough (lib/generate/walkthrough.ts), cached independently. */
    reportWalkthrough: { type: Schema.Types.Mixed, default: null },
    reportWalkthroughVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type ServiceNode = InferSchemaType<typeof serviceNodeSchema>;
export type ServiceEdge = InferSchemaType<typeof serviceEdgeSchema>;
export type ArchContainer = InferSchemaType<typeof containerSchema>;
export type ArchAnnotation = InferSchemaType<typeof annotationSchema>;
export type ArchitectureDoc = InferSchemaType<typeof architectureSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Architecture: Model<ArchitectureDoc> =
  (models.Architecture as Model<ArchitectureDoc>) ??
  model<ArchitectureDoc>('Architecture', architectureSchema);
