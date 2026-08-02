import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';
import { sendResetEmail } from '@/lib/email';
import { forgotSchema } from '@/lib/schemas';
import { clientIp, fixedWindowLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

export async function POST(req: Request) {
  // Lenient parse: malformed / oversized input is treated as "no email" so the
  // response stays constant — account existence is never revealed (enumeration).
  const parsed = forgotSchema.safeParse(await req.json().catch(() => ({})));
  const normalized = parsed.success ? parsed.data.email : '';

  // Anti email-bomb: cap reset requests per IP and per target address (checklist #1).
  const ipLimit = await fixedWindowLimit('forgot:ip', clientIp(req), RATE_LIMITS.emailMax, RATE_LIMITS.emailWindowMs);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec, 'Too many password-reset requests. Please try again later.');

  // Always respond ok — never reveal whether an email is registered.
  const response: { ok: true; resetUrl?: string } = { ok: true };

  if (normalized) {
    const acctLimit = await fixedWindowLimit('forgot:acct', normalized, RATE_LIMITS.emailMax, RATE_LIMITS.emailWindowMs);
    if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfterSec, 'Too many password-reset requests. Please try again later.');

    await connectDB();
    const user = await User.findOne({ email: normalized });
    if (user) {
      const token = randomBytes(32).toString('hex');
      user.resetTokenHash = await hashPassword(token);
      user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
      await user.save();

      // Real delivery via lib/email (FR-003). The dev transport surfaces the link
      // in non-production only, keeping the flow testable before email is wired.
      const sent = await sendResetEmail(normalized, token).catch((e) => {
        console.error('[forgot] reset email failed:', e);
        return { delivered: false as const, devUrl: undefined };
      });
      if (sent.devUrl) response.resetUrl = sent.devUrl;
    }
  }

  return NextResponse.json(response);
}
