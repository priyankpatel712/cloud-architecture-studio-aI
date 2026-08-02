import 'server-only';
import { McpGuidanceCache } from '@/lib/models/McpGuidanceCache';
import { MCP_GUIDANCE_CACHE_TTL_MS } from '@/lib/generate/loop-config';
import type { GuidanceCachePort } from '@/lib/generate/orchestrator';
import type { ProviderId } from '@/lib/providers/types';

/**
 * Mongo-backed GuidanceCachePort implementation (generation-quality
 * improvement). Read/write is best-effort throughout — a cache failure must
 * never fail (or even slow down beyond a query) a generation turn, so every
 * outcome other than a genuine hit falls through to gatherGuidance()'s
 * existing live-MCP path unchanged.
 */

/**
 * 008 FR-023 — cache key.
 *
 * Originally this was matched-reference-pattern ids only, so any request that
 * matched no curated pattern produced an empty key and was NEVER cached — the
 * long tail of real requests re-hit the MCP every single turn. When no pattern
 * matches we now fall back to the request's own top capability keywords, which
 * are stable enough that two similar requests share a key.
 *
 * The old form remains a legal key, so entries written before this change stay
 * valid and keep being hit.
 */
function signature(provider: ProviderId, keys: string[]): string {
  return `${provider}:${[...keys].sort().join('+')}`;
}

/** Cap so an unusually long capability list cannot produce an unbounded key. */
const MAX_FALLBACK_KEYS = 4;

/**
 * Pattern ids when the request matched a curated pattern, else its normalized
 * top capability keywords. Empty only when we genuinely know nothing about the
 * request, in which case caching is correctly skipped.
 */
export function cacheKeys(patternIds: string[], capabilityKeywords: string[] = []): string[] {
  if (patternIds.length > 0) return patternIds;
  return capabilityKeywords
    .map((k) => k.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .slice(0, MAX_FALLBACK_KEYS);
}

export const mongoGuidanceCache: GuidanceCachePort = {
  async get(provider, patternIds) {
    if (patternIds.length === 0) return null;
    try {
      const doc = await McpGuidanceCache.findOne({
        signature: signature(provider, patternIds),
        staleAfter: { $gt: new Date() },
      }).lean();
      if (!doc) return null;
      return { guidanceText: doc.guidanceText, toolsInvoked: doc.toolsInvoked };
    } catch {
      return null;
    }
  },
  async set(provider, patternIds, guidanceText, toolsInvoked) {
    if (patternIds.length === 0) return;
    try {
      const sig = signature(provider, patternIds);
      await McpGuidanceCache.updateOne(
        { signature: sig },
        {
          $set: {
            provider,
            patternIds: [...patternIds].sort(),
            signature: sig,
            guidanceText,
            toolsInvoked,
            fetchedAt: new Date(),
            staleAfter: new Date(Date.now() + MCP_GUIDANCE_CACHE_TTL_MS),
          },
        },
        { upsert: true }
      );
    } catch {
      /* best-effort — a failed cache write must never fail the generation turn */
    }
  },
};
