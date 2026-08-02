import 'server-only';
import { connectDB } from '@/lib/db';
import { LlmSettings } from '@/lib/models/LlmSettings';
import { decryptSecret } from '@/lib/crypto';
import { LLM_PROVIDER_IDS, type LlmProviderId } from '@/lib/llm-catalog';

/**
 * DB-backed LLM settings with a short-lived in-process cache, so the hot path
 * (every llmJson call, plus the sync llmAvailable() checks throughout the
 * generate modules) never pays a query per call. The settings API invalidates
 * the cache on save; the TTL bounds staleness across other instances.
 */

export interface LlmSettingsSnapshot {
  provider: LlmProviderId | null;
  model: string | null;
  /** provider id → decrypted API key */
  keys: Partial<Record<LlmProviderId, string>>;
  /** provider ids that have a key stored (even if it failed to decrypt) */
  storedKeyProviders: LlmProviderId[];
  /** 008 — work class → "provider/model" override; empty when unconfigured. */
  roleModels: Record<string, string>;
  /** 008 — per-role tiering toggle; null = not set here, fall back to env. */
  roleTieringEnabled: boolean | null;
}

const TTL_MS = 30_000;
let cached: { snapshot: LlmSettingsSnapshot | null; at: number } | null = null;

export function invalidateLlmSettingsCache(): void {
  cached = null;
}

/** Cache-only read — no I/O. Null until loadLlmSettings has run in this process. */
export function peekLlmSettings(): LlmSettingsSnapshot | null {
  return cached?.snapshot ?? null;
}

/**
 * Load (or refresh) the settings snapshot. A DB failure must never take the
 * LLM path down with it — it logs and falls back to whatever is cached, else
 * null (pure env behaviour, exactly the pre-settings world).
 */
export async function loadLlmSettings(): Promise<LlmSettingsSnapshot | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  try {
    await connectDB();
    const doc = await LlmSettings.findOne({ key: 'llm' }).select('+encryptedKeys').lean();
    if (!doc) {
      cached = { snapshot: null, at: Date.now() };
      return null;
    }
    const keys: LlmSettingsSnapshot['keys'] = {};
    const storedKeyProviders: LlmProviderId[] = [];
    for (const [p, enc] of Object.entries(doc.encryptedKeys ?? {})) {
      if (!(LLM_PROVIDER_IDS as readonly string[]).includes(p) || !enc) continue;
      storedKeyProviders.push(p as LlmProviderId);
      try {
        keys[p as LlmProviderId] = decryptSecret(enc);
      } catch {
        // Undecryptable (ENCRYPTION_KEY rotated) — treat as absent so env can win.
        console.error(`[llm-settings] stored ${p} key failed to decrypt; ignoring it`);
      }
    }
    // 008 — role overrides are a plain "provider/model" map; unlike the key map
    // they hold no secret, so they are read without a select() and are safe to
    // surface in the settings API.
    const roleModels: Record<string, string> = {};
    for (const [role, value] of Object.entries(doc.roleModels ?? {})) {
      if (typeof value === 'string' && value.includes('/')) roleModels[role] = value;
    }
    const snapshot: LlmSettingsSnapshot = {
      provider: doc.provider ?? null,
      model: doc.model || null,
      keys,
      storedKeyProviders,
      roleModels,
      roleTieringEnabled: typeof doc.roleTieringEnabled === 'boolean' ? doc.roleTieringEnabled : null,
    };
    cached = { snapshot, at: Date.now() };
    return snapshot;
  } catch (e) {
    console.error('[llm-settings] load failed — falling back to env config:', e);
    return cached?.snapshot ?? null;
  }
}
