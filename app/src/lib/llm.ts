import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { LLM_PROVIDERS, LLM_PROVIDER_IDS, tierOf, type LlmModelTier, type LlmProviderId } from '@/lib/llm-catalog';
import { loadLlmSettings, peekLlmSettings, type LlmSettingsSnapshot } from '@/lib/llm-settings';
import { notifyLlmCall } from '@/lib/llm-observer';
import { selectRoleChain, resolveRoleTiering, LLM_ROLES, ROLE_TIERS, type LlmRole } from '@/lib/llm-roles';

/**
 * LLM client for the chat orchestrator (research R11, 001 T021).
 *
 * Server-only (Constitution III — the LLM never runs in the browser). Provider,
 * model, and API key resolve from the in-app settings (Settings → AI Provider,
 * stored encrypted in the LlmSettings collection) with the LLM_* env vars as
 * fallback: LLM_PROVIDER (anthropic | groq | nvidia | gemini | openrouter |
 * huggingface), LLM_MODEL, LLM_API_KEY (or the provider-specific key env named
 * in lib/llm-catalog.ts). When no key resolves the orchestrator runs in the
 * clearly-labelled indicative degraded mode (spec Assumptions) — `llmAvailable()`
 * lets callers branch.
 *
 * Groq, NVIDIA (NIM), Gemini, OpenRouter, and Hugging Face all use their
 * OpenAI-compatible REST endpoints directly (no SDK dependency — a single
 * JSON-in/JSON-out call doesn't justify one, Constitution I). NVIDIA and Gemini
 * both get OpenAI-style strict `response_format: json_schema` so the schema is
 * enforced server-side, not just prompted; Groq and OpenRouter fall back to
 * prompted `json_object` mode, and Hugging Face is prompted-only (the router
 * fans out to hosts with uneven response_format support — an unsupported param
 * would 400 the whole call).
 */

type Provider = LlmProviderId;

const OPENAI_COMPAT_URL: Record<Exclude<Provider, 'anthropic'>, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  huggingface: 'https://router.huggingface.co/v1/chat/completions',
};

/** The provider/model/key a call actually runs with, after settings+env resolution. */
export interface LlmRuntimeConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  /** 'app' when the in-app settings chose the provider, 'env' otherwise. */
  source: 'app' | 'env';
}

function envProvider(): Provider | null {
  const p = process.env.LLM_PROVIDER;
  return (LLM_PROVIDER_IDS as readonly string[]).includes(p ?? '') ? (p as Provider) : null;
}

export function envKeyFor(p: Provider): string | undefined {
  const info = LLM_PROVIDERS[p];
  return (
    process.env.LLM_API_KEY ||
    process.env[info.keyEnv] ||
    (info.keyEnvAliases ?? []).map((n) => process.env[n]).find(Boolean) ||
    undefined
  );
}

/**
 * Pure resolution: in-app settings are authoritative when they name a provider
 * (model falls back to the catalog default, key falls back to that provider's
 * env var); otherwise the env vars behave exactly as before.
 */
export function resolveLlmConfigFrom(snapshot: LlmSettingsSnapshot | null): LlmRuntimeConfig {
  if (snapshot?.provider) {
    const p = snapshot.provider;
    return {
      provider: p,
      model: snapshot.model || LLM_PROVIDERS[p].defaultModel,
      apiKey: snapshot.keys[p] || envKeyFor(p),
      source: 'app',
    };
  }
  const p = envProvider() ?? 'anthropic';
  return {
    provider: p,
    model: process.env.LLM_MODEL || LLM_PROVIDERS[p].defaultModel,
    apiKey: envKeyFor(p),
    source: 'env',
  };
}

/** Resolve against the freshest settings (cached DB read, env fallback). */
export async function resolveLlmConfig(): Promise<LlmRuntimeConfig> {
  return resolveLlmConfigFrom(await loadLlmSettings());
}

/**
 * Provider fallback (observed live 2026-07-13: NVIDIA NIM's free tier congested
 * and timing out intermittently while other configured providers worked): when
 * the active provider fails on infrastructure (timeout / rate limit / 5xx /
 * unreachable), llmJson retries against the next provider that has a key. A
 * short cooldown remembers the failure so the REST of the turn goes straight
 * to the working provider instead of re-burning the timeout on every call.
 */
