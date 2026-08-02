import { describe, expect, it } from 'vitest';
import { llmSettingsPutSchema } from '@/lib/schemas';
import { LLM_ROLES } from '@/lib/llm-roles';

/**
 * PUT /api/settings/llm request schema (008 FR-016, T062/T104).
 *
 * This schema had no test, and that is how a real breakage shipped: in Zod 4,
 * `z.record(z.enum(...), …)` is EXHAUSTIVE — it rejects any object missing one
 * of the enum keys — so the moment `roleModels` keys were constrained to the
 * role union, EVERY save from the settings UI returned 400. The UI always
 * sends `roleModels`, and it only contains the roles the operator pinned,
 * which is usually none. Caught live: an operator's save failing while the
 * baseline ran. `z.partialRecord` is the correct construct; these tests pin
 * that partial and empty maps stay valid.
 */

const base = { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: '' };

describe('roleModels acceptance (the settings UI save path)', () => {
  it('accepts the empty map — the shape every save sends before any pinning', () => {
    expect(llmSettingsPutSchema.safeParse({ ...base, roleModels: {} }).success).toBe(true);
  });

  it('accepts a single pinned role without demanding the other nine', () => {
    const r = llmSettingsPutSchema.safeParse({
      ...base,
      roleModels: { route: 'groq/llama-3.1-8b-instant' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts every role pinned at once', () => {
    const all = Object.fromEntries(LLM_ROLES.map((role) => [role, 'groq/llama-3.1-8b-instant']));
    expect(llmSettingsPutSchema.safeParse({ ...base, roleModels: all }).success).toBe(true);
  });

  it('still rejects an unknown role key — the reason the enum exists', () => {
    const r = llmSettingsPutSchema.safeParse({ ...base, roleModels: { routr: 'groq/x' } });
    expect(r.success).toBe(false);
  });

  it('accepts omitting roleModels entirely', () => {
    expect(llmSettingsPutSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the tiering toggle alongside a partial map', () => {
    const r = llmSettingsPutSchema.safeParse({
      ...base,
      roleTieringEnabled: true,
      roleModels: { plan: 'nvidia/nvidia/llama-3.3-nemotron-super-49b-v1' },
    });
    expect(r.success).toBe(true);
  });
});
