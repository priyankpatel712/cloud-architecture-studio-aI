import { describe, expect, it } from 'vitest';
import { selectRoleChain, resolveRoleTiering, ROLE_TIERS, LLM_ROLES } from '@/lib/llm-roles';
import { tierOf } from '@/lib/llm-catalog';
import type { LlmRuntimeConfig } from '@/lib/llm';

/**
 * Feature 008 US2 — per-role connection chains (FR-010/FR-011/FR-015/FR-016).
 *
 * The safety property pinned first: tiering is OFF by default. FR-041/SC-009
 * require a pre-tiering quality baseline to exist before model selection
 * changes, because once it changes the "before" numbers cannot be reproduced.
 *
 * SETTINGS ARE THE ONLY SOURCE. The toggle lives in Settings → AI Provider with
 * the provider, model and keys it governs, and no env var can turn it on. Two
 * sources for one switch would let the UI read "off" while the process runs
 * "on", with nothing to tell the operator which is in force.
 */

const cfg = (provider: LlmRuntimeConfig['provider'], model: string): LlmRuntimeConfig => ({
  provider,
  model,
  apiKey: `key-${provider}`,
  source: 'app',
});

const allConfigured: LlmRuntimeConfig[] = [
  cfg('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1'),
  cfg('groq', 'llama-3.3-70b-versatile'),
  cfg('gemini', 'gemini-2.5-flash'),
];

