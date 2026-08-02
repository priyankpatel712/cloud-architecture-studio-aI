import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * CommentThread — pin-style discussion threads on a project's diagram
 * (007 roadmap 2.2). Anchored to a service/container node or to the project
 * as a whole. Anyone with read access (owner + shared-with) may comment;
 * resolve/delete is limited to the thread author or the project owner.
 * No realtime infra — clients refetch on open/interval.
 */
const commentMessageSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** denormalized for display — avoids an N+1 user lookup per message */
    authorName: { type: String, default: '' },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const commentThreadSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    anchor: {
      kind: { type: String, enum: ['node', 'container', 'project'], required: true },
      /** nodeId/containerId when kind is node/container */
      targetId: { type: String, default: null },
      /** display label captured at creation (survives element deletion) */
      targetLabel: { type: String, default: '' },
    },
    resolved: { type: Boolean, default: false, index: true },
    messages: { type: [commentMessageSchema], default: [] },
  },
  { timestamps: true }
);
commentThreadSchema.index({ projectId: 1, resolved: 1, updatedAt: -1 });

export type CommentMessage = InferSchemaType<typeof commentMessageSchema>;
export type CommentThreadDoc = InferSchemaType<typeof commentThreadSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CommentThread: Model<CommentThreadDoc> =
  (models.CommentThread as Model<CommentThreadDoc>) ??
  model<CommentThreadDoc>('CommentThread', commentThreadSchema);
