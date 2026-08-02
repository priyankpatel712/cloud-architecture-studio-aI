'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, MailCheck, MailWarning, Send, TriangleAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';

/**
 * Email-verification gate (FR-004, US1/AC1).
 * With ?email&token → confirms the emailed link and signs the user in.
 * Without a token → "verify your email" prompt with a resend button; the edge
 * proxy corrals unverified sessions here until the link is confirmed.
 */
function VerifyInner() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';

  const [state, setState] = useState<'pending' | 'confirming' | 'error'>(token ? 'confirming' : 'pending');
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    if (!token || confirmed.current) return;
    confirmed.current = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Verification failed.');
          setState('error');
          return;
        }
        // Full navigation so the proxy re-reads the fresh (verified) cookie.
        window.location.href = '/';
      } catch {
        setError('Network error. Is the server running?');
        setState('error');
      }
    })();
  }, [email, token]);

  async function resend() {
    setResending(true);
    setResent(false);
    setDevUrl(null);
    try {
      const res = await fetch('/api/auth/verify/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email ? { email } : {}),
      });
      const data = await res.json();
      setResent(true);
      if (data.verifyUrl) setDevUrl(data.verifyUrl); // dev transport, non-production only
    } catch {
      setError('Could not send the email. Try again.');
    } finally {
      setResending(false);
    }
  }

  if (state === 'confirming') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-8 text-center">
        <Loader2 className="animate-spin text-[var(--color-primary)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">Confirming your email…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 text-center">
      {state === 'error' ? (
        <>
          <MailWarning size={32} className="mx-auto text-[var(--color-error)]" aria-hidden />
          <div className="flex items-start gap-2 rounded-2xl bg-[var(--color-error-container)] px-3 py-2.5 text-left text-sm text-[var(--color-on-error-container)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        </>
      ) : (
        <>
          <MailCheck size={32} className="mx-auto text-[var(--color-primary)]" aria-hidden />
          <p className="text-sm text-[var(--color-text-secondary)]">
            We sent a verification link to your email. Your workspace unlocks as soon as you confirm it.
          </p>
        </>
      )}

      <Button onClick={resend} disabled={resending} className="w-full">
        {resending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
        {resending ? 'Sending…' : 'Resend verification email'}
      </Button>

      {resent && !devUrl && (
        <p className="text-xs text-[var(--color-text-secondary)]" role="status">
          Sent — check your inbox.
        </p>
      )}
      {devUrl && (
        <p className="text-xs text-[var(--color-text-secondary)]" role="status">
          Dev mode:{' '}
          <a href={devUrl} className="font-medium text-[var(--color-primary)] underline">
            open the verification link
          </a>
        </p>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <AuthShell
      title="Verify your email"
      subtitle="One quick step before your workspace opens"
      footer={
        <>
          Wrong account?{' '}
          <Link href="/login" className="font-medium text-[var(--color-primary)] hover:underline">
            Sign in differently
          </Link>
        </>
      }
    >
      <Suspense fallback={<Loader2 className="mx-auto animate-spin text-[var(--color-primary)]" />}>
        <VerifyInner />
      </Suspense>
    </AuthShell>
  );
}
