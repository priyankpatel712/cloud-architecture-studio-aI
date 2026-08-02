import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LLM_PROVIDER_IDS } from '@/lib/llm-catalog';

/**
 * LlmSettings — the app-wide LLM provider configuration, a singleton document
 * (`key: 'llm'`). When present it overrides the LLM_* env vars; when absent the
 * server behaves exactly as before (env-only). API keys are stored per provider,
 * encrypted at rest (Constitution III), and never returned to the browser.
 */
const llmSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'llm' },
    provider: { type: String, enum: [...LLM_PROVIDER_IDS], default: null },
    model: { type: String, default: null },
    /** provider id → encrypted API key (lib/crypto.ts wire format) */
    encryptedKeys: { type: Map, of: String, default: () => ({}), select: false },
    /**
     * 008 FR-010/FR-016 — work class ('route', 'plan', …) → the connection that
     * should serve it, as "provider/model". Optional: with no entry a role falls
     * back to its tier defaults, so tiering works with zero configuration
     * (FR-015). Stores a connection CHOICE only — credentials continue to come
     * from encryptedKeys/env, so this introduces no new secret storage.
     */
    roleModels: { type: Map, of: String, default: () => ({}) },
    /**
     * 008 FR-016 — per-role model tiering on/off, stored with the rest of the AI
     * configuration rather than in an env var, so it is changed the same way the
     * provider and keys are: in Settings → AI Provider, applying to the whole
     * workspace immediately with no restart. `null` means never configured and
     * resolves to OFF — see resolveRoleTiering for why unset must not mean on.
     */
    roleTieringEnabled: { type: Boolean, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export type LlmSettingsDoc = InferSchemaType<typeof llmSettingsSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const LlmSettings: Model<LlmSettingsDoc> =
  (models.LlmSettings as Model<LlmSettingsDoc>) ??
  model<LlmSettingsDoc>('LlmSettings', llmSettingsSchema);
