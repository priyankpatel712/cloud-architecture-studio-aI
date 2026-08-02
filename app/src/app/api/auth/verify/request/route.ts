import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { sendVerificationEmail } from '@/lib/email';
import { verifyRequestSchema } from '@/lib/schemas';
import { clientIp, fixedWindowLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * POST /api/auth/verify/request — (re)send the verification link (FR-004).
 * Uses the signed-in session's email when present, else the posted email.
 * Always responds ok — account existence is never leaked.
 */
export async function POST(req: Request) {
  const session = await getSession();
  const parsed = verifyRequestSchema.safeParse(await req.json().catch(() => ({})));
  const posted = parsed.success ? parsed.data.email : '';
  const email = (session?.email ?? posted).trim().toLowerCase();

  // Anti email-bomb: cap re-send requests per IP and per target address (checklist #1).
  const ipLimit = await fixedWindowLimit('verify:ip', clientIp(req), RATE_LIMITS.emailMax, RATE_LIMITS.emailWindowMs);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec, 'Too many verification emails requested. Please try again later.');

  const response: { ok: true; verifyUrl?: string } = { ok: true };

  if (email) {
    const acctLimit = await fixedWindowLimit('verify:acct', email, RATE_LIMITS.emailMax, RATE_LIMITS.emailWindowMs);
    if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfterSec, 'Too many verification emails requested. Please try again later.');

    await connectDB();
    const user = await User.findOne({ email }).select('+verifyTokenHash +verifyTokenExpires');
    if (user && !user.emailVerifiedAt) {
      const token = randomBytes(32).toString('hex');
      user.verifyTokenHash = await hashPassword(token);
      user.verifyTokenExpires = new Date(Date.now() + VERIFY_TTL_MS);
      await user.save();
      const sent = await sendVerificationEmail(email, token).catch((e) => {
        console.error('[verify/request] email failed:', e);
        return { delivered: false as const, devUrl: undefined };
      });
      if (sent.devUrl) response.verifyUrl = sent.devUrl; // dev transport, non-prod only
    }
  }

  return NextResponse.json(response);
}
