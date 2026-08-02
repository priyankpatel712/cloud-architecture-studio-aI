import 'server-only';

/**
 * Email provider abstraction (research R5, FR-003/FR-004).
 *
 * EMAIL_PROVIDER selects the transport:
 *  - 'resend' — transactional delivery via the Resend API (RESEND_API_KEY).
 *  - 'dev' (default) — logs the message and returns the action link so the
 *    verification/reset flows are testable before delivery is connected.
 *    The dev link is surfaced in API responses in NON-PRODUCTION ONLY.
 *
 * Because email verification gates workspace access (clarified FR-004), delivery
 * is a hard production dependency for sign-up.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** primary action link, surfaced by the dev transport */
  actionUrl?: string;
}

export interface SendResult {
  delivered: boolean;
  /** present only from the dev transport in non-production */
  devUrl?: string;
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

async function sendViaResend(msg: EmailMessage): Promise<SendResult> {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? 'Cloud Architecture Studio <onboarding@resend.dev>';
  const { error } = await resend.emails.send({ from, to: msg.to, subject: msg.subject, html: msg.html });
  if (error) throw new Error(`Email delivery failed: ${error.message}`);
  return { delivered: true };
}

function sendViaDev(msg: EmailMessage): SendResult {
  console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"${msg.actionUrl ? ` link=${msg.actionUrl}` : ''}`);
  if (process.env.NODE_ENV !== 'production' && msg.actionUrl) {
    return { delivered: false, devUrl: msg.actionUrl };
  }
  return { delivered: false };
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const provider = process.env.EMAIL_PROVIDER ?? 'dev';
  if (provider === 'resend' && process.env.RESEND_API_KEY) return sendViaResend(msg);
  if (provider !== 'dev' && process.env.NODE_ENV === 'production') {
    throw new Error(`Email provider "${provider}" is not configured`);
  }
  return sendViaDev(msg);
}

function layout(title: string, body: string, actionUrl: string, actionLabel: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">${title}</h2>
  <p style="color:#444;line-height:1.5">${body}</p>
  <p style="margin:24px 0"><a href="${actionUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${actionLabel}</a></p>
  <p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p>
</div>`;
}

export function sendVerificationEmail(to: string, token: string): Promise<SendResult> {
  const url = `${appBaseUrl()}/verify?email=${encodeURIComponent(to)}&token=${token}`;
  return sendEmail({
    to,
    subject: 'Verify your email — Cloud Architecture Studio',
    html: layout(
      'Verify your email',
      'Confirm your email address to unlock your workspace. This link expires in 24 hours.',
      url,
      'Verify email'
    ),
    actionUrl: url,
  });
}

export function sendResetEmail(to: string, token: string): Promise<SendResult> {
  const url = `${appBaseUrl()}/reset-password?email=${encodeURIComponent(to)}&token=${token}`;
  return sendEmail({
    to,
    subject: 'Reset your password — Cloud Architecture Studio',
    html: layout(
      'Reset your password',
      'Use the button below to choose a new password. This link expires in 1 hour and can be used once.',
      url,
      'Reset password'
    ),
    actionUrl: url,
  });
}