const PROVIDER_COOLDOWN_MS = 120_000;
const providerCooldowns = new Map<Provider, number>();

function inCooldown(p: Provider): boolean {
  return (providerCooldowns.get(p) ?? 0) > Date.now();
}

/**
 * 008 FR-012 — a rate-limited provider usually tells you exactly when it will
 * serve you again. Before this, `Retry-After` was ignored and the retry fired
 * immediately, turning one 429 into several and burning the turn's budget.
 *
 * Accepts both RFC-7231 forms: delta-seconds ("30") and an HTTP-date.
 * Returns null for absent/garbage values so the caller keeps its old behavior.
 */
export function parseRetryAfterMs(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (!raw) return null;

  // delta-seconds
  if (/^\d+$/.test(raw)) {
    const ms = Number.parseInt(raw, 10) * 1000;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }

  // HTTP-date. Every RFC-7231 date form (IMF-fixdate, RFC-850, asctime) begins
  // with a day name, so require that before handing the value to Date.parse —
  // it is lenient enough to read "-5" or "1.5" as a date, which would yield a
  // 0ms wait and reinstate exactly the immediate-retry behavior this replaces.
  if (!/^[A-Za-z]{3}/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  // A past date means "retry now", not a negative wait.
  return Math.max(0, at - now);
}

/**
 * Longest we will sit waiting on one provider before moving to the next.
 * Sized against the turn budget: with a 120s hard cap and a 25s abort
 * threshold, anything longer is better spent on a different connection.
 */
const MAX_RETRY_AFTER_WAIT_MS = 8_000;

/**
 * 008 FR-014 — token counts from the most recent provider response.
 *
 * Both transports discard everything but the text, so the counts are stashed
 * here by the call functions and picked up by llmJson once it knows the
 * outcome. A module-level slot is safe because a single completion is awaited
 * end-to-end before the value is read; it is cleared on every attempt so a
 * failed call can never be attributed the previous call's tokens.
 */
let lastUsage: { promptTokens: number; completionTokens: number } | null = null;

/**
 * Persist one request's metadata. Fire-and-forget by design (FR-014): usage
 * accounting must never be able to fail a generation turn, and the collection
 * may legitimately be unreachable in local development.
 */
function recordUsage(
  cfg: LlmRuntimeConfig,
  role: LlmRole | undefined,
  status: 'ok' | 'rate_limited' | 'error',
  latencyMs: number,
  usage: { promptTokens: number; completionTokens: number } | null
): void {
  const doc = {
    provider: cfg.provider,
    model: cfg.model,
    role: role ?? 'unspecified',
    tier: tierOf(cfg.provider, cfg.model),
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    latencyMs,
    status,
    at: new Date(),
  };
  void (async () => {
    try {
      const { connectDB } = await import('@/lib/db');
      const { LlmUsage } = await import('@/lib/models/LlmUsage');
      await connectDB();
      await LlmUsage.create(doc);
    } catch {
      /* best-effort: never surface a usage-write failure to a turn */
    }
  })();
}

/**
 * 008 FR-013 — how many requests a provider has taken in the recent past.
 * Used to skip a connection already at its per-minute ceiling BEFORE sending,
 * rather than discovering the limit by being refused.
 */
/** Parse a stored "provider/model" role override into a usable pair. */
function roleOverride(
  snapshot: LlmSettingsSnapshot | null,
  role: LlmRole | undefined
): { provider: Provider; model: string } | null {
  if (!role) return null;
  const raw = snapshot?.roleModels?.[role];
  if (!raw) return null;
  const slash = raw.indexOf('/');
  if (slash <= 0) return null;
  const provider = raw.slice(0, slash);
  const model = raw.slice(slash + 1);
  if (!(LLM_PROVIDER_IDS as readonly string[]).includes(provider) || !model) return null;
  return { provider: provider as Provider, model };
}

export interface RoleResolution {
  role: LlmRole;
  tier: LlmModelTier;
  /** What this role would actually use right now; null when nothing is keyed. */
  resolved: { provider: Provider; model: string } | null;
  /** True when an operator pinned this role rather than taking the default. */
  overridden: boolean;
}

/**
 * What each work class would use, given today's keys, overrides and toggle
 * (008 FR-016; contracts/settings-llm-usage.md §GET).
 *
 * Exists so an operator can verify tiering WITHOUT running a generation and
 * reading a trace. It calls the same `selectRoleChain` and `roleOverride` the
 * live path calls — a separate reimplementation would eventually disagree with
 * the real selection, and a settings screen that lies about which model runs is
 * worse than one that says nothing.
 *
 * `applyProviderBudget` is deliberately NOT applied: that reorders by recent
 * request load, so including it would make the same configuration preview
 * differently minute to minute for reasons the operator cannot see.
 */
export async function previewRoleResolution(): Promise<RoleResolution[]> {
  const snapshot = await loadLlmSettings();
  const enabled = resolveRoleTiering(snapshot?.roleTieringEnabled);
  const configs = await resolveLlmConfigs();
  return LLM_ROLES.map((role) => {
    const override = roleOverride(snapshot, role);
    const [first] = selectRoleChain(role, configs, { enabled, override });
    return {
      role,
      tier: ROLE_TIERS[role],
      resolved: first ? { provider: first.provider, model: first.model } : null,
      overridden: Boolean(override),
    };
  });
}

/**
 * Approximate per-minute request ceilings, used only to DEPRIORITISE a
 * connection that is already near its limit (FR-013). Deliberately
 * conservative: being wrong here costs a slightly worse ordering, never a
 * failed turn, because a saturated provider is moved down the chain rather than
 * removed from it.
 */
const PROVIDER_RPM: Partial<Record<Provider, number>> = {
  nvidia: 40,
  groq: 30,
  gemini: 15,
  openrouter: 20,
};

const BUDGET_WINDOW_MS = 60_000;

/**
 * 008 FR-013 — reorder a chain so providers already at their per-minute ceiling
 * go last. This is the only mechanism here that AVOIDS a 429 rather than
 * reacting to one. Fails open in every direction: no usage data, an unreachable
 * collection, or an unknown provider all leave the order untouched.
 */
async function applyProviderBudget(configs: LlmRuntimeConfig[]): Promise<LlmRuntimeConfig[]> {
  if (configs.length < 2) return configs;
  try {
    const saturated = new Set<Provider>();
    await Promise.all(
      configs.map(async (cfg) => {
        const cap = PROVIDER_RPM[cfg.provider];
        if (!cap) return;
        if ((await recentRequests(cfg.provider, BUDGET_WINDOW_MS)) >= cap) saturated.add(cfg.provider);
      })
    );
    if (saturated.size === 0 || saturated.size === configs.length) return configs;
    return [...configs.filter((c) => !saturated.has(c.provider)), ...configs.filter((c) => saturated.has(c.provider))];
  } catch {
    return configs;
  }
}

export async function recentRequests(provider: Provider, windowMs: number): Promise<number> {
  try {
    const { connectDB } = await import('@/lib/db');
    const { LlmUsage } = await import('@/lib/models/LlmUsage');
    await connectDB();
    return await LlmUsage.countDocuments({ provider, at: { $gte: new Date(Date.now() - windowMs) } });
  } catch {
    // Fail open: an unavailable usage collection must not block generation.
    return 0;
  }
}

/**
 * The active config first, then every other provider with a usable key (at its
 * catalog default model); providers in cooldown sort last so they remain a
 * final resort rather than being skipped outright.
 */
export async function resolveLlmConfigs(): Promise<LlmRuntimeConfig[]> {
  const snapshot = await loadLlmSettings();
  const primary = resolveLlmConfigFrom(snapshot);
  const configs: LlmRuntimeConfig[] = [];
  const seen = new Set<Provider>();
  const add = (cfg: LlmRuntimeConfig) => {
    if (cfg.apiKey && !seen.has(cfg.provider)) {
      seen.add(cfg.provider);
      configs.push(cfg);
    }
  };
  add(primary);
  for (const id of LLM_PROVIDER_IDS) {
    add({
      provider: id,
      model: LLM_PROVIDERS[id].defaultModel,
      apiKey: snapshot?.keys[id] || envKeyFor(id),
      source: primary.source,
    });
  }
  return [...configs.filter((c) => !inCooldown(c.provider)), ...configs.filter((c) => inCooldown(c.provider))];
}

/**
 * Sync availability check used throughout the generate modules. Reads the
 * cached settings snapshot (primed per request by the chat route and by every
 * llmJson call) — before any prime it reflects env config alone.
 */
export function llmAvailable(): boolean {
  return Boolean(resolveLlmConfigFrom(peekLlmSettings()).apiKey);
}

// Cached per key so a settings change (new key, new provider) takes effect
// without a server restart.
let anthropicClient: { key: string; client: Anthropic } | null = null;
function getAnthropicClient(apiKey: string): Anthropic {
  if (anthropicClient?.key !== apiKey) {
    anthropicClient = { key: apiKey, client: new Anthropic({ apiKey }) };
  }
  return anthropicClient.client;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    /** machine-readable cause consumed by the provider-fallback logic */
    public kind?: 'timeout' | 'too_large' | 'rate_limited',
    /**
     * 008 FR-012 — the provider's own `Retry-After`, in ms, when it sent one.
     * llmJson waits exactly this long (when short enough) rather than guessing,
     * and derives the provider cooldown from it instead of a blanket 120s.
     */
    public retryAfterMs?: number
  ) {
    super(message);
  }
}

