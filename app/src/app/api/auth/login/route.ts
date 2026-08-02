import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { verifyPassword } from '@/lib/auth';
import { setSession } from '@/lib/session';
import { fail, parseBody } from '@/lib/api';
import { loginSchema } from '@/lib/schemas';
import { clientIp, guardAuth, penalizeAuth, resetAuth, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, loginSchema);

    // Per-IP AND per-account backoff (checklist #1): a brute-forcer is throttled
    // by both their address and the target account; a real user's own success
    // clears the counter below.
    const keys = [`login:ip:${clientIp(req)}`, `login:acct:${email}`];
    const guard = await guardAuth(keys);
    if (!guard.ok) {
      return tooManyRequests(guard.retryAfterSec, 'Too many sign-in attempts. Please wait and try again.');
    }

    await connectDB();
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await penalizeAuth(keys);
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }
    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'This account is suspended.' }, { status: 403 });
    }

    await resetAuth(keys);
    user.lastLoginAt = new Date();
    await user.save();

    const verified = Boolean(user.emailVerifiedAt);
    await setSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role, verified });

    return NextResponse.json({
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role, verified },
    });
  } catch (e) {
    return fail(e);
  }
}
