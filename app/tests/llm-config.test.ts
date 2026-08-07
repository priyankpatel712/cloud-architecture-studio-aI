import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { envKeyFor, resolveLlmConfigFrom } from '@/lib/llm';
import type { LlmSettingsSnapshot } from '@/lib/llm-settings';

/**
 * Settings → env precedence for the LLM runtime config: in-app settings are
 * authoritative when they name a provider; otherwise the LLM_* env vars behave
 * exactly as before the settings feature existed.
 */

const LLM_ENV = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'HF_TOKEN',
  'HUGGINGFACE_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'CLOUDFLARE_API_TOKEN',
] as const;

const saved: Partial<Record<string, string | undefined>> = {};
for (const k of LLM_ENV) saved[k] = process.env[k];

beforeEach(() => {
  for (const k of LLM_ENV) delete process.env[k];
});

afterAll(() => {
  for (const k of LLM_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function snapshot(partial: Partial<LlmSettingsSnapshot>): LlmSettingsSnapshot {
  return { provider: null, model: null, keys: {}, storedKeyProviders: [], roleModels: {}, roleTieringEnabled: null, ...partial };
}

describe('resolveLlmConfigFrom — env fallback (no app settings)', () => {
  it('defaults to anthropic when nothing is set', () => {
    const cfg = resolveLlmConfigFrom(null);
    expect(cfg).toMatchObject({ provider: 'anthropic', source: 'env', apiKey: undefined });
    expect(cfg.model).toBe('claude-opus-4-8');
  });

  it('honours LLM_PROVIDER + LLM_MODEL + provider key env', () => {
    process.env.LLM_PROVIDER = 'nvidia';
    process.env.LLM_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    expect(resolveLlmConfigFrom(null)).toMatchObject({
      provider: 'nvidia',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
      apiKey: 'nvapi-test',
      source: 'env',
    });
  });

  it('ignores an unknown LLM_PROVIDER value', () => {
    process.env.LLM_PROVIDER = 'not-a-provider';
    expect(resolveLlmConfigFrom(null).provider).toBe('anthropic');
  });

  it('supports huggingface with HF_TOKEN or the HUGGINGFACE_API_KEY alias', () => {
    process.env.LLM_PROVIDER = 'huggingface';
    process.env.HF_TOKEN = 'hf_primary';
    expect(resolveLlmConfigFrom(null)).toMatchObject({
      provider: 'huggingface',
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      apiKey: 'hf_primary',
    });

    delete process.env.HF_TOKEN;
    process.env.HUGGINGFACE_API_KEY = 'hf_alias';
    expect(resolveLlmConfigFrom(null).apiKey).toBe('hf_alias');
  });

  it('lets the generic LLM_API_KEY win over provider-specific keys', () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk-specific';
    process.env.LLM_API_KEY = 'generic';
    expect(envKeyFor('groq')).toBe('generic');
  });
});

describe('resolveLlmConfigFrom — app settings take precedence', () => {
  it('uses the snapshot provider, model, and stored key over env', () => {
    process.env.LLM_PROVIDER = 'nvidia';
    process.env.LLM_MODEL = 'meta/llama-3.3-70b-instruct';
    process.env.NVIDIA_API_KEY = 'nvapi-env';
    const cfg = resolveLlmConfigFrom(
      snapshot({
        provider: 'huggingface',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        keys: { huggingface: 'hf_stored' },
        storedKeyProviders: ['huggingface'],
      })
    );
    expect(cfg).toMatchObject({
      provider: 'huggingface',
      model: 'Qwen/Qwen2.5-72B-Instruct',
      apiKey: 'hf_stored',
      source: 'app',
    });
  });

  it('falls back to the catalog default model when the snapshot has none', () => {
    const cfg = resolveLlmConfigFrom(snapshot({ provider: 'groq' }));
    expect(cfg.model).toBe('llama-3.3-70b-versatile');
  });

  it('falls back to that provider’s env key when no key is stored', () => {
    process.env.GEMINI_API_KEY = 'gm-env';
    const cfg = resolveLlmConfigFrom(snapshot({ provider: 'gemini' }));
    expect(cfg).toMatchObject({ provider: 'gemini', apiKey: 'gm-env', source: 'app' });
  });

  it('does not leak env LLM_MODEL into an app-selected provider', () => {
    process.env.LLM_MODEL = 'some-env-model';
    const cfg = resolveLlmConfigFrom(snapshot({ provider: 'nvidia' }));
    expect(cfg.model).toBe('nvidia/llama-3.3-nemotron-super-49b-v1');
  });
});