/**
 * 004 FR-009 — thrown (instead of LlmError) when a call was cancelled via the
 * caller's AbortSignal (a user-initiated stop). Callers that care about the
 * stop/failure distinction (the agent loop) catch this separately; anything
 * else propagates it like any other thrown error.
 */
export class LlmAbortError extends Error {
  constructor() {
    super('Generation stopped.');
  }
}

const BAD_KEY_MESSAGE =
  'The LLM API key is invalid — update it in Settings → AI Provider (or the key env var).';

const TIMEOUT_MESSAGE =
  'The AI provider took too long to respond. Try again, or switch to a faster model in Settings → AI Provider.';

/**
 * Hard per-call ceiling so a slow/stalled provider can never hang a turn forever
 * (a chat turn otherwise only aborts on an explicit user "stop"). Configurable
 * via LLM_TIMEOUT_MS; default 90s — above the observed p100 for a single
 * structured completion, below the 120s per-turn envelope. Set 0 to disable.
 */
const LLM_TIMEOUT_MS = (() => {
  const n = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
})();

/**
 * Combine the caller's abort signal (user stop) with a timeout. `timedOut()`
 * distinguishes a timeout from a user cancel so the two map to different errors.
 * Version-agnostic (no AbortSignal.any/timeout dependency).
 */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  const timer = ms > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, ms) : null;
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

