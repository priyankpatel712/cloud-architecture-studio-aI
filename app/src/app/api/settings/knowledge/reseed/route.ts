import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireVerified, HttpError } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail, parseBody } from '@/lib/api';
import { knowledgeReseedSchema } from '@/lib/schemas';
import { reseedKnowledge } from '@/lib/knowledge/seed';

export const runtime = 'nodejs';

/**
 * POST /api/settings/knowledge/reseed — re-run seeding from the provider rule
 * modules and core rules (feature 008 US5; contracts/settings-knowledge.md).
 *
 * Runs the same `reseedKnowledge` the CLI script uses, so the button and
 * `npm run seed:knowledge` cannot produce different stores. Idempotent by
 * content hash, and it will not re-enable a rule an operator disabled — which
 * is what makes it safe to offer as a button at all.
 */
export async function POST(req: Request) {
  try {
    const session = await requireVerified();
    if (!can(session.role, 'settings:manage')) {
      throw new HttpError(403, 'Only a super admin can reseed stored knowledge.');
    }
    const { prune } = await parseBody(req, knowledgeReseedSchema);

    await connectDB();
    return NextResponse.json(await reseedKnowledge({ prune }));
  } catch (e) {
    return fail(e);
  }
}