describe('tiering gate (FR-041 / SC-009)', () => {
  it('is off until the operator turns it on in Settings', () => {
    // Unset must mean OFF, never "inherit something": a deployment that has
    // never opened Settings keeps today's single-chain behaviour, which is what
    // makes the SC-004 baseline recoverable.
    expect(resolveRoleTiering(null)).toBe(false);
    expect(resolveRoleTiering(undefined)).toBe(false);
  });

  it('follows the stored setting in both directions', () => {
    expect(resolveRoleTiering(true)).toBe(true);
    expect(resolveRoleTiering(false)).toBe(false);
  });

  it('cannot be switched on from the environment', () => {
    // Regression guard. This was briefly an env var with settings layered on
    // top; two sources for one switch let Settings display "off" while the
    // process ran tiered, with no way for the operator to tell which was live.
    process.env.LLM_ROLE_TIERING_ENABLED = 'true';
    try {
      expect(resolveRoleTiering(null)).toBe(false);
      expect(resolveRoleTiering(false)).toBe(false);
    } finally {
      delete process.env.LLM_ROLE_TIERING_ENABLED;
    }
  });

  it('treats non-boolean stored values as off rather than truthy', () => {
    for (const v of ['true', 1, {}, []] as unknown[]) {
      expect(resolveRoleTiering(v as boolean), `stored ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('leaves every chain untouched while disabled', () => {
    for (const role of LLM_ROLES) {
      expect(selectRoleChain(role, allConfigured), `role ${role}`).toEqual(allConfigured);
      expect(selectRoleChain(role, allConfigured, { enabled: false }), `role ${role}`).toEqual(allConfigured);
    }
  });
});

describe('chain selection once enabled', () => {
  it('puts a small-tier model first for cheap classification work', () => {
        const chain = selectRoleChain('route', allConfigured, { enabled: true });
    expect(chain[0].provider).toBe('groq');
    expect(chain[0].model).toBe('llama-3.1-8b-instant');
  });

  it('keeps architecture design on a large-tier model', () => {
        const chain = selectRoleChain('plan', allConfigured, { enabled: true });
    expect(ROLE_TIERS.plan).toBe('large');
    expect(chain[0].provider).toBe('nvidia');
  });

  it('never invents a connection the user has not configured', () => {
        const onlyNvidia = [cfg('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1')];
    const chain = selectRoleChain('route', onlyNvidia, { enabled: true });
    expect(chain.every((c) => c.provider === 'nvidia')).toBe(true);
    expect(chain.every((c) => c.apiKey)).toBe(true);
  });

  it('reuses the configured key when switching model on the same provider', () => {
        const chain = selectRoleChain('route', allConfigured, { enabled: true });
    expect(chain[0].apiKey).toBe('key-groq');
  });

  it('lists every configured provider exactly once', () => {
        const chain = selectRoleChain('analyze', allConfigured, { enabled: true });
    const providers = chain.map((c) => c.provider);
    expect(new Set(providers).size).toBe(providers.length);
    expect(new Set(providers)).toEqual(new Set(['nvidia', 'groq', 'gemini']));
  });

  it('does not strand a role when no preferred provider is configured', () => {
        const onlyOpenRouter = [cfg('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')];
    expect(selectRoleChain('route', onlyOpenRouter, { enabled: true })).toHaveLength(1);
  });

  it('never leads with a per-day-quota provider for high-frequency work', () => {
    // Real configuration hit during implementation: nvidia + gemini + openrouter
    // with no Groq key. Gemini is the catalog's small model, but its free tier is
    // ~20 requests per DAY — and route/intent/interpret/distill fire several
    // times per turn, so leading with it would exhaust the day in a few turns.
        const noSmallProvider = [
      cfg('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1'),
      cfg('gemini', 'gemini-2.5-flash'),
      cfg('openrouter', 'meta-llama/llama-3.3-70b-instruct:free'),
    ];
    const chain = selectRoleChain('route', noSmallProvider, { enabled: true });
    expect(chain[0].provider).toBe('nvidia');
    // Still reachable as a fallback — held back, not excluded.
    expect(chain.map((c) => c.provider)).toContain('gemini');
    expect(chain.map((c) => c.provider)).toContain('openrouter');
  });

  it('still prefers a genuine small model when one is configured', () => {
        const withGroq = [
      cfg('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1'),
      cfg('groq', 'llama-3.3-70b-versatile'),
      cfg('gemini', 'gemini-2.5-flash'),
    ];
    const chain = selectRoleChain('route', withGroq, { enabled: true });
    expect(chain[0]).toMatchObject({ provider: 'groq', model: 'llama-3.1-8b-instant' });
  });

  it('returns an empty chain unchanged rather than throwing', () => {
        expect(selectRoleChain('plan', [], { enabled: true })).toEqual([]);
  });
});

describe('tier honesty (SC-004 regression, post-tiering.json 2026-08-01)', () => {
  it('a mid role never leads with a large-tagged model while a mid-tagged one is configured', () => {
    // The first measured post-tiering run failed SC-004 at smallMidShare 0.11
    // because the mid chain led with nvidia's 49b — catalog tier LARGE — so
    // every review/cost/analyze call was served by (and recorded as) the same
    // class of model the plan role uses. The tier of the model that actually
    // serves is what the usage panel reports; a "mid" preference pointing at a
    // large model quietly turns the whole tier into a label.
    for (const role of ['analyze', 'review', 'cost', 'report'] as const) {
      const [first] = selectRoleChain(role, allConfigured, { enabled: true });
      expect(tierOf(first.provider, first.model), `role ${role} leads with ${first.provider}/${first.model}`).toBe('mid');
    }
  });
});

describe('operator overrides (FR-016)', () => {
  it('puts an explicitly assigned connection first', () => {
        const chain = selectRoleChain('plan', allConfigured, { enabled: true, override: { provider: 'gemini', model: 'gemini-2.5-pro' } });
    expect(chain[0]).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-pro' });
  });

  it('ignores an override naming a provider with no key', () => {
        const chain = selectRoleChain('plan', allConfigured, { enabled: true, override: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    expect(chain.some((c) => c.provider === 'anthropic')).toBe(false);
    expect(chain.length).toBeGreaterThan(0);
  });

  it('is inert while tiering is disabled', () => {
    const chain = selectRoleChain('plan', allConfigured, {
      enabled: false,
      override: { provider: 'gemini', model: 'gemini-2.5-pro' },
    });
    expect(chain).toEqual(allConfigured);
  });
});