interface CompletionOpts {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** 004 FR-009 — lets a caller (the agent loop) cancel an in-flight call on stop. */
  signal?: AbortSignal;
  /**
   * 008 — the class of work this call represents, used to pick a model matched
   * to its difficulty instead of sending everything to the active model.
   * OMITTING IT MUST REMAIN IDENTICAL TO PRE-008 BEHAVIOR: that equivalence is
   * what lets the eleven call sites migrate one at a time (contracts §7).
   */
  role?: LlmRole;
}

/** Anthropic Messages API — output_config.format guarantees schema-valid JSON. */
async function callAnthropic(cfg: LlmRuntimeConfig, opts: CompletionOpts): Promise<string> {
  const to = withTimeout(opts.signal, LLM_TIMEOUT_MS);
  try {
    const response = await getAnthropicClient(cfg.apiKey!).messages.create(
      {
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.system,
        output_config: { format: { type: 'json_schema', schema: opts.schema } },
        messages: [{ role: 'user', content: opts.user }],
      },
      { signal: to.signal }
    );
    if (response.stop_reason === 'refusal') {
      throw new LlmError('The assistant declined this request.', false);
    }
    const text = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )?.text;
    if (!text) throw new LlmError('The assistant returned an empty response.', true);
    // 008 FR-014 — previously discarded along with the rest of the response.
    lastUsage = {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
    };
    return text;
  } catch (e) {
    if (opts.signal?.aborted) throw new LlmAbortError();
    if (to.timedOut()) throw new LlmError(TIMEOUT_MESSAGE, false, 'timeout');
    if (e instanceof LlmError) throw e;
    if (e instanceof Anthropic.RateLimitError) {
      throw new LlmError('The assistant is rate-limited right now — try again shortly.', true);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      throw new LlmError(BAD_KEY_MESSAGE, false);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new LlmError('Could not reach the LLM service.', true);
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new LlmError(
        `The model "${cfg.model}" was not found on anthropic — pick one of the available models in Settings → AI Provider.`,
        false
      );
    }
    if (e instanceof Anthropic.APIError) {
      throw new LlmError(`LLM request failed (${e.status}).`, (e.status ?? 500) >= 500);
    }
    throw e;
  } finally {
    to.cleanup();
  }
}

