import 'server-only';

/**
 * Email provider abstraction (research R5, FR-003/FR-004).
 *
 * Primary transport: Mailtrap Nodemailer SMTP.
 * Fallbacks: Resend API or Dev console logger.
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
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '');
  }
  return 'https://cloud-architecture-studio-a-i-wu6n.vercel.app';
}

async function sendViaSmtp(msg: EmailMessage): Promise<SendResult> {
  const nodemailer = await import('nodemailer');
  const host = process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';
  const port = Number(process.env.SMTP_PORT || 2525);
  const user = process.env.SMTP_USER || '158651ef857574';
  const pass = process.env.SMTP_PASS || '90a9a4499b856a';
  const from = process.env.EMAIL_FROM || 'Cloud Architecture Studio <from@example.com>';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  });

  return { delivered: true };
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
  if (process.env.EMAIL_PROVIDER === 'resend' && process.env.RESEND_API_KEY) {
    return sendViaResend(msg);
  }

  try {
    return await sendViaSmtp(msg);
  } catch (err) {
    console.error('[email] SMTP delivery failed:', err);
    if (process.env.RESEND_API_KEY) {
      return sendViaResend(msg);
    }
    return sendViaDev(msg);
  }
}

function layout(title: string, body: string, actionUrl: string, actionLabel: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff">
  <div style="text-align:center;margin-bottom:20px">
    <h2 style="margin:0 0 8px;color:#111827;font-size:22px;font-weight:700">${title}</h2>
    <p style="color:#4b5563;line-height:1.6;font-size:15px;margin:0">${body}</p>
  </div>
  <div style="text-align:center;margin:28px 0">
    <a href="${actionUrl}" style="background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 2px 4px rgba(37,99,235,0.2)">${actionLabel}</a>
  </div>
  <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:16px">If you didn't request this email, you can safely ignore it.</p>
</div>`;
}

export function sendVerificationEmail(to: string, token: string): Promise<SendResult> {
  const url = `${appBaseUrl()}/verify?email=${encodeURIComponent(to)}&token=${token}`;
  return sendEmail({
    to,
    subject: 'Verify your email — Cloud Architecture Studio',
    html: layout(
      'Verify your email',
      'Confirm your email address to unlock your Cloud Architecture Studio workspace. This link expires in 24 hours.',
      url,
      'Verify Email Address'
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
      'Reset Password'
    ),
    actionUrl: url,
  });
}
