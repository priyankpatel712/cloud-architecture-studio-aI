import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, HttpError } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail, parseBody } from '@/lib/api';
import { llmSettingsPutSchema } from '@/lib/schemas';
import { LlmSettings } from '@/lib/models/LlmSettings';
import { encryptSecret } from '@/lib/crypto';
import { resolveLlmConfigFrom, previewRoleResolution, type RoleResolution } from '@/lib/llm';
import {
  loadLlmSettings,
  invalidateLlmSettingsCache,
  type LlmSettingsSnapshot,
} from '@/lib/llm-settings';
import { LLM_PROVIDER_LIST } from '@/lib/llm-catalog';

export const runtime = 'nodejs';

/**
 * App-wide AI provider configuration (Settings → AI Provider). Key values are
 * write-only: the view only ever says whether a key exists (stored / env),
 * never what it is (Constitution III).
 */
function settingsView(
  snapshot: LlmSettingsSnapshot | null,
  canManage: boolean,
  roleDefaults: RoleResolution[] = []
) {
  const active = resolveLlmConfigFrom(snapshot);
  const keys: Record<string, { stored: boolean; env: boolean }> = {};
  for (const info of LLM_PROVIDER_LIST) {
    keys[info.id] = {
      stored: snapshot?.storedKeyProviders.includes(info.id) ?? false,
      env: Boolean(
        process.env[info.keyEnv] || (info.keyEnvAliases ?? []).some((n) => process.env[n])
      ),
    };
  }
  return {
    active: {
      provider: active.provider,
      model: active.model,
      source: active.source,
      available: Boolean(active.apiKey),
    },
    saved: { provider: snapshot?.provider ?? null, model: snapshot?.model ?? null },
    // 008 — surfaced so the settings UI can show the effective tiering state and
    // per-role assignments without exposing any key material.
    roleTieringEnabled: snapshot?.roleTieringEnabled ?? null,
    roleModels: snapshot?.roleModels ?? {},
    // What each work class would actually use right now — so tiering can be
    // verified from this screen rather than by reading a generation trace.
    roleDefaults,
    env: { provider: process.env.LLM_PROVIDER ?? null, model: process.env.LLM_MODEL ?? null },
    keys,
    canManage,
  };
}

/** GET /api/settings/llm — current provider config (no key material). */
export async function GET() {
  try {
    const session = await requireVerified();
    const snapshot = await loadLlmSettings();
    return NextResponse.json({
      settings: settingsView(snapshot, can(session.role, 'settings:manage'), await previewRoleResolution()),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PUT /api/settings/llm — set the active provider/model and optionally store
 * (or clear) that provider's API key, encrypted at rest. settings:manage only.
 */
export async function PUT(req: Request) {
  try {
    const session = await requireVerified();
    if (!can(session.role, 'settings:manage')) {
      throw new HttpError(403, 'Only a super admin can change the AI provider.');
    }
    const body = await parseBody(req, llmSettingsPutSchema);
    await connectDB();

    const update: { $set: Record<string, unknown>; $unset?: Record<string, 1> } = {
      $set: {
        provider: body.provider,
        model: body.model.trim() || null,
        // 008 FR-016 — tiering and per-role assignments are part of the AI
        // configuration, changed here rather than in an env file.
        ...(body.roleTieringEnabled !== undefined ? { roleTieringEnabled: body.roleTieringEnabled } : {}),
        ...(body.roleModels !== undefined ? { roleModels: body.roleModels } : {}),
        updatedBy: session.sub,
      },
    };
    const newKey = body.apiKey.trim();
    if (newKey) update.$set[`encryptedKeys.${body.provider}`] = encryptSecret(newKey);
    else if (body.clearKey) update.$unset = { [`encryptedKeys.${body.provider}`]: 1 };

    await LlmSettings.findOneAndUpdate({ key: 'llm' }, update, { upsert: true });
    invalidateLlmSettingsCache();
    const snapshot = await loadLlmSettings();
    // Preview recomputed AFTER the write, so the response shows the effect of
    // the save the operator just made rather than the state before it.
    return NextResponse.json({ settings: settingsView(snapshot, true, await previewRoleResolution()) });
  } catch (e) {
    return fail(e);
  }
}
