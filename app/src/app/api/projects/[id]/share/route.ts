import { NextResponse } from 'next/server';
import { requireVerified, HttpError } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { shareSchema, unshareSchema } from '@/lib/schemas';
import { getProjectForWrite } from '@/lib/projects';
import { User } from '@/lib/models/User';
import { Types } from 'mongoose';

export const runtime = 'nodejs';

async function sharedWithView(sharedWith: Types.ObjectId[]) {
  const users = await User.find({ _id: { $in: sharedWith } }, { email: 1, name: 1 });
  return users.map((u) => ({ userId: String(u._id), email: u.email, name: u.name }));
}

/**
 * POST /api/projects/[id]/share — owner grants read access to any registered
 * workspace user by email (single-shared-workspace clarification; FR-022).
 * Shared users can view + duplicate, never edit (US5/AC3).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, shareSchema);

    const target = await User.findOne({ email: body.email.toLowerCase() });
    if (!target) throw new HttpError(404, 'No account exists with that email.');
    if (String(target._id) === session.sub) {
      throw new HttpError(400, 'You already own this project.');
    }
    if (!project.sharedWith.some((u) => String(u) === String(target._id))) {
      project.sharedWith.push(target._id);
      await project.save();
    }
    return NextResponse.json({ sharedWith: await sharedWithView(project.sharedWith) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/projects/[id]/share — owner revokes a user's read access.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVerified();
    const { id } = await ctx.params;
    const project = await getProjectForWrite(id, session.sub);
    const body = await parseBody(req, unshareSchema);
    project.sharedWith = project.sharedWith.filter((u) => String(u) !== body.userId);
    await project.save();
    return NextResponse.json({ sharedWith: await sharedWithView(project.sharedWith) });
  } catch (e) {
    return fail(e);
  }
}
