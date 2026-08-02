import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail, parseBody } from '@/lib/api';
import { llmModelsListSchema } from '@/lib/schemas';
import { envKeyFor, llmListModels, LlmError } from '@/lib/llm';
import { loadLlmSettings } from '@/lib/llm-settings';

export const runtime = 'nodejs';

/**
 * POST /api/settings/llm/models — the provider's live model list, fetched with
 * the request-body key, else the stored key, else env (same resolution as the
 * test endpoint). Drives the settings UI's model dropdown so operators pick
 * from what the account can actually use instead of typing ids blind.
 * Failures come back as 200 with `ok: false` so the UI can quietly fall back
 * to the catalog suggestions.
 */
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    if (!can(session.role, 'settings:manage')) {
      throw new HttpError(403, 'Only a super admin can list provider models.');
    }
    const body = await parseBody(req, llmModelsListSchema);
    const snapshot = await loadLlmSettings();
    const apiKey =
      body.apiKey.trim() || snapshot?.keys[body.provider] || envKeyFor(body.provider);
    try {
      const models = await llmListModels({ provider: body.provider, apiKey });
      return NextResponse.json({ ok: true, provider: body.provider, models });
    } catch (e) {
      if (e instanceof LlmError) {
        return NextResponse.json({ ok: false, provider: body.provider, error: e.message });
      }
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
