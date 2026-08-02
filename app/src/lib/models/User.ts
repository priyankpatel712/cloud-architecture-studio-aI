import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';
import { ROLES } from '@/lib/rbac';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended', 'invited'], default: 'active', index: true },
    organization: { type: String, default: '' },
    lastLoginAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },
    // Email verification gate (FR-004): self-registered accounts must verify before
    // workspace access; seeded/admin-created accounts are pre-verified (Clarification).
    emailVerifiedAt: { type: Date, default: null },
    verifyTokenHash: { type: String, default: null, select: false },
    verifyTokenExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema> & {
  _id: import('mongoose').Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>('User', userSchema);
