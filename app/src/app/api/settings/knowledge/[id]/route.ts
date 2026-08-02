import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireVerified, HttpError } from '@/lib/session';
import { can } from '@/lib/rbac';
import { fail, parseBody } from '@/lib/api';
import { knowledgePatchSchema } from '@/lib/schemas';
import { KnowledgeEntry } from '@/lib/models/KnowledgeEntry';
import { contentHash } from '@/lib/knowledge/types';
import { serializeEntry } from '../route';

export const runtime = 'nodejs';

/**
 * Edit and delete stored knowledge (feature 008 US5, FR-032/FR-033;
 * contracts/settings-knowledge.md).
 *
 * These are the rules the generator reasons with, so both verbs are gated on
 * `settings:manage` SERVER-SIDE — the read-only UI for non-administrators is a
 * courtesy, not the control.
 */

async function requireManager() {
  const session = await requireVerified();
  if (!can(session.role, 'settings:manage')) {
    throw new HttpError(403, 'Only a super admin can change stored knowledge.');
  }
  return session;
}

function requireObjectId(id: string): void {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'Knowledge entry not found.');
}

/**
 * PATCH — edit the mutable subset. Takes hold on the next generation with no
 * redeploy (FR-032, US3 AS-4).
 *
 * Editing `content` recomputes the dedupe hash. If that collides with another
 * entry the request fails 409 rather than merging two rules: the collision
 * means the operator has just written something the store already says, and
 * silently discarding one of them would lose an edit they believe they made.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireManager();
    const { id } = await ctx.params;
    requireObjectId(id);
    const body = await parseBody(req, knowledgePatchSchema);

    await connectDB();
    const entry = await KnowledgeEntry.findById(id);
    if (!entry) throw new HttpError(404, 'Knowledge entry not found.');

    // Validate the WHOLE edit before applying any of it. The hash covers
    // provider + designMode + content, so a design-mode change moves it just as
    // a content change does — and a rejected edit must leave the entry exactly
    // as it was, not partially applied with a stale hash.
    const nextContent = body.content ?? entry.content;
    const nextDesignMode = body.designMode ?? entry.designMode;
    let nextHash = entry.hash;
    if (body.content !== undefined || body.designMode !== undefined) {
      nextHash = contentHash({ provider: entry.provider, designMode: nextDesignMode, content: nextContent });
      if (nextHash !== entry.hash && (await KnowledgeEntry.exists({ hash: nextHash, _id: { $ne: entry._id } }))) {
        throw new HttpError(409, 'Another knowledge entry already says this. Edit or disable that one instead.');
      }
    }

    if (body.title !== undefined) entry.title = body.title;
    if (body.keywords !== undefined) entry.keywords = body.keywords.map((k) => k.toLowerCase());
    if (body.enabled !== undefined) entry.enabled = body.enabled;
    entry.content = nextContent;
    entry.designMode = nextDesignMode;
    entry.hash = nextHash;

    await entry.save();
    return NextResponse.json({ entry: serializeEntry(entry) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * DELETE — hard delete.
 *
 * Deleting a seeded rule is allowed but pointless on its own: the next seeding
 * run restores it. `willReseed` says so explicitly so the UI can steer the
 * operator to `enabled: false`, which is the durable choice (contract §DELETE).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireManager();
    const { id } = await ctx.params;
    requireObjectId(id);

    await connectDB();
    const entry = await KnowledgeEntry.findByIdAndDelete(id);
    if (!entry) throw new HttpError(404, 'Knowledge entry not found.');

    return NextResponse.json({ deleted: true, willReseed: entry.source === 'seed' });
  } catch (e) {
    return fail(e);
  }
}
