'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LogIn, Loader2, TriangleAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Login failed.');
        setLoading(false);
        return;
      }
      // Full navigation so the proxy re-reads the fresh cookie. Admins land in
      // the admin panel when they didn't request a specific page.
      const dest = params.get('next') || (data.user.role === 'user' ? '/' : '/admin');
      window.location.href = dest === '/login' ? '/' : dest;
    } catch {
      setError('Network error. Is the server running?');
      setLoading(false);
    }
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
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Email</span>
        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </label>
      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Password</span>
          <Link href="/forgot-password" className="text-xs font-medium text-[var(--color-primary)] hover:underline">
            Forgot?
          </Link>
        </div>
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </label>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 size={17} className="animate-spin" /> : <LogIn size={17} />}
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>
      {next !== '/' && <input type="hidden" value={next} readOnly />}
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back to Cloud Architecture Studio"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-[var(--color-primary)] hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <Suspense fallback={<Loader2 className="mx-auto animate-spin text-[var(--color-primary)]" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
