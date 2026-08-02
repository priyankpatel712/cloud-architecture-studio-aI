import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';
import { requireCan, HttpError } from '@/lib/session';
import { fail, parseBody, serializeUser } from '@/lib/api';
import { userUpdateSchema } from '@/lib/schemas';
import { canManageRole } from '@/lib/rbac';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/users/[id] — update name/role/status/organization/password.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const actor = await requireCan('users:update');
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'User not found.');
    const body = await parseBody(req, userUpdateSchema);

    await connectDB();
    const target = await User.findById(id).select('+passwordHash');
    if (!target) throw new HttpError(404, 'User not found.');

    // Must be able to manage the target's current role.
    if (!canManageRole(actor.role, target.role)) {
      throw new HttpError(403, 'You cannot manage this user.');
    }
    const isSelf = String(target._id) === actor.sub;

    if (body.role !== undefined) {
      if (isSelf) throw new HttpError(400, 'You cannot change your own role.');
      if (!canManageRole(actor.role, body.role)) throw new HttpError(403, `You cannot assign the ${body.role} role.`);
      target.role = body.role;
    }

    if (body.status !== undefined) {
      if (isSelf) throw new HttpError(400, 'You cannot change your own status.');
      target.status = body.status;
    }

    if (body.name !== undefined) target.name = body.name;
    if (body.organization !== undefined) target.organization = body.organization;
    if (body.password) target.passwordHash = await hashPassword(body.password);

    await target.save();
    return NextResponse.json({ user: serializeUser(target) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/users/[id]
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const actor = await requireCan('users:delete');
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'User not found.');

    await connectDB();
    const target = await User.findById(id);
    if (!target) throw new HttpError(404, 'User not found.');
    if (String(target._id) === actor.sub) throw new HttpError(400, 'You cannot delete your own account.');
    if (!canManageRole(actor.role, target.role)) throw new HttpError(403, 'You cannot delete this user.');
    if (target.role === 'super_admin' && (await User.countDocuments({ role: 'super_admin' })) <= 1) {
      throw new HttpError(400, 'Cannot delete the last super admin.');
    }

    await target.deleteOne();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
