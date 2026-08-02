import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * CloudConnection — a link to a provider account (FR-011–013, data-model.md).
 * AWS: IAM Identity Center SSO — only the temporary session is stored, encrypted
 * (`encryptedSession`, select:false); never long-term credentials (FR-012).
 * MongoDB: Atlas org with scoped read credentials, encrypted (`encryptedApiKey`).
 */
const connectionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['aws', 'mongodb', 'system'], required: true },
    status: {
      type: String,
      enum: ['pending', 'connected', 'expired', 'disconnected'],
      default: 'pending',
      index: true,
    },
    // --- AWS (temporary SSO session details; FR-012) ---
    accountId: { type: String, default: null },
    alias: { type: String, default: null },
    region: { type: String, default: null },
    permissionSet: { type: String, default: null },
    sessionExpiresAt: { type: Date, default: null },
    /** encrypted temporary session material (device/access token) — never plaintext */
    encryptedSession: { type: String, default: null, select: false },
    // --- MongoDB Atlas (scoped read) ---
    orgId: { type: String, default: null },
    orgName: { type: String, default: null },
    projectsCount: { type: Number, default: 0 },
    encryptedApiKey: { type: String, default: null, select: false },
  },
  { timestamps: true }
);

connectionSchema.index({ ownerId: 1, provider: 1 }, { unique: true });

export type ConnectionDoc = InferSchemaType<typeof connectionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Connection: Model<ConnectionDoc> =
  (models.Connection as Model<ConnectionDoc>) ??
  model<ConnectionDoc>('Connection', connectionSchema);