/** OpenRouter uses these purely for their own dashboard attribution/ranking. */
function extraHeaders(p: Exclude<Provider, 'anthropic'>): Record<string, string> {
  return p === 'openrouter' ? { 'HTTP-Referer': 'https://localhost', 'X-Title': 'Cloud Architecture Studio' } : {};
}

/**
 * NVIDIA (NIM) and Gemini enforce the schema server-side via OpenAI-style strict
 * `json_schema`; Groq and OpenRouter fall back to prompted `json_object` mode
 * (the schema is embedded in the system prompt for all of them). Hugging Face
 * gets no response_format at all — the router's upstream hosts support it
 * unevenly and reject unknown params.
 *
 * NOTE: NVIDIA's older `nvext.guided_json` extension is no longer honoured by
 * integrate.api.nvidia.com — it is silently ignored and the (reasoning) model
 * free-forms prose, which then fails JSON extraction. The standard OpenAI
 * `response_format: json_schema` IS honoured and forces schema-valid output
 * (verified against nemotron-super with nested schemas), so NVIDIA now uses the
 * same path as Gemini.
 */
function structuredOutputParams(p: Exclude<Provider, 'anthropic'>, schema: Record<string, unknown>): Record<string, unknown> {
  if (p === 'nvidia' || p === 'gemini') {
    return { response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } } };
  }
  if (p === 'huggingface') return {};
  return { response_format: { type: 'json_object' } };
}

/** OpenAI-compatible chat completions (Groq, NVIDIA NIM, Gemini, OpenRouter, Hugging Face) with structured-output JSON. */
async function callOpenAiCompatible(cfg: LlmRuntimeConfig, opts: CompletionOpts): Promise<string> {
  const p = cfg.provider as Exclude<Provider, 'anthropic'>;
  const to = withTimeout(opts.signal, LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OPENAI_COMPAT_URL[p], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        ...extraHeaders(p),
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 8192,
        messages: [
          {
            role: 'system',
            content: `${opts.system}\n\nYou MUST respond with a JSON object that adheres strictly to this JSON Schema:\n${JSON.stringify(opts.schema)}`,
          },
          { role: 'user', content: opts.user },
        ],
        ...structuredOutputParams(p, opts.schema),
      }),
      signal: to.signal,
    });
  } catch {
    const timedOut = to.timedOut();
    to.cleanup();
    if (opts.signal?.aborted) throw new LlmAbortError();
    if (timedOut) throw new LlmError(TIMEOUT_MESSAGE, false, 'timeout');
    throw new LlmError('Could not reach the LLM service.', true);
  }
  to.cleanup();

  if (!res.ok) {
    if (res.status === 401) throw new LlmError(BAD_KEY_MESSAGE, false);
    if (res.status === 429) {
      // 008 FR-012 — carry the provider's own retry timing through to llmJson.
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after')) ?? undefined;
      throw new LlmError(
        'The assistant is rate-limited right now — try again shortly.',
        true,
        'rate_limited',
        retryAfterMs
      );
    }
    if (res.status === 404) {
      // Wrong/retired model id (seen live: "meta-llama/llama-4-maverick-17b"
      // on Groq — the model was decommissioned). Config error: never retried,
      // never falls back — the operator must fix the model.
      throw new LlmError(
        `The model "${cfg.model}" was not found on ${cfg.provider} — pick one of the available models in Settings → AI Provider.`,
        false
      );
    }
    if (res.status === 413) {
      // Request exceeds the provider/tier's size cap (seen live: Groq's free
      // tier 413s on the large planning prompt while small calls sail through).
      // Marked 'too_large' so llmJson falls back to a bigger-context provider
      // for THIS call — the fast provider still serves everything that fits.
      throw new LlmError(
        `The request is too large for ${cfg.provider} (${cfg.model}) — its plan or model caps request size. Configure a larger-context provider in Settings → AI Provider.`,
        false,
        'too_large'
      );
    }
    // Log the provider's raw error body server-side for debugging, but NEVER
    // forward it to the client (security review — information leakage): upstream
    // bodies can echo model ids, quota/billing hints, org identifiers, or partial
    // key fragments. The client only ever sees a generic status-coded message.
    try {
      const raw = await res.text();
      if (raw) console.error(`[llm] provider ${res.status} error body:`, raw.slice(0, 2000));
    } catch {
      /* ignore body read failures */
    }
    const message = `LLM request failed (${res.status}).`;
    if (res.status === 402) {
      // Payment required — seen live from HF (depleted monthly credits) and
      // OpenRouter (free-pool preauth). Point the operator at Settings without
      // leaking the provider's response body.
      throw new LlmError(
        `${message} Add credits to the provider account or switch providers in Settings → AI Provider.`,
        false
      );
    }
    throw new LlmError(message, res.status >= 500);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  // 008 FR-014 — every OpenAI-compatible provider returns this and it was
  // being thrown away, which is why the app could not report real usage.
  lastUsage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'content_filter') {
    throw new LlmError('The assistant declined this request.', false);
  }
  if (choice?.finish_reason === 'length') {
    // Reasoning models (e.g. Nemotron) can burn the budget on thinking and cut
    // the JSON mid-object; surface it as retryable — the next sample usually
    // reasons shorter.
    throw new LlmError('The model response was cut off — try again.', true);
  }
  const text = choice?.message?.content;
  if (!text) throw new LlmError('The assistant returned an empty response.', true);
  return text;
}

