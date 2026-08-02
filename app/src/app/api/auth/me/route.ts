import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User, type UserDoc } from '@/lib/models/User';
import { getSession, requireSession, setSession } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { profilePatchSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

function serializeMe(user: UserDoc) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organization: user.organization,
    verified: Boolean(user.emailVerifiedAt),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null }, { status: 200 });

  await connectDB();
  const user = await User.findById(session.sub);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  return NextResponse.json({ user: serializeMe(user) });
}

// PATCH /api/auth/me — edit own profile (FR-005: name, organization).
// Email changes are deferred: they interact with the verification gate.
export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    const patch = await parseBody(req, profilePatchSchema);

    await connectDB();
    const user = await User.findById(session.sub);
    if (!user) return NextResponse.json({ user: null }, { status: 200 });

    if (patch.name !== undefined) user.name = patch.name;
    if (patch.organization !== undefined) user.organization = patch.organization;
    await user.save();

    // Keep the session's display name in sync with the profile.
    if (patch.name !== undefined) {
      await setSession({ ...session, name: user.name });
    }

    return NextResponse.json({ user: serializeMe(user) });
  } catch (e) {
    return fail(e);
  }
}
