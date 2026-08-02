'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { KeyRound, Loader2, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function ResetForm() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const invalidLink = !email || !token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) return setError(data.error ?? 'Reset failed.');
    setDone(true);
  }

  if (invalidLink) {
    return (
      <div className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 text-center shadow-sm">
        <TriangleAlert size={32} className="mx-auto text-[var(--color-error)]" />
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          This reset link is incomplete. Request a new one from the forgot-password page.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 text-center shadow-sm">
        <CheckCircle2 size={36} className="mx-auto text-[#1e8e3e]" />
        <p className="text-sm text-[var(--color-text-secondary)]">Your password has been updated.</p>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 shadow-sm"
    >
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-[var(--color-error-container)] px-3 py-2.5 text-sm text-[var(--color-on-error-container)]">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      <p className="text-xs text-[var(--color-text-secondary)]">
        Resetting password for <strong className="text-[var(--color-text-primary)]">{email}</strong>
      </p>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">New password</span>
        <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Confirm password</span>
        <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" />
      </label>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />}
        {loading ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Set a new password">
      <Suspense fallback={<Loader2 className="mx-auto animate-spin text-[var(--color-primary)]" />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
