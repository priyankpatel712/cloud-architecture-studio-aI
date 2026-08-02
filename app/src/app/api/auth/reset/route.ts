import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { fail, parseBody } from '@/lib/api';
import { resetSchema } from '@/lib/schemas';
import { clientIp, guardAuth, penalizeAuth, resetAuth, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { email, token, password } = await parseBody(req, resetSchema);

    // Throttle token guessing per-IP and per-account with backoff (checklist #1).
    const keys = [`reset:ip:${clientIp(req)}`, `reset:acct:${email}`];
    const guard = await guardAuth(keys);
    if (!guard.ok) return tooManyRequests(guard.retryAfterSec, 'Too many attempts. Please wait and try again.');

    await connectDB();
    const user = await User.findOne({ email }).select('+resetTokenHash +resetTokenExpires');

    const rejectInvalid = async () => {
      await penalizeAuth(keys);
      return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
    };
    if (!user?.resetTokenHash || !user.resetTokenExpires) return rejectInvalid();
    if (new Date(user.resetTokenExpires).getTime() < Date.now()) return rejectInvalid();
    if (!(await verifyPassword(token, user.resetTokenHash))) return rejectInvalid();

    user.passwordHash = await hashPassword(password);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    await user.save();
    await resetAuth(keys);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
