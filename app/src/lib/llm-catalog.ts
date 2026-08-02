/**
 * LLM provider catalog — shared, client-safe metadata (no secrets, no server-only).
 * The settings UI renders from this and lib/llm.ts resolves runtime config against
 * it, so adding a provider is one entry here plus (if it isn't OpenAI-compatible)
 * a dispatch branch in lib/llm.ts.
 */

export const LLM_PROVIDER_IDS = [
  'nvidia',
  'groq',
  'gemini',
  'openrouter',
  'huggingface',
  'anthropic',
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

/**
 * Capability tier used to match a model to a class of work (feature 008).
 * 'small' — classification, interpretation, summarising; 'mid' — analysis,
 * review, costing; 'large' — architecture design. Tiers are relative capability
 * bands, not vendor sizes: what matters is which band a role may draw from.
 */
export type LlmModelTier = 'small' | 'mid' | 'large';

export interface LlmModelInfo {
  id: string;
  tier: LlmModelTier;
  /** Context window in tokens, as published by the provider. */
  ctx: number;
  multimodal: boolean;
}

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
  blurb: string;
  defaultModel: string;
  /** Suggested model ids for the settings UI (any model id is accepted). */
  models: string[];
  /**
   * Capability metadata for the suggested models, keyed by model id. Only the
   * catalog's own suggestions are described — a user-entered model id that is
   * absent here resolves to `DEFAULT_MODEL_INFO` rather than being rejected, so
   * an unknown model never blocks a call.
   */
  modelInfo: Record<string, LlmModelInfo>;
  /** Env var the server reads when no key is stored in app settings. */
  keyEnv: string;
  /** Alternative env var names also honoured for this provider. */
  keyEnvAliases?: string[];
  /** Where to create an API key. */
  keyUrl: string;
}

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderInfo> = {
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    blurb: 'Hosted NIM endpoints (integrate.api.nvidia.com) with a generous free tier.',
    // Nemotron-49b is the reliable choice on NIM's free tier — the popular
    // meta/llama models are frequently congested there (observed 2026-07-13:
    // meta/llama-3.3-70b-instruct hanging past 45s while nemotron answers in ~4s).
    defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    models: [
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'meta/llama-3.3-70b-instruct',
      // Replaces `qwen/qwen2.5-coder-32b-instruct`, withdrawn from NIM (caught by
      // `npm run models:check`, 2026-08-01). Kept as a genuine SMALL model:
      // without one here the small-tier roles fall through to the 49b default,
      // which is the load this feature exists to remove.
      'meta/llama-3.1-8b-instruct',
    ],
    modelInfo: {
      'nvidia/llama-3.3-nemotron-super-49b-v1': { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', tier: 'large', ctx: 131072, multimodal: false },
      'meta/llama-3.3-70b-instruct': { id: 'meta/llama-3.3-70b-instruct', tier: 'mid', ctx: 131072, multimodal: false },
      'meta/llama-3.1-8b-instruct': { id: 'meta/llama-3.1-8b-instruct', tier: 'small', ctx: 131072, multimodal: false },
    },
    keyEnv: 'NVIDIA_API_KEY',
    keyUrl: 'https://build.nvidia.com',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    blurb: 'Very low latency open-weight models on Groq LPUs.',
    defaultModel: 'llama-3.3-70b-versatile',
    // Groq retires models often (llama-4 maverick is gone — 2026-07-13); the
    // settings UI overlays this list with the account's live /models response.
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'qwen/qwen3.6-27b'],
    modelInfo: {
      'llama-3.3-70b-versatile': { id: 'llama-3.3-70b-versatile', tier: 'mid', ctx: 131072, multimodal: false },
      'openai/gpt-oss-120b': { id: 'openai/gpt-oss-120b', tier: 'large', ctx: 131072, multimodal: false },
      'llama-3.1-8b-instant': { id: 'llama-3.1-8b-instant', tier: 'small', ctx: 131072, multimodal: false },
      'qwen/qwen3.6-27b': { id: 'qwen/qwen3.6-27b', tier: 'small', ctx: 131072, multimodal: false },
    },
    keyEnv: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    blurb: 'Gemini via the OpenAI-compatible endpoint (free tier is capped per day).',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    modelInfo: {
      'gemini-2.5-flash': { id: 'gemini-2.5-flash', tier: 'small', ctx: 1048576, multimodal: true },
      'gemini-2.5-pro': { id: 'gemini-2.5-pro', tier: 'large', ctx: 1048576, multimodal: true },
    },
    keyEnv: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'One key for many upstream providers; `:free` models need no credits.',
    // Verified live against https://openrouter.ai/api/v1/models on 2026-08-01.
    // The previous entries — `meta-llama/llama-3.3-70b-instruct:free` (the
    // DEFAULT) and `deepseek/deepseek-chat-v3-0324:free` — had been withdrawn
    // upstream and 404'd on every call. OpenRouter rotates its `:free` pool, so
    // treat these ids as perishable: `npm run models:check` re-verifies them.
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    models: [
      'nvidia/nemotron-nano-9b-v2:free',
      'openai/gpt-oss-20b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'anthropic/claude-sonnet-5',
    ],
    modelInfo: {
      'nvidia/nemotron-nano-9b-v2:free': { id: 'nvidia/nemotron-nano-9b-v2:free', tier: 'small', ctx: 128000, multimodal: false },
      'openai/gpt-oss-20b:free': { id: 'openai/gpt-oss-20b:free', tier: 'small', ctx: 131072, multimodal: false },
      'nvidia/nemotron-3-super-120b-a12b:free': { id: 'nvidia/nemotron-3-super-120b-a12b:free', tier: 'mid', ctx: 262144, multimodal: false },
      'nvidia/nemotron-3-ultra-550b-a55b:free': { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', tier: 'large', ctx: 1000000, multimodal: false },
      'anthropic/claude-sonnet-5': { id: 'anthropic/claude-sonnet-5', tier: 'large', ctx: 1000000, multimodal: true },
    },
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    blurb: 'Inference Providers router (router.huggingface.co) — one HF token, many hosts.',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
    ],
    modelInfo: {
      'meta-llama/Llama-3.3-70B-Instruct': { id: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', ctx: 131072, multimodal: false },
      'Qwen/Qwen2.5-72B-Instruct': { id: 'Qwen/Qwen2.5-72B-Instruct', tier: 'mid', ctx: 32768, multimodal: false },
      'deepseek-ai/DeepSeek-V3': { id: 'deepseek-ai/DeepSeek-V3', tier: 'large', ctx: 163840, multimodal: false },
    },
    keyEnv: 'HF_TOKEN',
    keyEnvAliases: ['HUGGINGFACE_API_KEY'],
    keyUrl: 'https://huggingface.co/settings/tokens',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude models via the official SDK with schema-guaranteed JSON output.',
    defaultModel: 'claude-opus-4-8',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    modelInfo: {
      'claude-opus-4-8': { id: 'claude-opus-4-8', tier: 'large', ctx: 200000, multimodal: true },
      'claude-sonnet-5': { id: 'claude-sonnet-5', tier: 'large', ctx: 200000, multimodal: true },
      'claude-haiku-4-5-20251001': { id: 'claude-haiku-4-5-20251001', tier: 'small', ctx: 200000, multimodal: true },
    },
    keyEnv: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
};

export const LLM_PROVIDER_LIST: LlmProviderInfo[] = LLM_PROVIDER_IDS.map(
  (id) => LLM_PROVIDERS[id]
);

/**
 * Fallback for a model the catalog doesn't describe — users may type any model
 * id, and providers retire/add models faster than this file changes. Assuming
 * 'mid' keeps an unknown model usable for every role except the ones that
 * demand a large model, without pretending to capabilities it may not have.
 */
export const DEFAULT_MODEL_INFO: Omit<LlmModelInfo, 'id'> = {
  tier: 'mid',
  ctx: 32768,
  multimodal: false,
};

/** Capability metadata for a provider/model pair; never throws on unknown ids. */
export function modelInfoFor(provider: LlmProviderId, model: string): LlmModelInfo {
  return LLM_PROVIDERS[provider]?.modelInfo[model] ?? { id: model, ...DEFAULT_MODEL_INFO };
}

/** Tier of a provider/model pair, defaulting to 'mid' for unknown models. */
export function tierOf(provider: LlmProviderId, model: string): LlmModelTier {
  return modelInfoFor(provider, model).tier;
}
