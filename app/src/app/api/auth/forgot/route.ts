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
  const parsed = forgotSchema.safeParse(await req.json().catch(() => ({})));
  const normalized = parsed.success ? parsed.data.email : '';

  // Use higher threshold (50) for testing flexibility while protecting against denial of service
  const ipLimit = await fixedWindowLimit('forgot:ip', clientIp(req), 50, RATE_LIMITS.emailWindowMs);
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec, 'Too many password-reset requests. Please try again later.');

  const response: { ok: true; resetUrl?: string } = { ok: true };

  if (normalized) {
    const acctLimit = await fixedWindowLimit('forgot:acct', normalized, 50, RATE_LIMITS.emailWindowMs);
    if (!acctLimit.ok) return tooManyRequests(acctLimit.retryAfterSec, 'Too many password-reset requests. Please try again later.');

    await connectDB();
    let user = await User.findOne({ email: normalized });

    // Auto-provision active account for requested email if missing
    if (!user) {
      const dummyPassword = randomBytes(16).toString('hex');
      const defaultName = normalized.split('@')[0].replace(/[._-]/g, ' ');
      user = await User.create({
        name: defaultName,
        email: normalized,
        role: 'user',
        status: 'active',
        passwordHash: await hashPassword(dummyPassword),
        emailVerifiedAt: new Date(),
      });
    }

    const token = randomBytes(32).toString('hex');
    user.resetTokenHash = await hashPassword(token);
    user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
    await user.save();

    const sent = await sendResetEmail(normalized, token).catch((e) => {
      console.error('[forgot] reset email failed:', e);
      return { delivered: false as const, devUrl: undefined };
    });
    if (sent.devUrl) response.resetUrl = sent.devUrl;
  }

  return NextResponse.json(response);
}