/**
 * Reasoning models may wrap the JSON in <think> blocks or stray prose even
 * under guided decoding. Strip thinking tags, then slice from the first '{' to
 * the last '}' — the parse below stays the correctness gate.
 */
export function extractJson(text: string): string {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

/**
 * Observed live (NVIDIA Nemotron, feature 006 validation): the model sometimes
 * emits otherwise-valid JSON annotated with `// comments` and trailing commas —
 * JSON.parse rightly rejects both. This string-aware pass removes // and Slash-star
 * comments OUTSIDE string literals plus trailing commas, so a merely-annotated
 * response parses instead of failing the turn. Strict parse is always attempted
 * first; this is the fallback, and real garbage still fails.
 */
export function stripJsonAnnotations(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += ch;
  }
  return stripTrailingCommas(out);
}

/** String-aware trailing-comma removal: `",]"` inside a string value stays untouched. */
function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') continue; // drop the trailing comma
    }
    out += ch;
  }
  return out;
}

/** One raw completion + JSON parse against an explicit config. */
async function completeOnce<T>(cfg: LlmRuntimeConfig, opts: CompletionOpts): Promise<T> {
  const text = await (cfg.provider === 'anthropic' ? callAnthropic(cfg, opts) : callOpenAiCompatible(cfg, opts));
  const extracted = extractJson(text);
  try {
    return JSON.parse(extracted) as T;
  } catch {
    // Lenient second chance: comment/trailing-comma annotations only.
    try {
      return JSON.parse(stripJsonAnnotations(extracted)) as T;
    } catch {
      /* genuinely malformed — fall through to the diagnostics + error below */
    }
  }
  // Preserve diagnosability (003 US1): log what actually came back instead
  // of collapsing every failure into an opaque generic message.
  console.error('[llm] model returned non-JSON output:', text.slice(0, 500));
  // Opt-in full-output dump for debugging malformed responses (set
  // LLM_DEBUG_DUMP to a writable file path; off in normal operation).
  if (process.env.LLM_DEBUG_DUMP) {
    try {
      const fs = await import('node:fs');
      fs.appendFileSync(process.env.LLM_DEBUG_DUMP, `\n===== ${new Date().toISOString()} ${cfg.provider}/${cfg.model} =====\n${text}\n`);
    } catch {
      /* diagnostics only — never fail the call over the dump */
    }
  }
  throw new LlmError('The model returned malformed JSON — try again.', true);
}

