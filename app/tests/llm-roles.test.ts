import { describe, expect, it } from 'vitest';
import {
  LLM_ROLES,
  ROLE_TIERS,
  isLlmRole,
  selectRoleChain,
  type LlmRole,
} from '@/lib/llm-roles';
import { LLM_PROVIDERS, modelInfoFor, tierOf, DEFAULT_MODEL_INFO } from '@/lib/llm-catalog';
import type { LlmRuntimeConfig } from '@/lib/llm';

/**
 * Feature 008 — model role policy.
 *
 * The load-bearing assertion here is the COMPATIBILITY CONTRACT: tagging a call
 * site with a role must not change which connection serves it until per-role
 * chains actually land. That equivalence is what allows the eleven existing
 * llmJson call sites to migrate one at a time instead of in one risky cutover.
 * If a future change makes these fail, update them deliberately — do not relax
 * them to make a red suite green.
 */

const chain: LlmRuntimeConfig[] = [
  { provider: 'nvidia', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', apiKey: 'k1', source: 'app' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'k2', source: 'app' },
  { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'k3', source: 'app' },
];

describe('selectRoleChain — compatibility contract', () => {
  it('returns the supplied chain unchanged when no role is given', () => {
    expect(selectRoleChain(undefined, chain)).toEqual(chain);
  });

  it('returns an identical chain for every role (pre-Phase-2 equivalence)', () => {
    const baseline = selectRoleChain(undefined, chain);
    for (const role of LLM_ROLES) {
      expect(selectRoleChain(role, chain), `role ${role} diverged from the no-role chain`).toEqual(
        baseline
      );
    }
  });

  it('preserves chain order — fallback precedence must not be reshuffled', () => {
    const got = selectRoleChain('plan', chain);
    expect(got.map((c) => c.provider)).toEqual(['nvidia', 'groq', 'gemini']);
  });

  it('does not mutate the array it is given', () => {
    const input = [...chain];
    selectRoleChain('route', input);
    expect(input).toEqual(chain);
  });

  it('tolerates an empty chain (no configured connection)', () => {
    expect(selectRoleChain('analyze', [])).toEqual([]);
  });
});

describe('role definitions', () => {
  it('assigns a tier to every declared role', () => {
    for (const role of LLM_ROLES) {
      expect(ROLE_TIERS[role], `role ${role} has no tier`).toBeDefined();
    }
    expect(Object.keys(ROLE_TIERS).sort()).toEqual([...LLM_ROLES].sort());
  });

  it('keeps the cheap classification roles on the small tier', () => {
    // These are the roles whose whole purpose is to keep work off the large
    // model; promoting one silently re-creates the rate-limit problem.
    for (const role of ['route', 'intent', 'interpret', 'distill', 'research'] as LlmRole[]) {
      expect(ROLE_TIERS[role], `${role} must stay small`).toBe('small');
    }
  });

  it('keeps architecture design on the large tier', () => {
    expect(ROLE_TIERS.plan).toBe('large');
  });

  it('recognises valid roles and rejects anything else', () => {
    expect(isLlmRole('plan')).toBe(true);
    expect(isLlmRole('route')).toBe(true);
    expect(isLlmRole('nonsense')).toBe(false);
    expect(isLlmRole('')).toBe(false);
    expect(isLlmRole(undefined)).toBe(false);
    expect(isLlmRole(null)).toBe(false);
    expect(isLlmRole(42)).toBe(false);
  });
});

describe('catalog capability metadata', () => {
  it('describes every suggested model of every provider', () => {
    for (const provider of Object.values(LLM_PROVIDERS)) {
      for (const id of provider.models) {
        expect(provider.modelInfo[id], `${provider.id}/${id} has no modelInfo`).toBeDefined();
      }
      // Each provider's own default must be described, since it is what the
      // fallback chain uses for every non-active provider.
      expect(provider.modelInfo[provider.defaultModel]).toBeDefined();
    }
  });

  it('reports a usable tier for known models', () => {
    expect(tierOf('groq', 'llama-3.1-8b-instant')).toBe('small');
    expect(tierOf('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1')).toBe('large');
    expect(tierOf('anthropic', 'claude-haiku-4-5-20251001')).toBe('small');
  });

  it('falls back rather than throwing for a model id the catalog does not know', () => {
    // Users may type any model id and providers retire models frequently — an
    // unknown id must never block a call.
    const info = modelInfoFor('groq', 'some-model-released-next-week');
    expect(info.tier).toBe(DEFAULT_MODEL_INFO.tier);
    expect(info.id).toBe('some-model-released-next-week');
    expect(tierOf('nvidia', 'not-in-catalog')).toBe('mid');
  });
});
