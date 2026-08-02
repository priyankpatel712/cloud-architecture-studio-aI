import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { verifyPassword } from '@/lib/auth';
import { setSession } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { verifyConfirmSchema } from '@/lib/schemas';
import { clientIp, guardAuth, penalizeAuth, resetAuth, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/verify/confirm — complete the email-verification gate (FR-004).
 * The token is time-limited and single-use. On success the user is signed in with a
 * verified session and lands in the workspace (US1/AC1).
 */
export async function POST(req: Request) {
  try {
    const { email, token } = await parseBody(req, verifyConfirmSchema);

    // Throttle token guessing per-IP and per-account with backoff (checklist #1).
    const keys = [`verifyconfirm:ip:${clientIp(req)}`, `verifyconfirm:acct:${email}`];
    const guard = await guardAuth(keys);
    if (!guard.ok) return tooManyRequests(guard.retryAfterSec, 'Too many attempts. Please wait and try again.');

    await connectDB();
    const user = await User.findOne({ email }).select('+verifyTokenHash +verifyTokenExpires');
    if (user?.emailVerifiedAt) {
      // Already verified — just refresh the session and continue.
      await resetAuth(keys);
      await setSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role, verified: true });
      return NextResponse.json({ ok: true });
    }
    if (
      !user?.verifyTokenHash ||
      !user.verifyTokenExpires ||
      user.verifyTokenExpires.getTime() < Date.now() ||
      !(await verifyPassword(token, user.verifyTokenHash))
    ) {
      await penalizeAuth(keys);
      return NextResponse.json(
        { error: 'This verification link is invalid or has expired. Request a new one.' },
        { status: 400 }
      );
    }

    user.emailVerifiedAt = new Date();
    user.verifyTokenHash = null;
    user.verifyTokenExpires = null;
    await user.save();
    await resetAuth(keys);

    await setSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role, verified: true });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