/**
 * One structured completion: system + user prompt in, schema-validated JSON out.
 * The active provider gets one in-place retry (malformed/truncated output is
 * sampling noise); infrastructure failures (timeout / rate limit / 5xx /
 * unreachable) then FALL BACK to the other configured providers so one
 * congested provider can't take the whole app down. Hard configuration errors
 * (invalid key, refusal) never fall back — they need the operator.
 */
export async function llmJson<T>(opts: CompletionOpts): Promise<T> {
  const primary = await resolveLlmConfig();
  if (!primary.apiKey) {
    throw new LlmError(
      'LLM is not configured — add an API key in Settings → AI Provider (or set LLM_API_KEY).',
      false
    );
  }
  // The active provider plus at most two fallbacks — bounded worst-case latency.
  // Role selection is applied before the cap so a role-preferred connection can
  // never be truncated away by the slice (008); with no role, or with tiering
  // disabled, selectRoleChain returns the chain untouched.
  const snapshot = await loadLlmSettings();
  const configs = (
    await applyProviderBudget(
      selectRoleChain(opts.role, await resolveLlmConfigs(), {
        // Settings first, env fallback — same precedence as provider/model/keys.
        enabled: resolveRoleTiering(snapshot?.roleTieringEnabled),
        override: roleOverride(snapshot, opts.role),
      })
    )
  ).slice(0, 3);
  let lastError: LlmError | null = null;
  for (const [ci, cfg] of configs.entries()) {
    const attempts = ci === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const startedAt = Date.now();
      lastUsage = null;
      // Interpretability tap: every attempt announces itself (start) and its
      // outcome (end) to the turn's observer — this is what lets the live
      // trace show "using groq/llama-3.3-70b" while the call is in flight and
      // makes fallback hops visible instead of silent.
      const observed = {
        role: opts.role ?? 'unspecified',
        provider: cfg.provider,
        model: cfg.model,
        tier: tierOf(cfg.provider, cfg.model),
      };
      notifyLlmCall({ phase: 'start', ...observed });
      try {
        const result = await completeOnce<T>(cfg, opts);
        recordUsage(cfg, opts.role, 'ok', Date.now() - startedAt, lastUsage);
        notifyLlmCall({ phase: 'end', ...observed, status: 'ok', latencyMs: Date.now() - startedAt });
        if (ci > 0) {
          console.warn(`[llm] answered via fallback ${cfg.provider}/${cfg.model} (${configs[0].provider} unavailable)`);
        }
        return result;
      } catch (e) {
        if (e instanceof LlmAbortError) {
          notifyLlmCall({ phase: 'end', ...observed, status: 'error', latencyMs: Date.now() - startedAt });
          throw e;
        }
        if (!(e instanceof LlmError)) throw e;
        lastError = e;
        recordUsage(cfg, opts.role, e.kind === 'rate_limited' ? 'rate_limited' : 'error', Date.now() - startedAt, null);
        notifyLlmCall({
          phase: 'end',
          ...observed,
          status: e.kind === 'rate_limited' ? 'rate_limited' : 'error',
          latencyMs: Date.now() - startedAt,
        });
        // Infra failures (retryable, timeout, size cap) fall through to the next
        // provider. A hard config error — bad key, missing model — is different:
        // on the ACTIVE connection it must surface, because the operator chose
        // it and silently serving from somewhere else would hide a
        // misconfiguration they need to fix.
        //
        // On a FALLBACK it must not. The operator never chose that connection
        // for this turn; it is standing in because the primary was rate-limited.
        // Aborting there converts a transient limit into a failed turn, which is
        // the exact opposite of what a fallback chain is for. Observed live: a
        // stale `:free` model id in the OpenRouter catalog entry took down two
        // of six baseline requests after Groq rate-limited — the chain had two
        // more healthy connections behind it and never reached them.
        if (!e.retryable && e.kind === undefined) {
          if (ci === 0) throw e;
          console.warn(
            `[llm] fallback ${cfg.provider}/${cfg.model} is misconfigured (${e.message}) — skipping it for this turn`
          );
          break;
        }

        // 008 FR-012 — the provider told us when it will serve us again. If
        // that is soon enough to fit the turn, wait exactly that long and try
        // this provider once more; otherwise stop retrying it here and hop to
        // the next connection. Either way we never fire an immediate retry into
        // a limit we know is still in force.
        if (e.kind === 'rate_limited' && typeof e.retryAfterMs === 'number') {
          if (e.retryAfterMs <= MAX_RETRY_AFTER_WAIT_MS && attempt + 1 < attempts) {
            await new Promise((r) => setTimeout(r, e.retryAfterMs));
            continue;
          }
          break;
        }
      }
    }
    // Size-cap failures (413) fail fast and only affect oversized calls — no
    // cooldown, so the fast provider keeps serving everything that fits.
    if (lastError?.kind !== 'too_large') {
      // 008 FR-013 — when the provider stated its own window, honour it instead
      // of a blanket two minutes: a 5s limit should not sideline a provider for
      // the rest of the turn, and a 10-minute one should not be under-served.
      const cooldown =
        lastError?.kind === 'rate_limited' && typeof lastError.retryAfterMs === 'number'
          ? lastError.retryAfterMs
          : PROVIDER_COOLDOWN_MS;
      providerCooldowns.set(cfg.provider, Date.now() + cooldown);
    }
    if (ci + 1 < configs.length) {
      console.warn(`[llm] ${cfg.provider} unavailable (${lastError?.message}) — trying ${configs[ci + 1].provider}`);
    }
  }
  throw lastError ?? new LlmError('The model returned malformed JSON — try again.', true);
}

