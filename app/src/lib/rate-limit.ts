import 'server-only';
import { Schema, model, models, type Model } from 'mongoose';
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';

/**
 * Rate limiting (security checklist #1). Two primitives, both MongoDB-backed so
 * they survive restarts and work across instances without new infrastructure:
 *
 *  - fixedWindowLimit() — a per-key counter in a fixed time window. Used for
 *    moderate/loose limits on public + authenticated actions (email sends, LLM
 *    turns, account creation).
 *  - guardAuth()/penalizeAuth()/resetAuth() — per-IP AND per-account failure
 *    tracking for auth routes with EXPONENTIAL BACKOFF (not a hard lockout): the
 *    required wait grows with each failure and resets on a success, so a real
 *    user is only ever briefly slowed while a brute-forcer is throttled to a
 *    crawl.
 *
 * Every threshold is env-configurable (nothing hardcoded). The limiter always
 * FAILS OPEN: if Mongo is unreachable or errors, requests are allowed — a broken
 * limiter must never take auth or the app down with it.
 */

// --- configuration (all overridable via env; safe defaults) ---
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Master switch — set RATE_LIMIT_ENABLED=false to disable (e.g. in tests). */
const ENABLED = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';

export const RATE_LIMITS = {
  /** Auth failure backoff: attempts allowed free before backoff engages. */
  authFreeAttempts: intEnv('RL_AUTH_FREE_ATTEMPTS', 5),
  /** First backoff delay (ms); doubles each further failure. */
  authBackoffBaseMs: intEnv('RL_AUTH_BACKOFF_BASE_MS', 1_000),
  /** Cap on the backoff delay (ms). Default 15 min. */
  authBackoffMaxMs: intEnv('RL_AUTH_BACKOFF_MAX_MS', 15 * 60 * 1_000),
  /** How long a failure record lives with no further failures (ms). Default 1h. */
  authAttemptTtlMs: intEnv('RL_AUTH_ATTEMPT_TTL_MS', 60 * 60 * 1_000),

  /** Verification / password-reset EMAIL sends per window (anti email-bomb). */
  emailMax: intEnv('RL_EMAIL_MAX', 5),
  emailWindowMs: intEnv('RL_EMAIL_WINDOW_MS', 60 * 60 * 1_000),

  /** New-account creations per IP per window. */
  registerMax: intEnv('RL_REGISTER_MAX', 10),
  registerWindowMs: intEnv('RL_REGISTER_WINDOW_MS', 60 * 60 * 1_000),

  /** LLM generation turns per user per window (protects paid providers). */
  llmMax: intEnv('RL_LLM_MAX', 20),
  llmWindowMs: intEnv('RL_LLM_WINDOW_MS', 60 * 1_000),
} as const;

// --- storage model (TTL-swept) ---
interface RateLimitFields {
  key: string;
  count: number;
  failures: number;
  blockedUntil: Date | null;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<RateLimitFields>({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  blockedUntil: { type: Date, default: null },
  // TTL index: Mongo removes the doc once expiresAt passes.
  expiresAt: { type: Date, required: true },
});
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit: Model<RateLimitFields> =
  (models.RateLimit as Model<RateLimitFields>) ??
  model<RateLimitFields>('RateLimit', rateLimitSchema);

// --- helpers ---

/** Best-effort client IP from proxy headers; 'unknown' when unattributable. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim() || 'unknown';
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim() || 'unknown';
  return 'unknown';
}

/** A 429 response carrying a Retry-After header (seconds). */
export function tooManyRequests(retryAfterSec: number, message?: string): NextResponse {
  const secs = Math.max(1, Math.ceil(retryAfterSec));
  return NextResponse.json(
    { error: message ?? 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(secs) } }
  );
}

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window counter. Returns ok:false once `limit` requests have been made
 * for `key` within the current `windowMs` slice. Fails open on any error.
 */
export async function fixedWindowLimit(
  bucket: string,
  id: string,
  limit: number,
  windowMs: number
): Promise<LimitResult> {
  if (!ENABLED || limit <= 0) return { ok: true, retryAfterSec: 0 };
  const now = Date.now();
  const windowId = Math.floor(now / windowMs);
  const windowEnd = (windowId + 1) * windowMs;
  const key = `${bucket}:${id}:${windowId}`;
  try {
    await connectDB();
    const doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowEnd + 60_000) } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    if ((doc?.count ?? 1) > limit) {
      return { ok: false, retryAfterSec: Math.ceil((windowEnd - now) / 1000) };
    }
    return { ok: true, retryAfterSec: 0 };
  } catch (e) {
    console.error('[rate-limit] fixedWindowLimit failed open:', e);
    return { ok: true, retryAfterSec: 0 };
  }
}

/**
 * Check whether any of the given auth keys (e.g. per-IP and per-account) is
 * currently in a backoff window. Returns the longest remaining wait.
 */
export async function guardAuth(keys: string[]): Promise<LimitResult> {
  if (!ENABLED || keys.length === 0) return { ok: true, retryAfterSec: 0 };
  const now = Date.now();
  try {
    await connectDB();
    const docs = await RateLimit.find({
      key: { $in: keys.map((k) => `auth:${k}`) },
      blockedUntil: { $gt: new Date(now) },
    })
      .select('blockedUntil')
      .lean();
    let maxWaitMs = 0;
    for (const d of docs) {
      const wait = (d.blockedUntil?.getTime() ?? 0) - now;
      if (wait > maxWaitMs) maxWaitMs = wait;
    }
    return maxWaitMs > 0
      ? { ok: false, retryAfterSec: Math.ceil(maxWaitMs / 1000) }
      : { ok: true, retryAfterSec: 0 };
  } catch (e) {
    console.error('[rate-limit] guardAuth failed open:', e);
    return { ok: true, retryAfterSec: 0 };
  }
}

/**
 * Record a failed auth attempt against each key and apply exponential backoff
 * once the free-attempt allowance is exceeded. Idempotent per call; fails open.
 */
export async function penalizeAuth(keys: string[]): Promise<void> {
  if (!ENABLED || keys.length === 0) return;
  const now = Date.now();
  const { authFreeAttempts, authBackoffBaseMs, authBackoffMaxMs, authAttemptTtlMs } = RATE_LIMITS;
  try {
    await connectDB();
    await Promise.all(
      keys.map(async (k) => {
        const doc = await RateLimit.findOneAndUpdate(
          { key: `auth:${k}` },
          { $inc: { failures: 1 }, $set: { expiresAt: new Date(now + authAttemptTtlMs) } },
          { upsert: true, returnDocument: 'after' }
        ).lean();
        const failures = doc?.failures ?? 1;
        if (failures > authFreeAttempts) {
          const over = failures - authFreeAttempts; // 1, 2, 3, ...
          const delay = Math.min(authBackoffMaxMs, authBackoffBaseMs * 2 ** (over - 1));
          await RateLimit.updateOne(
            { key: `auth:${k}` },
            { $set: { blockedUntil: new Date(now + delay) } }
          );
        }
      })
    );
  } catch (e) {
    console.error('[rate-limit] penalizeAuth failed open:', e);
  }
}

/** Clear the failure/backoff state for the given keys (call on a success). */
export async function resetAuth(keys: string[]): Promise<void> {
  if (!ENABLED || keys.length === 0) return;
  try {
    await connectDB();
    await RateLimit.deleteMany({ key: { $in: keys.map((k) => `auth:${k}`) } });
  } catch (e) {
    console.error('[rate-limit] resetAuth failed open:', e);
  }
}
