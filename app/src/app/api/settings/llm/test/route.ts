import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail, parseBody } from '@/lib/api';
import { llmSettingsTestSchema } from '@/lib/schemas';
import { envKeyFor, llmPing, LlmAbortError, LlmError } from '@/lib/llm';
import { loadLlmSettings } from '@/lib/llm-settings';
import { LLM_PROVIDERS } from '@/lib/llm-catalog';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/settings/llm/test — dry-run a provider config with one tiny
 * structured completion (the same path real turns use). The key resolves from
 * the request body, else the stored key, else env — so a config can be tested
 * both before saving and as currently saved. Failures come back as 200 with
 * `ok: false` and a readable message; only infrastructure errors 500.
 */
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    if (!can(session.role, 'settings:manage')) {
      throw new HttpError(403, 'Only a super admin can test the AI provider.');
    }
    const body = await parseBody(req, llmSettingsTestSchema);
    const snapshot = await loadLlmSettings();
    const info = LLM_PROVIDERS[body.provider];
    const apiKey =
      body.apiKey.trim() || snapshot?.keys[body.provider] || envKeyFor(body.provider);
    const model =
      body.model.trim() ||
      (snapshot?.provider === body.provider ? snapshot.model : null) ||
      info.defaultModel;

    const started = Date.now();
    try {
      await llmPing(
        { provider: body.provider, model, apiKey, source: 'app' },
        AbortSignal.timeout(45_000)
      );
      return NextResponse.json({
        ok: true,
        provider: body.provider,
        model,
        latencyMs: Date.now() - started,
      });
    } catch (e) {
      const error =
        e instanceof LlmAbortError
          ? 'The test timed out after 45 seconds.'
          : e instanceof LlmError
            ? e.message
            : null;
      if (error === null) throw e;
      return NextResponse.json({ ok: false, provider: body.provider, model, error });
    }
  } catch (e) {
    return fail(e);
  }
}