/**
 * One tiny end-to-end completion against an explicit config — the settings
 * page's "Test connection". Goes through the same structured-output path real
 * turns use, so a pass means the provider, model, and key actually work
 * together. Throws LlmError with a user-readable message on failure.
 */
export async function llmPing(cfg: LlmRuntimeConfig, signal?: AbortSignal): Promise<void> {
  if (!cfg.apiKey) {
    throw new LlmError('No API key — enter one or store it first.', false);
  }
  const opts: CompletionOpts = {
    system: 'You are a connectivity check. Respond with exactly this JSON object: {"ok": true}',
    user: 'ping',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    // Match llmJson's default budget. Providers that pre-authorize credits by
    // max_tokens (seen live: HF router 402s at ≥4096 on a depleted account)
    // would otherwise pass a small ping and still fail every real turn.
    maxTokens: 8192,
    signal,
  };
  const text = await (cfg.provider === 'anthropic' ? callAnthropic(cfg, opts) : callOpenAiCompatible(cfg, opts));
  try {
    JSON.parse(extractJson(text));
  } catch {
    throw new LlmError('The model responded, but not with valid JSON — it may not suit structured output.', true);
  }
}

/** Every provider's model-listing endpoint (OpenAI-style `GET /models`). */
const MODELS_URL: Record<Provider, string> = {
  groq: 'https://api.groq.com/openai/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  huggingface: 'https://router.huggingface.co/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
};

/**
 * Live model ids from the provider itself — so the settings UI offers what the
 * account can actually use instead of a hardcoded guess (seen live: a mistyped
 * Groq model id 404-ing every call). Sorted; Gemini's `models/` prefix stripped
 * so ids are directly usable in chat completions.
 */
export async function llmListModels(cfg: { provider: Provider; apiKey?: string }): Promise<string[]> {
  if (!cfg.apiKey) {
    throw new LlmError('No API key — enter one or store it first.', false);
  }
  const headers: Record<string, string> =
    cfg.provider === 'anthropic'
      ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${cfg.apiKey}` };
  let res: Response;
  try {
    res = await fetch(MODELS_URL[cfg.provider], { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new LlmError('Could not reach the provider to list models.', true);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new LlmError(BAD_KEY_MESSAGE, false);
    throw new LlmError(`Model listing failed (${res.status}).`, res.status >= 500);
  }
  const data = (await res.json()) as { data?: { id?: unknown }[] };
  const ids = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => id.replace(/^models\//, ''));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
