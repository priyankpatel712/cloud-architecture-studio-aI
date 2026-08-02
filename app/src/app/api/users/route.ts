import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';
import { requireCan, HttpError } from '@/lib/session';
import { fail, parseBody, serializeUser } from '@/lib/api';
import { userCreateSchema } from '@/lib/schemas';
import { canManageRole } from '@/lib/rbac';

export const runtime = 'nodejs';

// GET /api/users — list users the actor is allowed to see.
export async function GET() {
  try {
    const actor = await requireCan('users:read');
    await connectDB();
    // Separation of duties: admins only see standard users; super admins see all.
    const users = await User.find(actor.role === 'super_admin' ? {} : { role: 'user' as const }).sort({
      createdAt: -1,
    });
    return NextResponse.json({ users: users.map(serializeUser) });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/users — create a user (role must be manageable by the actor).
export async function POST(req: Request) {
  try {
    const actor = await requireCan('users:create');
    const { name, email, password, role, organization } = await parseBody(req, userCreateSchema);

    if (!canManageRole(actor.role, role)) {
      throw new HttpError(403, `You cannot assign the ${role} role.`);
    }

    await connectDB();
    if (await User.exists({ email })) throw new HttpError(409, 'A user with this email already exists.');

    const user = await User.create({
      name,
      email,
      role,
      organization,
      passwordHash: await hashPassword(password),
      // Admin-created accounts are pre-verified (FR-004 clarification): the gate
      // applies to self-registration only.
      emailVerifiedAt: new Date(),
    });
    return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
