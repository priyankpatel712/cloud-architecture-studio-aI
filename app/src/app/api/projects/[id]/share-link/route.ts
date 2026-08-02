import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireVerified } from '@/lib/session';
import { fail } from '@/lib/api';
import { getProjectForWrite } from '@/lib/projects';

export const runtime = 'nodejs';

/**
 * Public share-link management (007 roadmap 1.3) — owner-only. The token is
 * the credential: crypto-random, unguessable, revocable. GET reports state,
 * POST creates (idempotent — an existing token is returned, not rotated),
 * DELETE revokes.
 */

function linkPayload(token: string | null) {
  return { token, path: token ? `/share/${token}` : null };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    return NextResponse.json(linkPayload(project.shareToken ?? null));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    if (!project.shareToken) {
      project.shareToken = randomBytes(24).toString('base64url');
      await project.save();
    }
    return NextResponse.json(linkPayload(project.shareToken));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    project.shareToken = null;
    await project.save();
    return NextResponse.json(linkPayload(null));
  } catch (e) {
    return fail(e);
  }
}
