'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setDevUrl(data.resetUrl ?? null); // dev-only link surfaced until email is wired
    setSent(true);
    setLoading(false);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll send a reset link to your email"
      footer={
        <Link href="/login" className="font-medium text-[var(--color-primary)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 text-center shadow-sm">
          <CheckCircle2 size={36} className="mx-auto text-[#1e8e3e]" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            If an account exists for <strong className="text-[var(--color-text-primary)]">{email}</strong>, a
            reset link is on its way.
          </p>
          {devUrl && (
            <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3 text-left">
              <p className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                Dev mode — email isn&apos;t wired yet. Use this link:
              </p>
              <Link href={devUrl} className="break-all font-mono text-xs text-[var(--color-primary)] hover:underline">
                {devUrl}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 shadow-sm"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Email</span>
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            {loading ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
