import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';
import { setSession } from '@/lib/session';
import { sendVerificationEmail } from '@/lib/email';
import { fail, parseBody } from '@/lib/api';
import { registerSchema } from '@/lib/schemas';
import { clientIp, fixedWindowLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function POST(req: Request) {
  try {
    // Moderate per-IP cap on account creation (checklist #1).
    const rl = await fixedWindowLimit(
      'register:ip',
      clientIp(req),
      RATE_LIMITS.registerMax,
      RATE_LIMITS.registerWindowMs
    );
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec, 'Too many sign-ups from this network. Please try again later.');

    const { name, email, password } = await parseBody(req, registerSchema);

    await connectDB();
    if (await User.exists({ email })) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }

    // Email verification gate (FR-004): self-registered accounts start unverified and
    // must confirm the emailed link before the workspace opens.
    const verifyToken = randomBytes(32).toString('hex');
    const user = await User.create({
      name,
      email,
      role: 'user', // self-registration always creates a standard user
      status: 'active',
      passwordHash: await hashPassword(password),
      lastLoginAt: new Date(),
      emailVerifiedAt: null,
      verifyTokenHash: await hashPassword(verifyToken),
      verifyTokenExpires: new Date(Date.now() + VERIFY_TTL_MS),
    });

    const sent = await sendVerificationEmail(email, verifyToken).catch((e) => {
      console.error('[register] verification email failed:', e);
      return { delivered: false as const, devUrl: undefined };
    });

    // Signed in but unverified — the edge proxy corrals this session to /verify.
    await setSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role, verified: false });

    return NextResponse.json(
      {
        user: { id: String(user._id), name: user.name, email: user.email, role: user.role, verified: false },
        verifyRequired: true,
        // Dev transport only, never in production (spec Assumptions).
        ...(sent.devUrl ? { verifyUrl: sent.devUrl } : {}),
      },
      { status: 201 }
    );
  } catch (e) {
    return fail(e);
  }
}
